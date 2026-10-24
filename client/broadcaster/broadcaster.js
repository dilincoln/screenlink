import { Fanout } from "../shared/rtc.js";

/**
 * Captures the chosen screen/window. Scaling happens in the capturer (maxWidth/maxHeight keep the
 * aspect ratio), which is cheaper than capturing at full size and asking the encoder to shrink.
 */
async function capture(sourceId, s) {
  const mandatory = { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxFrameRate: s.fps };
  if (s.width) Object.assign(mandatory, { maxWidth: s.width, maxHeight: s.height });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } });
  } catch (err) {
    console.warn("legacy desktop capture failed, trying getDisplayMedia:", err);
    const video = { frameRate: { ideal: s.fps, max: s.fps } };
    if (s.width) Object.assign(video, { width: { max: s.width }, height: { max: s.height } });
    return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
  }
}

const { sourceId, settings, iceServers } = await sl.invoke("bc:init");

let media;
try {
  media = await capture(sourceId, settings);
} catch (err) {
  await sl.invoke("bc:failed", `could not capture: ${err.message}`);
  throw err;
}

const track = media.getVideoTracks()[0];
track.addEventListener("ended", () => sl.invoke("bc:ended"));

const fanout = new Fanout({ iceServers, settings, send: (msg) => sl.send("rtc:send", msg) });
fanout.setTrack(track);

sl.on("rtc", (msg) => {
  if (msg.type === "relay.add") fanout.add(msg.connId, msg.peerId, msg.peerName);
  else if (msg.type === "relay.remove") fanout.remove(msg.connId);
  else if (msg.type === "signal") fanout.signal(msg.connId, msg.data);
});

await sl.invoke("bc:started");

setInterval(async () => {
  const stats = await fanout.encoderStats().catch(() => null);
  sl.invoke("bc:encoder", stats ? { ...stats, direct: fanout.size } : null).catch(() => {});
}, 2000);
