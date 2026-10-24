import { Fanout, Upstream } from "../shared/rtc.js";

const $ = (id) => document.getElementById(id);
const video = $("video");

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
    video.srcObject = new MediaStream([track]);
    fanout.setTrack(track); // children keep their connections; only the source changes
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
  else if (e.key.toLowerCase() === "i") toggleStats();
  else if (e.key.toLowerCase() === "o") toggleFit();
});

let idleTimer = null;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 2500);
}
document.addEventListener("mousemove", wake);
wake();

// ---------- stats ----------

let last = null;
setInterval(async () => {
  const s = await upstream.stats().catch(() => null);
  if (!s) return;
  const mbps = last && s.timestamp > last.timestamp ? ((s.bytes - last.bytes) * 8) / ((s.timestamp - last.timestamp) * 1000) : 0;
  last = s;
  if ($("stats").hidden) return;
  const rows = [
    ["resolution", `${s.width}×${s.height}`],
    ["fps", s.fps],
    ["bitrate", `${mbps.toFixed(mbps < 1 ? 2 : 1)} Mbps`],
    ["codec", s.codec ?? "—"],
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
