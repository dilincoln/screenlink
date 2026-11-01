// Builds the exact `state` object the app's UI window receives from the main process
// (client/main.js `snapshot()`), for one shot: rooms and members read from the demo SQLite
// through the server's Store, live data from live.ts.

import { join } from "node:path";
import { Store } from "../../../server/db.ts";
import { SHARE_DEFAULTS, SHOTS } from "./live.ts";

const FILE = join(import.meta.dir, "screenlink-demo.sqlite");

export function stateFor(shotName: string) {
  const shot = SHOTS[shotName];
  if (!shot) throw new Error(`unknown shot ${shotName}`);
  const store = new Store(FILE);
  try {
    const me = store.db
      .query<{ id: string; name: string; fingerprint: string }, [string]>("SELECT id, name, fingerprint FROM users WHERE id = ?")
      .get(shot.me);
    if (!me) throw new Error(`no user ${shot.me}: run seed.ts first`);
    const rooms = store.roomsOf(me.id);
    const visible = new Set(rooms.map((r) => r.id));
    return {
      selectedRoom: shot.room,
      state: {
        connection: "online",
        serverUrl: "https://screenlink.seuservidor.com.br",
        registered: true,
        authError: null,
        fingerprint: me.fingerprint,
        isAdmin: false,
        user: { ...me, admin: false },
        rooms,
        online: shot.online,
        streams: shot.streams.filter((s: any) => visible.has(s.roomId)),
        sharing: shot.sharing ?? null,
        watching: shot.watching ?? [],
        settings: {
          relayCapacity: 2,
          notifications: "popup",
          soundVolume: 60,
          autostart: true,
          theme: "dark",
          share: SHARE_DEFAULTS,
          quietHours: { enabled: false, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },
        },
        portalPicker: false,
        dark: true,
        update: null,
        popupPlaceable: true,
        mute: { muted: false, manual: null, quietUntil: null },
      },
    };
  } finally {
    store.db.close();
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(stateFor(process.argv[2] ?? "lucas-room"), null, 2));
}
