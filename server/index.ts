// ScreenLink server: accounts, rooms and invite codes in SQLite, plus WebSocket signaling for the
// relay tree. Video never passes through here — peers connect to each other over WebRTC.
import type { ServerWebSocket } from "bun";
import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { Store, fingerprintOf, normalizeFingerprint, type AuthUser, type User } from "./db";
import { RelayTree } from "./tree";

const PORT = Number(process.env.PORT ?? 3000);
const DB_FILE = process.env.DB_FILE ?? "screenlink.sqlite";
const MAX_DEPTH = Number(process.env.MAX_RELAY_DEPTH ?? 4);
// How long a dropped connection keeps its place in streams. The WebRTC connections between
// peers do not depend on this socket, so a quick reconnect should not disturb anyone.
const GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 20_000);
// STUN finds each peer's public address; add a TURN server here for peers behind symmetric NAT.
const ICE_SERVERS = process.env.ICE_SERVERS
  ? JSON.parse(process.env.ICE_SERVERS)
  : [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

// Optional shared password: without it nobody gets an account, so nobody can create or join
// rooms, share or watch. Changing it signs everyone out (see passwordTag).
const PASSWORD = process.env.SERVER_PASSWORD ?? "";
// Comma-separated device fingerprints with access to the admin view. A client shows its own
// fingerprint when F12 is pressed.
const ADMINS = new Set(
  (process.env.ADMIN_FINGERPRINT ?? "").split(",").map(normalizeFingerprint).filter(Boolean),
);

const store = new Store(DB_FILE);

type Socket = ServerWebSocket<{ user: AuthUser }>;
type StreamSettings = { width: number; height: number; fps: number; bitrate: number; codec: string; hint: string };
type Stream = {
  id: string;
  roomId: string;
  sharerId: string;
  title: string;
  settings: StreamSettings;
  startedAt: number;
  tree: RelayTree;
  /** connId of the edge feeding each viewer. */
  edges: Map<string, string>;
};

const sockets = new Map<string, Socket>();
const streams = new Map<string, Stream>();
const graceTimers = new Map<string, Timer>();
const names = new Map<string, string>(); // survives the grace period, unlike the socket

// ---------- helpers ----------

function send(userId: string, msg: object) {
  sockets.get(userId)?.send(JSON.stringify(msg));
}

function sendRoom(roomId: string, msg: object, except?: string) {
  for (const id of store.memberIds(roomId)) if (id !== except) send(id, msg);
}

function nameOf(userId: string) {
  return names.get(userId) ?? "?";
}

function publicStream(s: Stream) {
  return {
    id: s.id,
    roomId: s.roomId,
    sharerId: s.sharerId,
    sharerName: nameOf(s.sharerId),
    title: s.title,
    settings: s.settings,
    startedAt: s.startedAt,
    viewers: s.tree.size,
  };
}

function streamsVisibleTo(userId: string) {
  const rooms = new Set(store.roomIdsOf(userId));
  return [...streams.values()].filter((s) => rooms.has(s.roomId)).map(publicStream);
}

function onlineContacts(userId: string) {
  return store.contactsOf(userId).filter((id) => sockets.has(id));
}

function notifyRoomsChanged(userIds: Iterable<string>) {
  for (const id of userIds) send(id, { type: "rooms.changed" });
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (status: number, error: string) => json({ error }, status);

// ---------- authentication ----------
//
// Each install has an Ed25519 key pair; its fingerprint is the account. Signing in proves the
// device holds the private key (it signs a one-time challenge), so a fingerprint seen somewhere
// cannot be used to impersonate an admin or to dodge a ban.

/** Tag of the password a token was issued under; a token from an old password stops working. */
const passwordTag = PASSWORD ? new Bun.CryptoHasher("sha256").update(`screenlink-password:${PASSWORD}`).digest("hex").slice(0, 16) : null;

const isAdmin = (user: User) => ADMINS.has(user.fingerprint);

type AuthResult = { user: AuthUser } | { status: number; code: string; error: string };

function authenticate(req: Request): AuthResult {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("token");
  const user = token ? store.userByToken(token) : null;
  if (!user) return { status: 401, code: "invalid_token", error: "invalid token" };
  if (store.isBanned(user.fingerprint)) return { status: 403, code: "banned", error: "this device is banned from the server" };
  if (passwordTag && user.pwTag !== passwordTag) {
    return { status: 401, code: "password_required", error: "the server password changed; sign in again" };
  }
  return { user };
}

const deny = (r: Exclude<AuthResult, { user: AuthUser }>) => json({ error: r.error, code: r.code }, r.status);

/** Wraps a route handler so it only runs for an authenticated (and, optionally, admin) user. */
function authed<R extends Request>(fn: (req: R, user: AuthUser) => Response | Promise<Response>, adminOnly = false) {
  return (req: R) => {
    const r = authenticate(req);
    if (!("user" in r)) return deny(r);
    if (adminOnly && !isAdmin(r.user)) return fail(403, "admins only");
    return fn(req, r.user);
  };
}

const challenges = new Map<string, number>(); // nonce -> expiry
const CHALLENGE_TTL = 120_000;

function newChallenge(): string {
  const now = Date.now();
  if (challenges.size > 10_000) for (const [n, exp] of challenges) if (exp < now) challenges.delete(n);
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  challenges.set(nonce, now + CHALLENGE_TTL);
  return nonce;
}

function takeChallenge(nonce: unknown): boolean {
  if (typeof nonce !== "string") return false;
  const exp = challenges.get(nonce);
  challenges.delete(nonce);
  return exp !== undefined && exp > Date.now();
}

// Wrong passwords: at most 10 per IP every 10 minutes.
const failures = new Map<string, { count: number; until: number }>();

function tooManyFailures(ip: string) {
  const f = failures.get(ip);
  return Boolean(f && f.until > Date.now() && f.count >= 10);
}

function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 600_000 });
  else f.count++;
}

function passwordMatches(given: unknown) {
  if (!PASSWORD) return true;
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Kicks a banned user out of everything right away (no reconnect grace). */
function kick(userId: string) {
  clearTimeout(graceTimers.get(userId));
  graceTimers.delete(userId);
  const ws = sockets.get(userId);
  if (ws) {
    sockets.delete(userId);
    ws.close(4003, "banned");
  }
  disconnect(userId);
}

function cleanName(value: unknown, max = 40): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= max ? name : null;
}

// ---------- relay tree ----------

function connect(stream: Stream, parent: string, child: string) {
  const connId = crypto.randomUUID();
  stream.edges.set(child, connId);
  // The parent is the one with video, so it creates the offer.
  send(parent, { type: "relay.add", streamId: stream.id, connId, peerId: child, peerName: nameOf(child) });
  send(child, {
    type: "stream.parent",
    streamId: stream.id,
    connId,
    parentId: parent,
    parentName: nameOf(parent),
    depth: stream.tree.depthOf(child),
  });
}

function broadcastViewers(stream: Stream) {
  sendRoom(stream.roomId, { type: "stream.viewers", streamId: stream.id, viewers: stream.tree.size });
  const viewers = stream.tree.viewers().map((id) => ({
    id,
    name: nameOf(id),
    parentId: stream.tree.parentOf(id),
    depth: stream.tree.depthOf(id),
  }));
  send(stream.sharerId, { type: "stream.audience", streamId: stream.id, viewers });
}

function joinStream(stream: Stream, userId: string, capacity: number) {
  if (stream.tree.has(userId)) leaveStream(stream, userId);
  const parent = stream.tree.add(userId, Math.min(Math.max(0, capacity | 0), 8));
  connect(stream, parent, userId);
  broadcastViewers(stream);
}

function leaveStream(stream: Stream, userId: string) {
  if (!stream.tree.has(userId)) return;
  const { removed, added, depthChanged } = stream.tree.remove(userId);
  for (const edge of removed) {
    if (edge.child === userId) {
      send(edge.parent, { type: "relay.remove", streamId: stream.id, connId: stream.edges.get(userId) });
    }
  }
  stream.edges.delete(userId);
  for (const edge of added) connect(stream, edge.parent, edge.child);
  const reconnected = new Set(added.map((e) => e.child));
  for (const id of depthChanged) {
    if (!reconnected.has(id)) send(id, { type: "stream.depth", streamId: stream.id, depth: stream.tree.depthOf(id) });
  }
  broadcastViewers(stream);
}

function endStream(stream: Stream) {
  streams.delete(stream.id);
  const members = new Set(store.memberIds(stream.roomId));
  for (const id of members) send(id, { type: "stream.ended", streamId: stream.id });
  // Viewers are normally members too; this covers one removed from the room mid-stream.
  for (const id of stream.tree.viewers()) if (!members.has(id)) send(id, { type: "stream.ended", streamId: stream.id });
}

function startStream(user: User, msg: any) {
  if (!store.role(msg.roomId, user.id)) throw new Error("not a member of this room");
  for (const s of streams.values()) if (s.sharerId === user.id) endStream(s);
  const s = msg.settings ?? {};
  const settings: StreamSettings = {
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    fps: Number(s.fps) || 60,
    bitrate: Number(s.bitrate) || 8_000_000,
    codec: String(s.codec ?? "auto"),
    hint: String(s.hint ?? "motion"),
  };
  const stream: Stream = {
    id: crypto.randomUUID(),
    roomId: msg.roomId,
    sharerId: user.id,
    title: cleanName(msg.title, 80) ?? "Screen",
    settings,
    startedAt: Date.now(),
    tree: new RelayTree(user.id, Math.min(Math.max(1, Number(msg.capacity) | 0), 16), MAX_DEPTH),
    edges: new Map(),
  };
  streams.set(stream.id, stream);
  sendRoom(stream.roomId, { type: "stream.started", stream: publicStream(stream) });
  return { stream: publicStream(stream) };
}

/** Drops a user from every stream of a room (left or was removed from it). */
function dropFromRoom(roomId: string, userId: string) {
  for (const s of [...streams.values()]) {
    if (s.roomId !== roomId) continue;
    if (s.sharerId === userId) endStream(s);
    else if (s.tree.has(userId)) {
      leaveStream(s, userId);
      send(userId, { type: "stream.ended", streamId: s.id });
    }
  }
}

// ---------- WebSocket messages ----------

function handle(ws: Socket, msg: any): object | void {
  const user = ws.data.user;
  switch (msg.type) {
    case "stream.start":
      return startStream(user, msg);

    case "stream.stop": {
      const s = streams.get(msg.streamId);
      if (s && s.sharerId === user.id) endStream(s);
      return {};
    }

    case "stream.join": {
      const s = streams.get(msg.streamId);
      if (!s) throw new Error("this stream has ended");
      if (!store.role(s.roomId, user.id)) throw new Error("not a member of this room");
      if (s.sharerId === user.id) throw new Error("you are the one sharing");
      joinStream(s, user.id, Number(msg.capacity));
      return { stream: publicStream(s) };
    }

    case "stream.leave": {
      const s = streams.get(msg.streamId);
      if (s) leaveStream(s, user.id);
      return {};
    }

    case "signal": {
      // Only relays between the two ends of a live edge of the same stream.
      const s = streams.get(msg.streamId);
      if (!s) return;
      const to = String(msg.to);
      const childSide = s.edges.get(user.id) === msg.connId && s.tree.parentOf(user.id) === to;
      const parentSide = s.edges.get(to) === msg.connId && s.tree.parentOf(to) === user.id;
      if (childSide || parentSide) {
        send(to, { type: "signal", streamId: s.id, connId: msg.connId, from: user.id, data: msg.data });
      }
      return;
    }

    case "ping":
      return {};

    default:
      throw new Error(`unknown message: ${msg.type}`);
  }
}

// ---------- HTTP ----------

const server = Bun.serve({
  port: PORT,
  routes: {
    "/api/health": () => json({ ok: true, online: sockets.size, streams: streams.size }),

    "/api/info": () => json({ name: "ScreenLink", passwordRequired: Boolean(PASSWORD) }),

    "/api/config": authed(() => json({ iceServers: ICE_SERVERS })),

    "/api/challenge": () => json({ nonce: newChallenge() }),

    "/api/auth": {
      POST: async (req, server) => {
        const ip = server.requestIP(req)?.address ?? "?";
        if (tooManyFailures(ip)) return fail(429, "too many wrong passwords; try again in a few minutes");
        const body = await req.json().catch(() => ({}));
        if (!takeChallenge(body.nonce)) return fail(400, "expired challenge; try again");

        let spki: Buffer;
        try {
          spki = Buffer.from(String(body.publicKey), "base64");
          const key = createPublicKey({ key: spki, format: "der", type: "spki" });
          if (key.asymmetricKeyType !== "ed25519") throw new Error();
          const signed = Buffer.from(`screenlink-auth:${body.nonce}`);
          if (!verify(null, signed, key, Buffer.from(String(body.signature), "base64"))) throw new Error();
        } catch {
          return fail(400, "invalid device signature");
        }

        const fingerprint = fingerprintOf(spki);
        if (store.isBanned(fingerprint)) return json({ error: "this device is banned from the server", code: "banned" }, 403);
        if (!passwordMatches(body.password)) {
          recordFailure(ip);
          return json({ error: "wrong server password", code: "wrong_password" }, 401);
        }
        const name = body.name == null || body.name === "" ? null : cleanName(body.name);
        if (body.name && !name) return fail(400, "name must be up to 40 characters");
        const result = store.signIn(fingerprint, spki.toString("base64"), name, passwordTag);
        if (!result) return json({ error: "choose a name for your new account", code: "name_required" }, 400);
        notifyRoomsChanged(store.contactsOf(result.user.id));
        names.set(result.user.id, result.user.name);
        return json({ ...result, admin: isAdmin(result.user) });
      },
    },

    "/api/me": {
      GET: authed((_req, user) => json({ id: user.id, name: user.name, fingerprint: user.fingerprint, admin: isAdmin(user) })),
      PATCH: authed(async (req, user) => {
        const name = cleanName((await req.json().catch(() => ({}))).name);
        if (!name) return fail(400, "name is required (up to 40 characters)");
        store.renameUser(user.id, name);
        const ws = sockets.get(user.id);
        if (ws) ws.data.user = { ...user, name };
        names.set(user.id, name);
        notifyRoomsChanged(store.contactsOf(user.id));
        return json({ id: user.id, name, fingerprint: user.fingerprint, admin: isAdmin(user) });
      }),
    },

    "/api/rooms": {
      GET: authed((_req, user) => json(store.roomsOf(user.id))),
      POST: authed(async (req, user) => {
        const name = cleanName((await req.json().catch(() => ({}))).name, 60);
        if (!name) return fail(400, "room name is required (up to 60 characters)");
        const id = store.createRoom(user.id, name);
        notifyRoomsChanged([user.id]);
        return json({ id });
      }),
    },

    "/api/rooms/join": {
      POST: authed(async (req, user) => {
        const { code } = await req.json().catch(() => ({}));
        const room = typeof code === "string" ? store.roomByCode(code) : null;
        if (!room) return fail(404, "no room with this invite code");
        store.addMember(room.id, user.id);
        notifyRoomsChanged(store.memberIds(room.id));
        for (const id of store.memberIds(room.id)) {
          if (id !== user.id && sockets.has(id)) send(id, { type: "presence", userId: user.id, online: true });
        }
        for (const s of streams.values()) {
          if (s.roomId === room.id) send(user.id, { type: "stream.started", stream: publicStream(s), quiet: true });
        }
        return json({ id: room.id });
      }),
    },

    "/api/rooms/:id/leave": {
      POST: authed((req, user) => {
        const roomId = req.params.id;
        const role = store.role(roomId, user.id);
        if (!role) return fail(404, "not a member of this room");
        const members = store.memberIds(roomId);
        dropFromRoom(roomId, user.id);
        // The owner leaving would leave the room unmanageable, so it goes away with them.
        if (role === "owner") {
          for (const s of [...streams.values()]) if (s.roomId === roomId) endStream(s);
          store.deleteRoom(roomId);
        } else store.removeMember(roomId, user.id);
        notifyRoomsChanged(members);
        return json({});
      }),
    },

    "/api/rooms/:id": {
      DELETE: authed((req, user) => {
        const roomId = req.params.id;
        if (store.role(roomId, user.id) !== "owner") return fail(403, "only the owner can delete the room");
        const members = store.memberIds(roomId);
        for (const s of [...streams.values()]) if (s.roomId === roomId) endStream(s);
        store.deleteRoom(roomId);
        notifyRoomsChanged(members);
        return json({});
      }),
    },

    "/api/rooms/:id/code": {
      POST: authed((req, user) => {
        const roomId = req.params.id;
        if (store.role(roomId, user.id) !== "owner") return fail(403, "only the owner can change the invite code");
        const inviteCode = store.regenerateCode(roomId);
        notifyRoomsChanged(store.memberIds(roomId));
        return json({ inviteCode });
      }),
    },

    "/api/rooms/:id/members/:userId": {
      DELETE: authed((req, user) => {
        const { id: roomId, userId } = req.params;
        if (store.role(roomId, user.id) !== "owner") return fail(403, "only the owner can remove members");
        if (userId === user.id) return fail(400, "the owner cannot remove themselves; delete the room instead");
        const members = store.memberIds(roomId);
        dropFromRoom(roomId, userId);
        store.removeMember(roomId, userId);
        notifyRoomsChanged(members);
        return json({});
      }),
    },

    // ---------- admin: users, rooms and bans; never stream content or invite codes ----------

    "/api/admin/overview": authed(() => {
      const users = store.adminUsers().map((u) => ({
        ...u,
        banned: Boolean(u.banned),
        online: sockets.has(u.id),
        admin: ADMINS.has(u.fingerprint),
      }));
      const rooms = store.adminRooms().map((r) => ({
        ...r,
        live: [...streams.values()]
          .filter((s) => s.roomId === r.id)
          .map((s) => ({ sharerName: nameOf(s.sharerId), viewers: s.tree.size, startedAt: s.startedAt })),
      }));
      return json({
        users,
        rooms,
        bans: store.bans(),
        stats: { users: users.length, online: sockets.size, rooms: rooms.length, streams: streams.size },
      });
    }, true),

    "/api/admin/bans": {
      POST: authed(async (req, admin) => {
        const body = await req.json().catch(() => ({}));
        const fingerprint = normalizeFingerprint(String(body.fingerprint ?? ""));
        if (!fingerprint) return fail(400, "invalid fingerprint (32 hex digits)");
        if (ADMINS.has(fingerprint) || fingerprint === admin.fingerprint) return fail(400, "admins cannot be banned");
        store.ban(fingerprint, cleanName(body.reason, 200) ?? "");
        const user = store.userByFingerprint(fingerprint);
        if (user) kick(user.id);
        return json({});
      }, true),
    },

    "/api/admin/bans/:fingerprint": {
      DELETE: authed((req) => {
        store.unban(normalizeFingerprint(req.params.fingerprint));
        return json({});
      }, true),
    },

    "/api/admin/rooms/:id": {
      DELETE: authed((req) => {
        const roomId = req.params.id;
        const members = store.memberIds(roomId);
        for (const s of [...streams.values()]) if (s.roomId === roomId) endStream(s);
        store.deleteRoom(roomId);
        notifyRoomsChanged(members);
        return json({});
      }, true),
    },
  },

  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      const r = authenticate(req);
      if (!("user" in r)) return deny(r);
      return server.upgrade(req, { data: { user: r.user } }) ? undefined : fail(400, "websocket upgrade failed");
    }
    return fail(404, "not found");
  },

  websocket: {
    data: {} as { user: AuthUser },
    idleTimeout: 60,
    open(ws) {
      const { user } = ws.data;
      names.set(user.id, user.name);
      store.touch(user.id);
      const returning = graceTimers.has(user.id) || sockets.has(user.id);
      clearTimeout(graceTimers.get(user.id));
      graceTimers.delete(user.id);
      // One connection per account: a new one (e.g. after a reconnect) takes over the old one
      // and everything it was doing.
      const previous = sockets.get(user.id);
      sockets.set(user.id, ws);
      previous?.close(4000, "replaced by a new connection");
      const mine = [...streams.values()];
      ws.send(
        JSON.stringify({
          type: "hello",
          user: { id: user.id, name: user.name, fingerprint: user.fingerprint, admin: isAdmin(user) },
          online: onlineContacts(user.id),
          streams: streamsVisibleTo(user.id),
          sharing: mine.find((s) => s.sharerId === user.id)?.id ?? null,
          watching: mine.filter((s) => s.tree.has(user.id) && s.sharerId !== user.id).map((s) => s.id),
        }),
      );
      if (!returning) {
        for (const id of store.contactsOf(user.id)) {
          if (id !== user.id) send(id, { type: "presence", userId: user.id, online: true });
        }
      }
    },
    message(ws, raw) {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        const result = handle(ws, msg);
        if (msg.reqId !== undefined) ws.send(JSON.stringify({ type: "reply", reqId: msg.reqId, ok: true, ...result }));
      } catch (err) {
        if (msg.reqId !== undefined) {
          ws.send(JSON.stringify({ type: "reply", reqId: msg.reqId, ok: false, error: (err as Error).message }));
        }
      }
    },
    close(ws) {
      const userId = ws.data.user.id;
      if (sockets.get(userId) !== ws) return;
      store.touch(userId);
      sockets.delete(userId);
      graceTimers.set(
        userId,
        setTimeout(() => {
          graceTimers.delete(userId);
          if (!sockets.has(userId)) disconnect(userId);
        }, GRACE_MS),
      );
    },
  },
});

function disconnect(userId: string) {
  for (const s of [...streams.values()]) {
    if (s.sharerId === userId) endStream(s);
    else leaveStream(s, userId);
  }
  for (const id of store.contactsOf(userId)) if (id !== userId) send(id, { type: "presence", userId, online: false });
}

console.log(`ScreenLink server on http://localhost:${server.port} (db: ${DB_FILE})`);
console.log(`  password: ${PASSWORD ? "required" : "none (anyone with the app can sign up)"} · admins: ${ADMINS.size}`);
