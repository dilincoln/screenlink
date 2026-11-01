// Builds the demo database the video's app screens come from.
//
//   bun video/pt-br/mock/seed.ts
//
// It goes through the server's own Store (server/db.ts), so the file has exactly the schema the
// real server uses: `DB_FILE=video/pt-br/mock/screenlink-demo.sqlite bun run server` opens it.
// Accounts are normally tied to a device key; here each mock user gets a made-up public key and a
// fingerprint derived from it the same way the server derives real ones.
//
// What a database cannot hold (who is online, who is live, who watches through whom) is in-memory
// state on a real server. That part lives in `live.ts` and is merged in by `state.ts`.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fingerprintOf, Store } from "../../../server/db.ts";
import { ROOMS, USERS } from "./data.ts";

const FILE = join(import.meta.dir, "screenlink-demo.sqlite");

for (const suffix of ["", "-shm", "-wal"]) {
  const path = `${FILE}${suffix}`;
  if (existsSync(path)) rmSync(path);
}

const store = new Store(FILE);

// Deterministic fake device keys: the same seed always gives the same fingerprints, so the
// screenshots do not change between runs.
const ids = new Map<string, string>();
for (const user of USERS) {
  const publicKey = Buffer.from(`screenlink-demo-device:${user.key}`).toString("base64");
  const fingerprint = fingerprintOf(new TextEncoder().encode(publicKey));
  const { user: created } = store.signIn(fingerprint, publicKey, user.name, null)!;
  // Stable ids too: avatar colours in the app are a hash of the user id.
  store.db.query("UPDATE users SET id = ? WHERE id = ?").run(user.key, created.id);
  store.touch(user.key);
  ids.set(user.key, user.key);
}

let clock = Date.UTC(2026, 9, 1, 20, 0, 0);
for (const room of ROOMS) {
  const roomId = store.createRoom(room.owner, room.name);
  // Fixed ids, codes and dates so the order of rooms and members is the one written in data.ts.
  // The owner's membership row points at the random id, so move both with the key check paused.
  store.db.exec("PRAGMA foreign_keys = OFF");
  store.db.query("UPDATE rooms SET id = ?, invite_code = ?, created_at = ? WHERE id = ?").run(room.id, room.code, (clock += 60_000), roomId);
  store.db.query("UPDATE members SET room_id = ?, joined_at = ? WHERE room_id = ?").run(room.id, clock, roomId);
  store.db.exec("PRAGMA foreign_keys = ON");
  for (const member of room.members) {
    store.addMember(room.id, member);
    store.db.query("UPDATE members SET joined_at = ? WHERE room_id = ? AND user_id = ?").run((clock += 1_000), room.id, member);
  }
}

const users = store.adminUsers();
const rooms = store.adminRooms();
console.log(`${FILE}`);
console.log(`${users.length} users, ${rooms.length} rooms`);
for (const r of rooms) console.log(`  ${r.name.padEnd(22)} ${String(r.members).padStart(2)} members, owner ${r.ownerName}`);
store.db.close();
