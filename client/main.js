// ScreenLink tray app. The main process owns the server connection (REST + WebSocket) and routes
// signaling to the windows that own the WebRTC connections:
//   - ui/          rooms, invites, share picker, settings (hidden, not closed, when dismissed)
//   - broadcaster/ hidden window holding the capture and the connections to direct viewers
//   - viewer/      one window per watched stream; also relays the video to its own children
//   - popup/       "X started sharing" toast
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  ipcMain,
  desktopCapturer,
  screen,
  session,
  clipboard,
  shell,
} from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { muteState } from "./mute.js";
import { startSystemAudio, stopSystemAudio } from "./system-audio.js";
import { RELEASES_API, availableUpdate } from "./update.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = (name) => path.join(here, "assets", name);
const PRELOAD = path.join(here, "preload.cjs");
const IS_WAYLAND = process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland";

const RESOLUTIONS = { native: [0, 0], 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720], 480: [854, 480] };

const DEFAULTS = {
  serverUrl: "http://localhost:3000",
  token: null,
  relayCapacity: 2,
  notifications: "auto", // auto | popup | native | off
  soundVolume: 70, // 0 mutes
  // Muting "X is sharing" notices: by hand (timestamp or "forever") and by weekly quiet hours.
  mutedUntil: null,
  quietHours: { enabled: false, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },

  autostart: false,
  theme: "system", // system | light | dark
  share: { resolution: "1080", fps: 60, bitrate: 12_000_000, codec: "h264", hint: "motion", capacity: 3, audio: false },
};

// ---------- low-latency / hardware video ----------
// Hardware encode/decode where the GPU supports it (VA-API on Linux), and a zero playout delay
// on the receiving side, which is the trick Chrome Remote Desktop uses for interactive streams.
const features = ["WebRTCPipeWireCapturer", "PulseaudioLoopbackForScreenShare"];
if (process.platform === "linux") features.push("VaapiVideoDecoder", "VaapiVideoEncoder", "VaapiVideoDecodeLinuxGL", "AcceleratedVideoEncoder");
app.commandLine.appendSwitch("enable-features", features.join(","));
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("force-fieldtrials", "WebRTC-ZeroPlayoutDelay/min_pacing:0ms,max_decode_queue_size:8/");

if (!app.requestSingleInstanceLock()) app.exit(0);
app.setName("ScreenLink");
// Windows only shows native notifications for an app id that matches the installer's appId.
if (process.platform === "win32") app.setAppUserModelId("io.github.dilincoln.screenlink");

// ---------- config ----------

const CONFIG_FILE = () => path.join(app.getPath("userData"), "config.json");
let config = structuredClone(DEFAULTS);

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
    config = {
      ...DEFAULTS,
      ...saved,
      share: { ...DEFAULTS.share, ...saved.share },
      quietHours: { ...DEFAULTS.quietHours, ...saved.quietHours },
    };
  } catch {
    config = structuredClone(DEFAULTS);
  }
}

// The pages pick their colors with prefers-color-scheme, which follows nativeTheme.themeSource.
const THEMES = ["system", "light", "dark"];

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2));
}

// ---------- device identity ----------
// An Ed25519 key pair per install. The fingerprint (hash of the public key) is what the server
// knows this device by: it is the account, what ADMIN_FINGERPRINT names, and what gets banned.
// Signing in proves we hold the private key, so the fingerprint alone is not a credential.

let identity = null;

function fingerprintOf(spkiDer) {
  const hex = crypto.createHash("sha256").update(spkiDer).digest("hex").toUpperCase().slice(0, 32);
  return hex.match(/.{4}/g).join("-");
}

function loadIdentity() {
  const file = path.join(app.getPath("userData"), "identity.json");
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    identity = { privateKey: crypto.createPrivateKey(saved.privateKey), publicKey: saved.publicKey };
  } catch {
    const pair = crypto.generateKeyPairSync("ed25519");
    identity = { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    fs.writeFileSync(file, JSON.stringify({ publicKey: identity.publicKey, privateKey: pem }, null, 2), { mode: 0o600 });
  }
  identity.fingerprint = fingerprintOf(Buffer.from(identity.publicKey, "base64"));
}

// ---------- state ----------

let ui = null;
let tray = null;
let quitting = false;
let connection = "offline"; // offline | connecting | online
let me = null;
let rooms = [];
let online = new Set();
let streams = new Map();
let iceServers = [];
/** Why we are signed out, shown on the sign-in screen: { code, message } or null. */
let authError = null;
/** @type {null | { streamId: string|null, roomId: string, title: string, sourceId: string, settings: object, win: BrowserWindow, audience: object[], encoder: object|null, ready: PromiseWithResolvers<object> }} */
let share = null;
const viewers = new Map(); // streamId -> BrowserWindow
const endedViewers = new WeakSet(); // viewer windows already told their stream ended
const popups = new Map(); // streamId -> BrowserWindow
/** A newer release on GitHub: { version, url } or null. */
let update = null;

function snapshot() {
  return {
    connection,
    serverUrl: config.serverUrl,
    registered: Boolean(config.token),
    authError,
    fingerprint: identity?.fingerprint ?? null,
    isAdmin: Boolean(me?.admin),
    user: me,
    rooms,
    online: [...online],
    streams: [...streams.values()],
    sharing: share?.streamId
      ? { streamId: share.streamId, roomId: share.roomId, title: share.title, settings: share.settings, audience: share.audience, encoder: share.encoder }
      : null,
    watching: [...viewers.keys()],
    settings: {
      relayCapacity: config.relayCapacity,
      notifications: config.notifications,
      soundVolume: config.soundVolume,
      autostart: config.autostart,
      theme: config.theme,
      share: config.share,
      quietHours: config.quietHours,
    },
    portalPicker: IS_WAYLAND,
    dark: nativeTheme.shouldUseDarkColors,
    update,
    popupPlaceable: !IS_WAYLAND,
    mute: muteState(config.mutedUntil, config.quietHours),
  };
}

function pushState() {
  ui?.webContents.send("state", snapshot());
  updateTray();
}

// ---------- REST ----------

async function api(method, route, body) {
  const res = await fetch(new URL(route, config.serverUrl), {
    method,
    headers: { "content-type": "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { code: data.code, status: res.status });
  return data;
}

const SIGNED_OUT_REASONS = {
  invalid_token: "Your session expired. Sign in again.",
  password_required: "The server password changed. Enter it to sign in again.",
  banned: "This device is banned from this server.",
};

/** Drops the session and everything that depended on it (shares, viewer windows). */
async function signOut(reason = null) {
  authError = reason;
  await stopShare(true);
  for (const win of viewers.values()) win.destroy();
  viewers.clear();
  disconnect();
  config.token = null;
  me = null;
  rooms = [];
  streams.clear();
  saveConfig();
  pushState();
}

async function refreshRooms() {
  try {
    rooms = await api("GET", "/api/rooms");
    pushState();
  } catch (err) {
    console.warn("rooms:", err.message);
  }
}

// ---------- WebSocket ----------

let ws = null;
let wsRetry = 0;
let wsTimer = null;
let pingTimer = null;
let reqSeq = 0;
const replies = new Map();

async function connect() {
  clearTimeout(wsTimer);
  if (!config.token) return;
  const token = config.token;
  connection = "connecting";
  pushState();

  // The WebSocket upgrade cannot say "bad token" in a way the client sees, so ask first.
  try {
    me = await api("GET", "/api/me");
  } catch (err) {
    if (config.token !== token) return;
    if (SIGNED_OUT_REASONS[err.code]) {
      signOut({ code: err.code, message: SIGNED_OUT_REASONS[err.code] });
      return;
    }
    connection = "offline";
    pushState();
    wsTimer = setTimeout(connect, Math.min(15_000, 1000 * 2 ** wsRetry++));
    return;
  }
  if (config.token !== token || ws) return;

  const url = new URL("/ws", config.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", config.token);
  const socket = new WebSocket(url);
  ws = socket;
  socket.onopen = async () => {
    wsRetry = 0;
    connection = "online";
    try {
      iceServers = (await api("GET", "/api/config")).iceServers;
    } catch {}
    await refreshRooms();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => wsSend({ type: "ping" }), 25_000);
  };
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    onMessage(msg);
  };
  socket.onclose = (event) => {
    if (ws !== socket) return;
    ws = null;
    clearInterval(pingTimer);
    connection = "offline";
    for (const { reject } of replies.values()) reject(new Error("disconnected"));
    replies.clear();
    pushState();
    // Back off up to 15 s. The server keeps our place in streams for a while, so a short drop
    // does not interrupt anything: the WebRTC connections themselves stay up.
    wsTimer = setTimeout(connect, Math.min(15_000, 1000 * 2 ** wsRetry++));
  };
  socket.onerror = () => {};
}

function disconnect() {
  clearTimeout(wsTimer);
  const socket = ws;
  ws = null;
  socket?.close();
  connection = "offline";
}

function wsSend(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function request(type, payload = {}) {
  if (ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected to the server"));
  const reqId = ++reqSeq;
  const { promise, resolve, reject } = Promise.withResolvers();
  replies.set(reqId, { resolve, reject });
  ws.send(JSON.stringify({ type, reqId, ...payload }));
  return promise;
}

function onMessage(msg) {
  switch (msg.type) {
    case "reply": {
      const pending = replies.get(msg.reqId);
      if (!pending) return;
      replies.delete(msg.reqId);
      if (msg.ok) pending.resolve(msg);
      else pending.reject(new Error(msg.error));
      return;
    }
    case "hello":
      me = msg.user;
      online = new Set(msg.online);
      streams = new Map(msg.streams.map((s) => [s.id, s]));
      reconcile(msg);
      pushState();
      return;
    case "rooms.changed":
      refreshRooms();
      return;
    case "presence":
      if (msg.online) online.add(msg.userId);
      else online.delete(msg.userId);
      pushState();
      return;
    case "stream.started":
      streams.set(msg.stream.id, msg.stream);
      if (!msg.quiet && msg.stream.sharerId !== me?.id) announce(msg.stream);
      pushState();
      return;
    case "stream.ended":
      streamEnded(msg.streamId);
      return;
    case "stream.viewers": {
      const s = streams.get(msg.streamId);
      if (s) s.viewers = msg.viewers;
      pushState();
      return;
    }
    case "stream.audience":
      if (share?.streamId === msg.streamId) {
        // The server sends the whole audience; compare ids so a viewer that only moved in the
        // relay tree (or reconnected) makes no sound.
        const before = new Set(share.audience.map((v) => v.id));
        const after = new Set(msg.viewers.map((v) => v.id));
        if ([...after].some((id) => !before.has(id))) playSound("joined");
        else if ([...before].some((id) => !after.has(id))) playSound("left");
        share.audience = msg.viewers;
        pushState();
      }
      return;
    case "relay.add":
    case "relay.remove":
    case "signal":
    case "stream.parent":
    case "stream.depth":
      rtcWindow(msg.streamId)?.webContents.send("rtc", msg);
      return;
  }
}

/** After a reconnect: drop what the server no longer has, rejoin what it forgot about us. */
function reconcile(hello) {
  if (share?.streamId && hello.sharing !== share.streamId) stopShare(false);
  for (const [streamId, win] of viewers) {
    if (!streams.has(streamId)) win.webContents.send("ended");
    else if (!hello.watching.includes(streamId)) joinAsViewer(streamId).catch(() => win.webContents.send("ended"));
  }
}

function rtcWindow(streamId) {
  if (share?.streamId === streamId) return share.win;
  return viewers.get(streamId);
}

function streamEnded(streamId) {
  if (!streams.delete(streamId) && !viewers.has(streamId) && share?.streamId !== streamId) return;
  popups.get(streamId)?.close();
  const viewer = viewers.get(streamId);
  if (viewer && !endedViewers.has(viewer)) {
    endedViewers.add(viewer); // the window closes itself a few seconds later
    viewer.webContents.send("ended");
    playSound("stop");
  }
  if (share?.streamId === streamId) stopShare(false);
  pushState();
}

// ---------- sharing ----------

async function startShare({ roomId, title, sourceId, settings }) {
  if (share) await stopShare(true);
  if (connection !== "online") throw new Error("not connected to the server");
  if (IS_WAYLAND || !sourceId) {
    // Wayland: the desktop portal shows its own picker and returns the chosen source.
    const [source] = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    if (!source) throw new Error("no screen or window was selected");
    sourceId = source.id;
    title ||= source.name;
  }
  const [width, height] = RESOLUTIONS[settings.resolution] ?? [0, 0];
  const full = { ...settings, width, height };
  config.share = { ...config.share, ...settings };
  saveConfig();

  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 200,
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  share = { streamId: null, roomId, title: title || "Screen", sourceId, settings: full, win, audience: [], encoder: null, ready: Promise.withResolvers() };
  const current = share;
  win.on("closed", () => {
    if (share === current) stopShare(true);
  });
  win.loadFile(path.join(here, "broadcaster", "index.html"));
  return current.ready.promise;
}

async function stopShare(tellServer) {
  const s = share;
  if (!s) return;
  share = null;
  stopSystemAudio();
  if (s.streamId && !quitting) playSound("stop");
  if (tellServer && s.streamId) await request("stream.stop", { streamId: s.streamId }).catch(() => {});
  s.ready.reject(new Error("sharing stopped"));
  s.ready.promise.catch(() => {});
  if (!s.win.isDestroyed()) s.win.destroy();
  pushState();
}

// ---------- watching ----------

function watch(streamId) {
  popups.get(streamId)?.close();
  const existing = viewers.get(streamId);
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }
  const stream = streams.get(streamId);
  if (!stream) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.round(width * 0.7),
    height: Math.round(height * 0.7),
    minWidth: 320,
    minHeight: 200,
    backgroundColor: "#000000",
    title: `${stream.sharerName} — ${stream.title}`,
    icon: asset("icon.png"),
    autoHideMenuBar: true,
    // Relays must keep forwarding while minimized or behind other windows.
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  viewers.set(streamId, win);
  win.on("closed", () => {
    viewers.delete(streamId);
    wsSend({ type: "stream.leave", streamId });
    pushState();
  });
  win.loadFile(path.join(here, "viewer", "index.html"), { query: { stream: streamId } });
  pushState();
}

function joinAsViewer(streamId) {
  return request("stream.join", { streamId, capacity: config.relayCapacity });
}

// ---------- notifications ----------

function announce(stream) {
  // Wayland doesn't let a window place itself: the compositor ignores setPosition and drops the
  // popup in the middle of the screen. So there it is always a system notification.
  const style = config.notifications === "auto" || (IS_WAYLAND && config.notifications === "popup")
    ? (IS_WAYLAND ? "native" : "popup")
    : config.notifications;
  if (style === "off" || viewers.has(stream.id) || muteState(config.mutedUntil, config.quietHours).muted) return;
  playSound("start");
  const room = rooms.find((r) => r.id === stream.roomId);
  if (style === "native") {
    const n = new Notification({
      title: `${stream.sharerName} is sharing`,
      body: `${stream.title} · ${room?.name ?? "room"} — click to watch`,
      icon: asset("icon.png"),
    });
    n.on("click", () => watch(stream.id));
    n.show();
    return;
  }
  showPopup(stream, room);
}

const POPUP = { width: 380, height: 118, gap: 10 };

function showPopup(stream, room) {
  popups.get(stream.id)?.close();
  const win = new BrowserWindow({
    width: POPUP.width,
    height: POPUP.height,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { preload: PRELOAD },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  popups.set(stream.id, win);
  win.on("closed", () => {
    if (popups.get(stream.id) === win) popups.delete(stream.id);
    layoutPopups();
  });
  win.loadFile(path.join(here, "popup", "index.html"), {
    query: { data: JSON.stringify({ streamId: stream.id, sharerName: stream.sharerName, title: stream.title, room: room?.name ?? "" }) },
  });
  win.once("ready-to-show", () => {
    layoutPopups();
    win.showInactive();
  });
  setTimeout(() => !win.isDestroyed() && win.close(), 20_000);
}

function layoutPopups() {
  const area = screen.getPrimaryDisplay().workArea;
  let y = area.y + area.height - POPUP.gap;
  for (const win of popups.values()) {
    if (win.isDestroyed()) continue;
    y -= POPUP.height;
    win.setPosition(area.x + area.width - POPUP.width - POPUP.gap, y);
    y -= POPUP.gap;
  }
}

// ---------- sounds ----------

let soundWin = null;

function createSoundWindow() {
  soundWin = new BrowserWindow({ show: false, webPreferences: { preload: PRELOAD, backgroundThrottling: false } });
  soundWin.on("closed", () => (soundWin = null));
  soundWin.loadFile(path.join(here, "sound", "index.html"));
}

/** start | stop | joined | left */
function playSound(name) {
  if (config.soundVolume > 0) soundWin?.webContents.send("sound", { name, volume: config.soundVolume / 100 });
}

handle("sound:test", (_e, volume) => soundWin?.webContents.send("sound", { name: "start", volume: Number(volume) / 100 }));

// ---------- mute ----------

const MUTE_OPTIONS = [15, 30, 60, 120, 240, 480]; // minutes

function clockTime(ts) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function durationLabel(min) {
  return min < 60 ? `For ${min} minutes` : `For ${min / 60} hour${min === 60 ? "" : "s"}`;
}

function setMute(until) {
  config.mutedUntil = until;
  saveConfig();
  pushState();
}

// Expired mutes and quiet-hours edges change the tray and the UI without any event, so look
// once in a while and push only when the state actually changed.
let lastMuteKey = "";
setInterval(() => {
  const state = muteState(config.mutedUntil, config.quietHours);
  if (config.mutedUntil && !state.manual) config.mutedUntil = null;
  const key = JSON.stringify(state);
  if (key !== lastMuteKey) {
    lastMuteKey = key;
    pushState();
  }
}, 20_000);

handle("mute:set", (_e, until) => {
  if (until === null || until === "forever") return setMute(until);
  const min = Number(until);
  if (!(min > 0 && min <= 7 * 24 * 60)) throw new Error("choose between 1 minute and 7 days");
  setMute(Date.now() + min * 60_000);
});

handle("quiet:set", (_e, quiet) => {
  const time = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : null);
  if (!time(quiet.start) || !time(quiet.end)) throw new Error("invalid time");
  config.quietHours = {
    enabled: Boolean(quiet.enabled),
    days: [...new Set(quiet.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
    start: quiet.start,
    end: quiet.end,
  };
  saveConfig();
  pushState();
});

function muteMenu() {
  const state = muteState(config.mutedUntil, config.quietHours);
  const items = [];
  if (state.manual) {
    const label = state.manual === "forever" ? "Unmute notifications" : `Unmute notifications (muted until ${clockTime(state.manual)})`;
    items.push({ label, click: () => setMute(null) });
  } else {
    items.push({
      label: "Mute notifications",
      submenu: [
        ...MUTE_OPTIONS.map((min) => ({ label: durationLabel(min), click: () => setMute(Date.now() + min * 60_000) })),
        { type: "separator" },
        { label: "Until I turn it back on", click: () => setMute("forever") },
      ],
    });
  }
  if (state.quietUntil) items.push({ label: `Quiet hours until ${clockTime(state.quietUntil)}`, enabled: false });
  return items;
}

// ---------- updates ----------
// Asks GitHub for the latest release now and then; a newer one shows up in the UI and the tray.

const UPDATE_EVERY = 6 * 60 * 60 * 1000;

async function checkForUpdate() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `ScreenLink/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return; // offline, rate-limited: try again next time
    const found = availableUpdate(await res.json(), app.getVersion());
    if (found?.version === update?.version) return;
    update = found;
    pushState();
  } catch {}
}

function openUpdate() {
  if (update) shell.openExternal(update.url);
}

// ---------- windows & tray ----------

function showUi() {
  if (ui) {
    ui.show();
    ui.focus();
    return;
  }
  ui = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 720,
    minHeight: 480,
    title: "ScreenLink",
    icon: asset("icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#f6f7fa",
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD },
  });
  ui.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      ui.hide();
    }
  });
  ui.on("closed", () => {
    ui = null;
    // Without a tray the hidden windows (sounds) would keep the app alive with nothing on screen.
    if (!tray) app.quit();
  });
  ui.loadFile(path.join(here, "ui", "index.html"));
}

function trayImage(live) {
  const img = nativeImage.createFromPath(asset(live ? "tray-live.png" : "tray.png"));
  const hi = nativeImage.createFromPath(asset(live ? "tray-live@2x.png" : "tray@2x.png"));
  if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
  return img;
}

let trayLive = null;

function updateTray() {
  if (!tray) return;
  const live = Boolean(share?.streamId);
  if (live !== trayLive) {
    tray.setImage(trayImage(live));
    trayLive = live;
  }
  const others = [...streams.values()].filter((s) => s.sharerId !== me?.id);
  const status = connection === "online" ? `Connected as ${me?.name ?? "…"}` : connection === "connecting" ? "Connecting…" : "Offline";
  const muted = muteState(config.mutedUntil, config.quietHours).muted ? " (notifications muted)" : "";
  tray.setToolTip((live ? `ScreenLink — sharing to ${share.audience.length}` : `ScreenLink — ${status}`) + muted);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { label: "Open ScreenLink", click: showUi },
      ...(update ? [{ label: `Update available: ${update.version}`, click: openUpdate }] : []),
      { type: "separator" },
      others.length
        ? {
            label: "Live now",
            submenu: others.map((s) => ({
              label: `${s.sharerName} — ${s.title} (${rooms.find((r) => r.id === s.roomId)?.name ?? "room"})`,
              click: () => watch(s.id),
            })),
          }
        : { label: "No one is sharing", enabled: false },
      ...(live ? [{ label: `Stop sharing (${share.audience.length} watching)`, click: () => stopShare(true) }] : []),
      { type: "separator" },
      ...muteMenu(),
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

function createTray() {
  try {
    tray = new Tray(trayImage(false));
    trayLive = false;
    tray.on("click", () => (ui?.isVisible() && ui.isFocused() ? ui.hide() : showUi()));
    updateTray();
  } catch (err) {
    console.error("tray unavailable:", err);
    tray = null;
  }
}

// ---------- autostart (Linux: XDG autostart entry; elsewhere: login items) ----------

function applyAutostart() {
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: config.autostart, args: ["--hidden"] });
    return;
  }
  const file = path.join(app.getPath("home"), ".config", "autostart", "screenlink.desktop");
  if (!config.autostart) {
    fs.rmSync(file, { force: true });
    return;
  }
  // An AppImage runs from a temporary mount; $APPIMAGE is the file that survives a reboot.
  const bin = process.env.APPIMAGE ?? process.execPath;
  const exec = app.isPackaged ? `"${bin}"` : `"${bin}" "${app.getAppPath()}"`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `[Desktop Entry]\nType=Application\nName=ScreenLink\nExec=${exec} --hidden\nIcon=${asset("icon.png")}\nX-GNOME-Autostart-enabled=true\n`,
  );
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

handle("state:get", () => snapshot());

handle("server:info", async (_e, serverUrl) => {
  const res = await fetch(new URL("/api/info", serverUrl), { signal: AbortSignal.timeout(4000) });
  return res.json();
});

handle("auth:signin", async (_e, { serverUrl, name, password }) => {
  config.serverUrl = String(serverUrl).replace(/\/+$/, "");
  const { nonce } = await api("GET", "/api/challenge");
  const signature = crypto.sign(null, Buffer.from(`screenlink-auth:${nonce}`), identity.privateKey).toString("base64");
  const res = await api("POST", "/api/auth", { name, password, publicKey: identity.publicKey, nonce, signature });
  config.token = res.token;
  me = { ...res.user, admin: res.admin };
  authError = null;
  saveConfig();
  connect();
});

handle("auth:logout", () => signOut(null));

handle("admin:overview", () => api("GET", "/api/admin/overview"));
handle("admin:ban", (_e, fingerprint, reason) => api("POST", "/api/admin/bans", { fingerprint, reason }));
handle("admin:unban", (_e, fingerprint) => api("DELETE", `/api/admin/bans/${encodeURIComponent(fingerprint)}`));
handle("admin:deleteRoom", (_e, id) => api("DELETE", `/api/admin/rooms/${id}`));

handle("me:rename", async (_e, name) => {
  me = await api("PATCH", "/api/me", { name });
  pushState();
});

handle("rooms:create", (_e, name) => api("POST", "/api/rooms", { name }));
handle("rooms:join", (_e, code) => api("POST", "/api/rooms/join", { code }));
handle("rooms:leave", (_e, id) => api("POST", `/api/rooms/${id}/leave`));
handle("rooms:delete", (_e, id) => api("DELETE", `/api/rooms/${id}`));
handle("rooms:code", (_e, id) => api("POST", `/api/rooms/${id}/code`));
handle("rooms:kick", (_e, id, userId) => api("DELETE", `/api/rooms/${id}/members/${userId}`));

handle("settings:set", (_e, patch) => {
  const serverChanged = patch.serverUrl && patch.serverUrl !== config.serverUrl;
  if ("relayCapacity" in patch) config.relayCapacity = Math.min(8, Math.max(0, Number(patch.relayCapacity) | 0));
  if ("notifications" in patch) config.notifications = patch.notifications;
  if ("soundVolume" in patch) config.soundVolume = Math.min(100, Math.max(0, Number(patch.soundVolume) || 0));
  if ("autostart" in patch) {
    config.autostart = Boolean(patch.autostart);
    applyAutostart();
  }
  if (THEMES.includes(patch.theme)) {
    config.theme = patch.theme;
    nativeTheme.themeSource = config.theme;
  }
  if (serverChanged) {
    // Accounts live on a server: a new server means a new account.
    config.serverUrl = patch.serverUrl.replace(/\/+$/, "");
    config.token = null;
    disconnect();
    me = null;
    rooms = [];
    streams.clear();
  }
  saveConfig();
  pushState();
});

handle("sources:list", async () => {
  if (IS_WAYLAND) return [];
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith("screen:") ? "screen" : "window",
    thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
});

handle("share:start", (_e, opts) => startShare(opts).then(() => snapshot().sharing));
handle("share:stop", () => stopShare(true));
handle("stream:watch", (_e, streamId) => watch(streamId));
handle("update:open", () => openUpdate());
handle("clipboard:write", (_e, text) => clipboard.writeText(String(text)));

// Broadcaster window
handle("bc:init", async (event) => {
  if (share?.win.webContents !== event.sender) throw new Error("no pending share");
  const audioPlan = share.settings.audio ? await startSystemAudio(event.sender) : null;
  return { sourceId: share.sourceId, settings: share.settings, iceServers, audioPlan };
});
handle("bc:started", async (event, { audio } = {}) => {
  const s = share;
  if (s?.win.webContents !== event.sender) throw new Error("no pending share");
  s.settings.audio = Boolean(audio); // the capture may have come without audio
  try {
    const { stream } = await request("stream.start", {
      roomId: s.roomId,
      title: s.title,
      settings: s.settings,
      capacity: s.settings.capacity,
    });
    if (share !== s) {
      request("stream.stop", { streamId: stream.id }).catch(() => {});
      throw new Error("sharing stopped");
    }
    s.streamId = stream.id;
    streams.set(stream.id, stream);
    s.ready.resolve(stream);
    playSound("start");
    pushState();
    return { streamId: stream.id };
  } catch (err) {
    s.ready.reject(err);
    stopShare(false);
    throw err;
  }
});
handle("bc:failed", (event, message) => {
  if (share?.win.webContents !== event.sender) return;
  share.ready.reject(new Error(message));
  stopShare(false);
});
handle("bc:encoder", (event, encoder) => {
  if (share?.win.webContents !== event.sender) return;
  share.encoder = encoder;
  ui?.webContents.send("encoder", encoder);
});
handle("bc:ended", (event) => {
  // The captured window was closed or the portal session ended.
  if (share?.win.webContents === event.sender) stopShare(true);
});

// Viewer windows
function viewerStream(event) {
  for (const [streamId, win] of viewers) if (win.webContents === event.sender) return streamId;
  throw new Error("unknown viewer");
}
handle("viewer:init", (event) => {
  const streamId = viewerStream(event);
  return { stream: streams.get(streamId) ?? null, iceServers, me };
});
handle("viewer:join", (event) => joinAsViewer(viewerStream(event)).then((r) => r.stream));

// Signaling out of either kind of window
ipcMain.on("rtc:send", (event, msg) => {
  const streamId = share?.win.webContents === event.sender ? share.streamId : (() => {
    for (const [id, win] of viewers) if (win.webContents === event.sender) return id;
  })();
  if (streamId) wsSend({ ...msg, streamId });
});

// Popup
ipcMain.on("popup:watch", (_e, streamId) => watch(streamId));
ipcMain.on("popup:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());

// ---------- lifecycle ----------

app.on("second-instance", showUi);
app.on("before-quit", () => {
  quitting = true;
  if (share?.streamId) wsSend({ type: "stream.stop", streamId: share.streamId });
});
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});

app.whenReady().then(() => {
  loadConfig();
  loadIdentity();
  nativeTheme.themeSource = THEMES.includes(config.theme) ? config.theme : "system";
  nativeTheme.on("updated", pushState);
  const allowed = new Set(["media", "display-capture", "fullscreen", "clipboard-sanitized-write", "notifications"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  // Fallback capture path (getDisplayMedia) used by the broadcaster if the legacy one fails.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] }).catch(() => []);
    const video = sources.find((s) => s.id === share?.sourceId) ?? sources[0];
    cb(share?.settings.audio ? { video, audio: "loopback" } : { video });
  });

  createSoundWindow();
  createTray();
  if (!process.argv.includes("--hidden") || !config.token || !tray) showUi();
  connect();
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_EVERY);
});
