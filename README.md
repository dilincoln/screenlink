# ScreenLink

Low-latency screen sharing between friends. A tray app where you create rooms, hand out an invite
code (ZeroTier style), and when someone in the room starts sharing, every member online gets a
popup and can watch.

- **Server** — Bun + SQLite (`bun:sqlite`). Accounts, rooms, invite codes, and WebSocket
  signaling. **Video never touches the server.**
- **Client** — Electron tray app. Screen/window picker, resolution, frame rate, bitrate, codec.

## Download

Installers are on the [Releases](https://github.com/dilincoln/screenlink/releases) page:

- **Windows**: `ScreenLink-x.y.z-win-setup.exe` (installer) or `-win-portable.exe` (no install).
  The builds are not code-signed, so SmartScreen asks for confirmation on first run
  (*More info → Run anyway*).
- **Linux**: `.AppImage` (needs FUSE 2: `fuse2` on Arch, `libfuse2` on Debian/Ubuntu), `.deb`,
  or `.pacman` (`sudo pacman -U ScreenLink-*.pacman`).

To publish a new version, push a tag: `git tag v0.2.0 && git push origin v0.2.0`. The
[Release workflow](.github/workflows/release.yml) runs the tests, builds Linux and Windows with
that version and creates the release. `bun run dist` builds locally into `dist/`.

## Running

```sh
bun install
bun run server          # http://localhost:3000, database in ./screenlink.sqlite
bun run start           # the tray app (run on every machine)
bun test                # relay tree + auth/admin tests
```

### Deploying the server (Docker / Coolify)

`docker-compose.yml` works as-is on [Coolify](https://coolify.io): create a resource from this
repository with the *Docker Compose* build pack, set `SERVER_PASSWORD` (required) and optionally
`ADMIN_FINGERPRINT` in the Environment Variables tab, and deploy. Coolify assigns a domain with
HTTPS (`SERVICE_FQDN_SCREENLINK_3000`) and proxies WebSockets; the database lives in the
`screenlink-data` volume. In the app, use the `https://` URL as the server.

Without Coolify:

```sh
docker build -t screenlink .
docker run -d -p 3000:3000 -e SERVER_PASSWORD=change-me -v screenlink-data:/data screenlink
```

Server environment variables:

| Variable              | Default                     | Meaning                                                   |
| --------------------- | --------------------------- | --------------------------------------------------------- |
| `PORT`                | `3000`                      | HTTP/WebSocket port                                        |
| `DB_FILE`             | `screenlink.sqlite`         | SQLite file                                                |
| `ICE_SERVERS`         | Google STUN                 | JSON array of `RTCIceServer`; add a TURN server here       |
| `MAX_RELAY_DEPTH`     | `4`                         | Max hops between the sharer and the farthest viewer        |
| `RECONNECT_GRACE_MS`  | `20000`                     | How long a dropped client keeps its place in streams       |
| `SERVER_PASSWORD`     | none                        | Shared password needed to sign in; changing it signs everyone out |
| `ADMIN_FINGERPRINT`   | none                        | Comma-separated device fingerprints with the admin view    |

Start the client hidden in the tray with `--hidden` (the "Start with the system" setting does this).

## Accounts, password and admin

There are no usernames or passwords per person. Each install creates an **Ed25519 key pair** on
first run (`identity.json` in the app's data folder); the account *is* the device. The
**fingerprint** is the first 128 bits of SHA-256 of the public key, shown in the app with **F12**.

- Signing in = signing a one-time challenge from the server with the device key. A fingerprint
  seen in a screenshot or log is useless without that key, so it cannot be used to impersonate an
  admin or to dodge a ban.
- Signing out and back in on the same device returns the same account and rooms.
- `SERVER_PASSWORD` gates signing in, so without it nobody can create or join rooms, share, or
  watch. Each token remembers which password it was issued under, so changing the password signs
  everyone out until they type the new one. Wrong passwords are limited to 10 per IP every 10 minutes.
- Devices listed in `ADMIN_FINGERPRINT` get an **Admin** view: every user (fingerprint, rooms,
  last seen, online), every room (owner, member count, who is live), and bans. Banning a
  fingerprint disconnects that device immediately and stops it from signing in. Banning works
  for fingerprints that never signed in, too.
- The admin view **does not show invite codes or stream titles**: being admin manages who uses
  the server, but gives no way into rooms you are not a member of.
- Limitation: a banned person can delete `identity.json` and get a new fingerprint. The server
  password is what stops them from simply signing in again — change it if that happens.

## How the relay works

A server that forwards video (an SFU) pays for every viewer in upload bandwidth and CPU. Plain
peer-to-peer makes the sharer pay instead: 10 viewers at 12 Mbps is 120 Mbps of upload. ScreenLink
builds a **relay tree**:

```
            sharer
           /  |   \          sharer serves up to "Direct viewers" peers (default 3)
         v1   v2   v3
        /  \   |             viewers forward to up to "Relay for others" peers (default 2)
      v4   v5  v6
```

- The server only decides who connects to whom (`server/tree.ts`): each new viewer goes under the
  shallowest node with a free slot, within `MAX_RELAY_DEPTH`.
- When a relay leaves, its children are re-attached elsewhere **with their own subtrees**; only
  the moved edges reconnect.
- If no slot is free, the sharer takes the extra viewer rather than leaving them without video.
- Each edge is a normal WebRTC connection (offer from parent, answer from child), so NAT traversal
  is plain STUN/ICE. Peers behind symmetric NAT need a TURN server in `ICE_SERVERS`.

The cost: a relaying viewer **decodes and re-encodes** the video (browsers cannot forward encoded
frames to another connection), which adds a few ms per hop and an encoder on that machine. That
is why the depth is capped and relaying can be turned off per client.

## Latency (the Parsec-ish part)

Parsec uses its own UDP protocol and hardware encoders. Within WebRTC, the closest equivalents are:

- **Hardware encode/decode**: H.264 is preferred by default; VA-API is enabled on Linux. The
  sharer's room card shows which encoder is actually in use (e.g. `OpenH264 (software)` vs a
  hardware one) and whether quality is limited by CPU or bandwidth.
- **No playout buffering**: `jitterBufferTarget = 0` on the receiver and Chrome's
  `WebRTC-ZeroPlayoutDelay` field trial (the same trick Chrome Remote Desktop uses).
- **Starts sharp**: SDP hints (`x-google-start-bitrate`) start near the target bitrate instead of
  ramping up from ~300 kbps.
- **Capture-side scaling** (keeps the aspect ratio) instead of capturing full-size and shrinking.
- **"Optimize for"**: *Motion* keeps the frame rate (drops resolution under pressure); *Detail*
  keeps text sharp (drops frames).
- Viewer windows press `I` for live stats (fps, bitrate, decode time, jitter buffer, RTT, hop),
  `O` for 1:1 pixels, double-click/F11 for fullscreen.

## Sounds

Played from a hidden window (`client/sound/`), since the main process cannot play audio and the
UI window may not exist when the app starts hidden. Volume is in Settings (0 mutes).

| Sound (`client/assets/`) | Who hears it                                            |
| ------------------------ | ------------------------------------------------------- |
| `stream-start.mp3`       | the sharer, and members who get the "is sharing" notice |
| `stream-stop.mp3`        | the sharer, and everyone who was watching               |
| `viewer-joined.mp3`      | the sharer, when a viewer joins                         |
| `viewer-left.mp3`        | the sharer, when a viewer leaves                        |

A viewer that only moves inside the relay tree (or reconnects) makes no sound.

## Platform notes

- **Wayland**: the desktop portal shows its own screen/window picker after **Start sharing**, and
  "someone is sharing" uses a system notification (Wayland apps cannot place a popup in a corner).
- **X11 / Windows / macOS**: in-app picker with thumbnails, and a ScreenLink popup in the
  bottom-right corner.
- Video only; system audio is not captured yet.

## Layout

```
server/
  index.ts       REST + WebSocket signaling, in-memory streams
  db.ts          SQLite schema and queries
  tree.ts        relay tree placement (tested in tree.test.ts)
  auth.test.ts   device sign-in, password, admin and bans against a live server
client/
  main.js        tray, windows, server connection, signaling routing
  preload.cjs    IPC bridge shared by all windows
  shared/rtc.js  Fanout (send to children) and Upstream (receive from parent)
  ui/            rooms, invites, share picker, settings
  broadcaster/   hidden window: capture + direct viewers
  viewer/        one window per watched stream (also relays)
  popup/         "X is sharing" toast
  sound/         hidden window that plays the notification sounds
```
