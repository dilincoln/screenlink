// What the server keeps in memory (who is online, who is live, the relay tree) for each shot of
// the video, plus the app's own client state. Merged with the rooms in SQLite by state.ts.

import type { UserKey } from "./data.ts";

export const SHARE_DEFAULTS = {
  resolution: "1080",
  fps: 60,
  codec: "h264",
  hint: "motion",
  capacity: 3,
  audio: true,
  bitrate: 12e6,
};

const GAME = { width: 1920, height: 1080, fps: 60, bitrate: 12e6, codec: "h264", audio: true, resolution: "1080", hint: "motion", capacity: 3 };

export const FIGHT_STREAM = {
  id: "s-fight",
  roomId: "r-jogatina",
  sharerId: "u-lucas",
  sharerName: "Lucas",
  title: "Treta em Brasília",
  settings: GAME,
  startedAt: Date.UTC(2026, 9, 2, 23, 40),
  viewers: 5,
};

const MINECRAFT_STREAM = {
  id: "s-mine",
  roomId: "r-minecraft",
  sharerId: "u-caio",
  sharerName: "Caio",
  title: "Base nova",
  settings: { ...GAME, fps: 30, bitrate: 8e6 },
  startedAt: Date.UTC(2026, 9, 2, 23, 10),
  viewers: 3,
};

const SLIDES_STREAM = {
  id: "s-tcc",
  roomId: "r-tcc",
  sharerId: "u-gabi",
  sharerName: "Gabi",
  title: "Slides — apresentação final",
  settings: { ...GAME, fps: 30, bitrate: 6e6, hint: "detail", audio: false },
  startedAt: Date.UTC(2026, 9, 2, 19, 0),
  viewers: 3,
};

export type Shot = {
  me: UserKey;
  room: string;
  online: UserKey[];
  streams: object[];
  sharing?: object;
  watching?: string[];
};

const FRIENDS_ONLINE: UserKey[] = ["u-bia", "u-rafa", "u-duda", "u-thiago", "u-japa", "u-caio", "u-gabi", "u-nanda"];

export const SHOTS: Record<string, Shot> = {
  // Lucas's app before he shares: his room, friends online, someone live elsewhere.
  "lucas-room": { me: "u-lucas", room: "r-jogatina", online: FRIENDS_ONLINE, streams: [MINECRAFT_STREAM] },

  // Lucas while sharing: his stream card shows the encoder and who watches through whom.
  "lucas-sharing": {
    me: "u-lucas",
    room: "r-jogatina",
    online: FRIENDS_ONLINE,
    streams: [FIGHT_STREAM, MINECRAFT_STREAM],
    sharing: {
      streamId: FIGHT_STREAM.id,
      roomId: FIGHT_STREAM.roomId,
      title: FIGHT_STREAM.title,
      settings: GAME,
      audience: [
        { id: "u-bia", name: "Bia", depth: 1, parentId: "u-lucas" },
        { id: "u-rafa", name: "Rafa", depth: 1, parentId: "u-lucas" },
        { id: "u-duda", name: "Duda", depth: 1, parentId: "u-lucas" },
        { id: "u-thiago", name: "Thiago", depth: 2, parentId: "u-bia" },
        { id: "u-japa", name: "Japa", depth: 2, parentId: "u-rafa" },
      ],
      encoder: {
        encoder: "VA-API H.264 (hardware)",
        powerEfficient: true,
        codec: "H264",
        width: 1920,
        height: 1080,
        fps: 60,
        encodeMs: 2.8,
        direct: 3,
        limitedBy: "none",
      },
    },
  },

  // Bia's app the moment Lucas goes live.
  "bia-room": { me: "u-bia", room: "r-jogatina", online: ["u-lucas", ...FRIENDS_ONLINE.filter((u) => u !== "u-bia")], streams: [FIGHT_STREAM] },

  // The study group: Gabi presents the slides.
  "lucas-tcc": { me: "u-lucas", room: "r-tcc", online: FRIENDS_ONLINE, streams: [SLIDES_STREAM, MINECRAFT_STREAM], watching: [SLIDES_STREAM.id] },
};
