import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { fingerprintOf } from "./db";

const PORT = 41000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;

type Device = { privateKey: KeyObject; publicKey: string; fingerprint: string };

function device(): Device {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  return { privateKey: pair.privateKey, publicKey: der.toString("base64"), fingerprint: fingerprintOf(der) };
}

const admin = device();
let server: ReturnType<typeof Bun.spawn>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function signIn(d: Device, name: string | null, password: string, nonceOverride?: string) {
  const { body } = await call("GET", "/api/challenge");
  const signature = sign(null, Buffer.from(`screenlink-auth:${body.nonce}`), d.privateKey).toString("base64");
  return call("POST", "/api/auth", { name, password, publicKey: d.publicKey, nonce: nonceOverride ?? body.nonce, signature });
}

beforeAll(async () => {
  server = Bun.spawn(["bun", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ":memory:", SERVER_PASSWORD: "hunter2", ADMIN_FINGERPRINT: admin.fingerprint.toLowerCase() },
    stdout: "ignore",
    stderr: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/api/info`).then((r) => r.ok, () => false)) return;
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
});

afterAll(() => server.kill());

describe("device sign-in", () => {
  test("the server says a password is needed", async () => {
    expect((await call("GET", "/api/info")).body.passwordRequired).toBe(true);
  });

  test("wrong password is refused", async () => {
    const r = await signIn(device(), "Eve", "nope");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("wrong_password");
  });

  test("a signature from another key is refused", async () => {
    const victim = device();
    const attacker = device();
    const { body } = await call("GET", "/api/challenge");
    const signature = sign(null, Buffer.from(`screenlink-auth:${body.nonce}`), attacker.privateKey).toString("base64");
    const r = await call("POST", "/api/auth", { name: "Eve", password: "hunter2", publicKey: victim.publicKey, nonce: body.nonce, signature });
    expect(r.status).toBe(400);
  });

  test("a challenge cannot be reused", async () => {
    const d = device();
    const { body } = await call("GET", "/api/challenge");
    const signature = sign(null, Buffer.from(`screenlink-auth:${body.nonce}`), d.privateKey).toString("base64");
    const payload = { name: "Bob", password: "hunter2", publicKey: d.publicKey, nonce: body.nonce, signature };
    expect((await call("POST", "/api/auth", payload)).status).toBe(200);
    expect((await call("POST", "/api/auth", payload)).status).toBe(400);
  });

  test("signing in again from the same device returns the same account", async () => {
    const d = device();
    const first = await signIn(d, "Carol", "hunter2");
    const second = await signIn(d, null, "hunter2");
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.name).toBe("Carol");
    // The old token is replaced by the new one.
    expect((await call("GET", "/api/me", undefined, first.body.token)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, second.body.token)).status).toBe(200);
  });

  test("a new device needs a name", async () => {
    expect((await signIn(device(), null, "hunter2")).body.code).toBe("name_required");
  });
});

describe("admin", () => {
  test("only ADMIN_FINGERPRINT devices see the overview, without invite codes", async () => {
    const a = await signIn(admin, "Diego", "hunter2");
    expect(a.body.admin).toBe(true);
    const u = await signIn(device(), "Dave", "hunter2");
    expect(u.body.admin).toBe(false);
    await call("POST", "/api/rooms", { name: "Private" }, u.body.token);

    expect((await call("GET", "/api/admin/overview", undefined, u.body.token)).status).toBe(403);
    const overview = await call("GET", "/api/admin/overview", undefined, a.body.token);
    expect(overview.status).toBe(200);
    const room = overview.body.rooms.find((r: any) => r.name === "Private");
    expect(room.ownerName).toBe("Dave");
    expect(room.inviteCode).toBeUndefined();
    expect(overview.body.users.some((x: any) => x.fingerprint === admin.fingerprint && x.admin)).toBe(true);
  });

  test("a banned device is cut off and cannot sign in again until unbanned", async () => {
    const a = await signIn(admin, null, "hunter2");
    const d = device();
    const u = await signIn(d, "Mallory", "hunter2");

    expect((await call("POST", "/api/admin/bans", { fingerprint: d.fingerprint, reason: "spam" }, a.body.token)).status).toBe(200);
    const me = await call("GET", "/api/me", undefined, u.body.token);
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("banned");
    expect((await signIn(d, null, "hunter2")).body.code).toBe("banned");

    const bans = (await call("GET", "/api/admin/overview", undefined, a.body.token)).body.bans;
    expect(bans[0]).toMatchObject({ fingerprint: d.fingerprint, reason: "spam", userName: "Mallory" });

    await call("DELETE", `/api/admin/bans/${d.fingerprint}`, undefined, a.body.token);
    expect((await signIn(d, null, "hunter2")).status).toBe(200);
  });

  test("admins cannot be banned and non-admins cannot ban", async () => {
    const a = await signIn(admin, null, "hunter2");
    expect((await call("POST", "/api/admin/bans", { fingerprint: admin.fingerprint }, a.body.token)).status).toBe(400);
    const u = await signIn(device(), "Trent", "hunter2");
    expect((await call("POST", "/api/admin/bans", { fingerprint: device().fingerprint }, u.body.token)).status).toBe(403);
  });
});
