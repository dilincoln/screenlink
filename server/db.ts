import { Database } from "bun:sqlite";

export type User = { id: string; name: string; fingerprint: string };
export type AuthUser = User & { pwTag: string | null };
export type Member = User & { role: "owner" | "member" };
export type Room = { id: string; name: string; ownerId: string; inviteCode: string; members: Member[] };

// Invite codes avoid look-alike characters (0/O, 1/I/L) so they survive being read out loud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export function normalizeCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 12 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}` : clean;
}

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** Device fingerprint: the first 128 bits of SHA-256(public key, SPKI DER), as XXXX-XXXX-…. */
export function fingerprintOf(spkiDer: Uint8Array): string {
  const hex = new Bun.CryptoHasher("sha256").update(spkiDer).digest("hex").toUpperCase().slice(0, 32);
  return hex.match(/.{4}/g)!.join("-");
}

export function normalizeFingerprint(value: string): string {
  const hex = value.toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.length === 32 ? hex.match(/.{4}/g)!.join("-") : "";
}

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export class Store {
  db: Database;

  constructor(file: string) {
    this.db = new Database(file, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invite_code TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS members_by_user ON members(user_id);
      CREATE TABLE IF NOT EXISTS bans (
        fingerprint TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
    `);
    // Columns added after the first version. Users without a fingerprint (created before device
    // keys existed) can no longer authenticate and simply sign in again as a new account.
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(users)").all().map((c) => c.name);
    for (const [name, type] of [["fingerprint", "TEXT"], ["public_key", "TEXT"], ["pw_tag", "TEXT"], ["last_seen", "INTEGER"]]) {
      if (!columns.includes(name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_by_fingerprint ON users(fingerprint)");
  }

  /**
   * Signs a device in: the account is tied to the device key, so signing in again from the same
   * device returns the same account (with a fresh token). Returns null when a new account would
   * be needed but no name was given.
   */
  signIn(fingerprint: string, publicKey: string, name: string | null, pwTag: string | null): { user: User; token: string } | null {
    const token = newToken();
    const existing = this.db
      .query<User, [string]>("SELECT id, name, fingerprint FROM users WHERE fingerprint = ?")
      .get(fingerprint);
    if (existing) {
      const user = { ...existing, name: name ?? existing.name };
      this.db
        .query("UPDATE users SET name = ?, token_hash = ?, pw_tag = ? WHERE id = ?")
        .run(user.name, hashToken(token), pwTag, user.id);
      return { user, token };
    }
    if (!name) return null;
    const user = { id: crypto.randomUUID(), name, fingerprint };
    this.db
      .query(
        "INSERT INTO users (id, name, token_hash, created_at, fingerprint, public_key, pw_tag) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(user.id, name, hashToken(token), Date.now(), fingerprint, publicKey, pwTag);
    return { user, token };
  }

  userByToken(token: string): AuthUser | null {
    return this.db
      .query<AuthUser, [string]>(
        "SELECT id, name, fingerprint, pw_tag AS pwTag FROM users WHERE token_hash = ? AND fingerprint IS NOT NULL",
      )
      .get(hashToken(token));
  }

  userByFingerprint(fingerprint: string): User | null {
    return this.db.query<User, [string]>("SELECT id, name, fingerprint FROM users WHERE fingerprint = ?").get(fingerprint);
  }

  touch(userId: string) {
    this.db.query("UPDATE users SET last_seen = ? WHERE id = ?").run(Date.now(), userId);
  }

  // ---------- bans ----------

  isBanned(fingerprint: string): boolean {
    return Boolean(this.db.query("SELECT 1 FROM bans WHERE fingerprint = ?").get(fingerprint));
  }

  ban(fingerprint: string, reason: string) {
    this.db
      .query("INSERT INTO bans (fingerprint, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET reason = excluded.reason")
      .run(fingerprint, reason, Date.now());
  }

  unban(fingerprint: string) {
    this.db.query("DELETE FROM bans WHERE fingerprint = ?").run(fingerprint);
  }

  // ---------- admin views ----------

  adminUsers() {
    return this.db
      .query<{ id: string; name: string; fingerprint: string; createdAt: number; lastSeen: number | null; rooms: number; banned: number }, []>(
        `SELECT u.id, u.name, u.fingerprint, u.created_at AS createdAt, u.last_seen AS lastSeen,
                (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS rooms,
                EXISTS (SELECT 1 FROM bans b WHERE b.fingerprint = u.fingerprint) AS banned
         FROM users u WHERE u.fingerprint IS NOT NULL ORDER BY u.created_at`,
      )
      .all();
  }

  adminRooms() {
    // No invite codes here on purpose: the admin manages the server, not other people's rooms.
    return this.db
      .query<{ id: string; name: string; ownerId: string; ownerName: string; createdAt: number; members: number }, []>(
        `SELECT r.id, r.name, r.owner_id AS ownerId, u.name AS ownerName, r.created_at AS createdAt,
                (SELECT COUNT(*) FROM members m WHERE m.room_id = r.id) AS members
         FROM rooms r JOIN users u ON u.id = r.owner_id ORDER BY r.created_at`,
      )
      .all();
  }

  bans() {
    return this.db
      .query<{ fingerprint: string; reason: string; createdAt: number; userName: string | null }, []>(
        `SELECT b.fingerprint, b.reason, b.created_at AS createdAt, u.name AS userName
         FROM bans b LEFT JOIN users u ON u.fingerprint = b.fingerprint ORDER BY b.created_at DESC`,
      )
      .all();
  }

  renameUser(id: string, name: string) {
    this.db.query("UPDATE users SET name = ? WHERE id = ?").run(name, id);
  }

  createRoom(ownerId: string, name: string): string {
    const id = crypto.randomUUID();
    this.db.transaction(() => {
      this.db
        .query("INSERT INTO rooms (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, name, ownerId, newInviteCode(), Date.now());
      this.db
        .query("INSERT INTO members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .run(id, ownerId, Date.now());
    })();
    return id;
  }

  roomByCode(code: string): { id: string } | null {
    return this.db.query<{ id: string }, [string]>("SELECT id FROM rooms WHERE invite_code = ?").get(normalizeCode(code));
  }

  addMember(roomId: string, userId: string) {
    this.db
      .query("INSERT OR IGNORE INTO members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .run(roomId, userId, Date.now());
  }

  removeMember(roomId: string, userId: string) {
    this.db.query("DELETE FROM members WHERE room_id = ? AND user_id = ?").run(roomId, userId);
  }

  deleteRoom(roomId: string) {
    this.db.query("DELETE FROM rooms WHERE id = ?").run(roomId);
  }

  regenerateCode(roomId: string): string {
    const code = newInviteCode();
    this.db.query("UPDATE rooms SET invite_code = ? WHERE id = ?").run(code, roomId);
    return code;
  }

  role(roomId: string, userId: string): "owner" | "member" | null {
    const row = this.db
      .query<{ role: "owner" | "member" }, [string, string]>("SELECT role FROM members WHERE room_id = ? AND user_id = ?")
      .get(roomId, userId);
    return row?.role ?? null;
  }

  memberIds(roomId: string): string[] {
    return this.db
      .query<{ user_id: string }, [string]>("SELECT user_id FROM members WHERE room_id = ?")
      .all(roomId)
      .map((r) => r.user_id);
  }

  roomIdsOf(userId: string): string[] {
    return this.db
      .query<{ room_id: string }, [string]>("SELECT room_id FROM members WHERE user_id = ?")
      .all(userId)
      .map((r) => r.room_id);
  }

  /** Everyone who shares at least one room with the user (the user included). */
  contactsOf(userId: string): string[] {
    return this.db
      .query<{ user_id: string }, [string]>(
        "SELECT DISTINCT m.user_id FROM members m JOIN members me ON me.room_id = m.room_id WHERE me.user_id = ?",
      )
      .all(userId)
      .map((r) => r.user_id);
  }

  roomsOf(userId: string): Room[] {
    const rooms = this.db
      .query<{ id: string; name: string; ownerId: string; inviteCode: string }, [string]>(
        `SELECT r.id, r.name, r.owner_id AS ownerId, r.invite_code AS inviteCode
         FROM rooms r JOIN members m ON m.room_id = r.id
         WHERE m.user_id = ? ORDER BY r.created_at`,
      )
      .all(userId);
    const members = this.db.query<Member, [string]>(
      `SELECT u.id, u.name, u.fingerprint, m.role FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? ORDER BY m.role DESC, m.joined_at`,
    );
    return rooms.map((r) => ({ ...r, members: members.all(r.id) }));
  }
}
