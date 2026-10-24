import { Fanout, Upstream } from "../shared/rtc.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const audio = $("audio");

const { stream, iceServers } = await sl.invoke("viewer:init");

function setStatus(text, ended = false) {
  $("status").hidden = !text;
  $("status-text").textContent = text ?? "";
  $("status").classList.toggle("ended", ended);
}

if (!stream) {
  setStatus("This stream has ended.", true);
  throw new Error("stream not found");
}

document.title = `${stream.sharerName} — ${stream.title}`;
$("avatar").textContent = stream.sharerName.slice(0, 1).toUpperCase();
$("title").textContent = `${stream.sharerName} — ${stream.title}`;

const route = { parentName: null, depth: 0 };
const send = (msg) => sl.send("rtc:send", msg);

const fanout = new Fanout({ iceServers, settings: stream.settings, send, onChange: renderRoute });
const upstream = new Upstream({
  iceServers,
  send,
  onTrack(track) {
    fanout.setTrack(track); // children keep their connections; only the source changes
    if (track.kind === "audio") {
      audio.srcObject = new MediaStream([track]);
      return;
    }
    video.srcObject = new MediaStream([track]);
    clearTimeout(watchdog);
    setStatus(null);
  },
  onState(state) {
    if (state === "connected") setStatus(null);
    else if (state === "disconnected") setStatus("Connection unstable — reconnecting…");
    else if (state === "failed") rejoin("connection failed");
  },
});

function renderRoute() {
  const via = route.depth <= 1 ? "direct from the sharer" : `relayed by ${route.parentName} · ${route.depth} hops`;
  const relaying = fanout.size ? ` · forwarding to ${fanout.size}` : "";
  $("route").textContent = `${via}${relaying}`;
}

// If no video arrives soon after being assigned a parent (a lost message, a parent that went
// away silently), ask the server for a fresh place in the tree.
let watchdog = null;
let ended = false;

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => rejoin("no video from the relay"), 12_000);
}

async function rejoin(reason) {
  if (ended) return;
  console.warn("rejoining:", reason);
  setStatus("Reconnecting…");
  try {
    await sl.invoke("viewer:join");
  } catch (err) {
    setStatus(`Could not reconnect: ${err.message}`, true);
  }
}

sl.on("rtc", (msg) => {
  switch (msg.type) {
    case "stream.parent":
      route.parentName = msg.parentName;
      route.depth = msg.depth;
      renderRoute();
      upstream.setParent(msg.connId, msg.parentId);
      armWatchdog();
      break;
    case "stream.depth":
      route.depth = msg.depth;
      renderRoute();
      break;
    case "relay.add":
      fanout.add(msg.connId, msg.peerId, msg.peerName);
      break;
    case "relay.remove":
      fanout.remove(msg.connId);
      break;
    case "signal":
      if (fanout.children.has(msg.connId)) fanout.signal(msg.connId, msg.data);
      else upstream.signal(msg.connId, msg.from, msg.data);
      break;
  }
});

sl.on("ended", () => {
  ended = true;
  clearTimeout(watchdog);
  upstream.close();
  fanout.closeAll();
  video.srcObject = null;
  audio.srcObject = null;
  setStatus(`${stream.sharerName} stopped sharing.`, true);
  setTimeout(() => window.close(), 4000);
});

try {
  await sl.invoke("viewer:join");
} catch (err) {
  setStatus(`Could not join: ${err.message}`, true);
}

// ---------- controls ----------

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}

function toggleStats() {
  $("stats").hidden = !$("stats").hidden;
  $("stats-btn").classList.toggle("on", !$("stats").hidden);
}

function toggleFit() {
  const native = document.body.classList.toggle("native");
  $("fit-btn").textContent = native ? "1:1" : "Fit";
  $("fit-btn").classList.toggle("on", native);
}

$("fs-btn").onclick = toggleFullscreen;
$("stats-btn").onclick = toggleStats;
$("fit-btn").onclick = toggleFit;
video.ondblclick = toggleFullscreen;
document.addEventListener("keydown", (e) => {
  if (e.key === "F11") toggleFullscreen();
  else if (e.key === "Escape") closeMenu();
  else if (e.key.toLowerCase() === "i") toggleStats();
  else if (e.key.toLowerCase() === "o") toggleFit();
  else if (e.key.toLowerCase() === "m") setVolume({ muted: !sound.muted });
});

// ---------- volume (right-click menu) ----------
// Remembered per sharer: someone who streams loud games keeps a lower volume next time.

const VOLUME_KEY = `volume:${stream.sharerId}`;
let sound = { volume: 100, muted: false };
try {
  sound = { ...sound, ...JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "{}") };
} catch {}

function setVolume(patch) {
  sound = { ...sound, ...patch };
  audio.volume = sound.volume / 100;
  audio.muted = sound.muted || sound.volume === 0;
  $("volume").value = String(sound.volume);
  $("volume-out").textContent = audio.muted ? "muted" : `${sound.volume}%`;
  $("mute-toggle").textContent = audio.muted ? "🔇" : sound.volume < 50 ? "🔉" : "🔊";
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(sound));
  } catch {}
}
setVolume({});

$("volume").addEventListener("input", (e) => setVolume({ volume: Number(e.target.value), muted: false }));
$("mute-toggle").onclick = () => setVolume({ muted: !sound.muted });
$("no-audio").hidden = Boolean(stream.settings.audio);
document.querySelector(".menu-volume").classList.toggle("disabled", !stream.settings.audio);

function openMenu(x, y) {
  const menu = $("menu");
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
}

function closeMenu() {
  if ($("menu").hidden) return;
  $("menu").hidden = true;
  wake();
}

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openMenu(e.clientX, e.clientY);
});
document.addEventListener("mousedown", (e) => {
  if (!$("menu").contains(e.target)) closeMenu();
});
window.addEventListener("blur", closeMenu);
$("menu").addEventListener("click", (e) => {
  const action = e.target.closest("button[data-action]")?.dataset.action;
  if (!action) return;
  closeMenu();
  if (action === "fullscreen") toggleFullscreen();
  else if (action === "stats") toggleStats();
  else if (action === "fit") toggleFit();
});

let idleTimer = null;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($("menu").hidden) document.body.classList.add("idle");
  }, 2500);
}
document.addEventListener("mousemove", wake);
wake();

// ---------- stats ----------

let last = null;
setInterval(async () => {
  const s = await upstream.stats().catch(() => null);
  if (!s) return;
  const elapsed = last && s.timestamp > last.timestamp ? s.timestamp - last.timestamp : 0;
  const mbps = elapsed ? ((s.bytes - last.bytes) * 8) / (elapsed * 1000) : 0;
  const audioKbps = elapsed && s.audioBytes != null && last.audioBytes != null ? ((s.audioBytes - last.audioBytes) * 8) / elapsed : null;
  last = s;
  if ($("stats").hidden) return;
  const rows = [
    ["resolution", `${s.width}×${s.height}`],
    ["fps", s.fps],
    ["bitrate", `${mbps.toFixed(mbps < 1 ? 2 : 1)} Mbps`],
    ["codec", s.codec ?? "—"],
    ["audio", s.audioCodec ? `${s.audioCodec} ${s.audioChannels === 2 ? "stereo" : "mono"} · ${audioKbps == null ? "…" : audioKbps.toFixed(0)} kbps` : "none"],
    ["decoder", s.decoder ?? "—"],
    ["decode", `${s.decodeMs.toFixed(1)} ms`],
    ["jitter buffer", `${s.jitterBufferMs.toFixed(0)} ms`],
    ["rtt (to relay)", s.rttMs == null ? "—" : `${s.rttMs.toFixed(0)} ms`],
    ["route", `${s.route ?? "—"} · hop ${route.depth}`],
    ["packets lost", s.lost],
    ["frames dropped", s.dropped],
  ];
  $("stats").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}, 1000);
