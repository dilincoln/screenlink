import { Fanout } from "../shared/rtc.js";

// The main process may send a port with system audio PCM (Windows, see system-audio.js). Listen
// before asking for the settings, so it cannot arrive while nobody is listening.
const audioPort = new Promise((resolve) => {
  window.addEventListener("message", (event) => {
    if (event.data === "system-audio-port") resolve(event.ports[0]);
  });
});

const NO_PROCESSING = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/** Turns 48 kHz stereo s16 chunks from the port into a live audio track. */
function pcmTrack(port) {
  const generator = new MediaStreamTrackGenerator({ kind: "audio" });
  const writer = generator.writable.getWriter();
  let frames = 0;
  port.onmessage = ({ data }) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const numberOfFrames = bytes.byteLength / 4;
    if (!numberOfFrames) return;
    const timestamp = Math.round((frames * 1e6) / 48_000);
    frames += numberOfFrames;
    writer
      .write(new AudioData({ format: "s16", sampleRate: 48_000, numberOfChannels: 2, numberOfFrames, timestamp, data: bytes }))
      .catch(() => {});
  };
  port.start();
  return generator;
}

/** The virtual microphone venmic creates (Linux); it can take a moment to show up. */
async function deviceTrack(label) {
  for (let i = 0; i < 20; i++) {
    const device = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audioinput" && d.label === label);
    if (device) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: device.deviceId }, channelCount: 2, sampleRate: 48_000, ...NO_PROCESSING },
      });
      return stream.getAudioTracks()[0];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`audio device ${label} not found`);
}

/** System audio minus Discord and ScreenLink, as planned by the main process. */
async function systemAudioTrack(plan) {
  if (plan?.kind === "device") return deviceTrack(plan.label);
  if (plan?.kind === "pcm") return pcmTrack(await audioPort);
  return null;
}

/**
 * Captures the chosen screen/window. Scaling happens in the capturer (maxWidth/maxHeight keep the
 * aspect ratio), which is cheaper than capturing at full size and asking the encoder to shrink.
 *
 * Plain system audio (the "loopback" plan) is everything the machine plays: WASAPI loopback on
 * Windows, the monitor of the default output on Linux (PulseaudioLoopbackForScreenShare). It has
 * to be requested in the same call as the desktop video.
 */
async function capture(sourceId, s, audioPlan) {
  const mandatory = { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxFrameRate: s.fps };
  if (s.width) Object.assign(mandatory, { maxWidth: s.width, maxHeight: s.height });
  if (s.audio && audioPlan?.kind !== "loopback") {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } });
      const track = await systemAudioTrack(audioPlan);
      if (track) {
        media.addTrack(track);
        return media;
      }
      media.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.warn("system audio without Discord failed, falling back to plain loopback:", err);
    }
  }
  if (s.audio) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "desktop" } }, video: { mandatory } });
    } catch (err) {
      // No loopback on this system: sharing without audio beats not sharing.
      console.warn("desktop capture with system audio failed, trying video only:", err);
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } });
  } catch (err) {
    console.warn("legacy desktop capture failed, trying getDisplayMedia:", err);
    const video = { frameRate: { ideal: s.fps, max: s.fps } };
    if (s.width) Object.assign(video, { width: { max: s.width }, height: { max: s.height } });
    const displayAudio = s.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false;
    return navigator.mediaDevices.getDisplayMedia({ video, audio: displayAudio });
  }
}

const { sourceId, settings, iceServers, audioPlan } = await sl.invoke("bc:init");

let media;
try {
  media = await capture(sourceId, settings, audioPlan);
} catch (err) {
  await sl.invoke("bc:failed", `could not capture: ${err.message}`);
  throw err;
}

const track = media.getVideoTracks()[0];
track.addEventListener("ended", () => sl.invoke("bc:ended"));
const audioTrack = media.getAudioTracks()[0] ?? null;
// Viewers learn from the stream settings whether to expect audio, so they must match reality.
if (settings.audio && !audioTrack) {
  console.warn("system audio unavailable; sharing video only");
  settings.audio = false;
}

const fanout = new Fanout({ iceServers, settings, send: (msg) => sl.send("rtc:send", msg) });
fanout.setTrack(track);
if (audioTrack) fanout.setTrack(audioTrack);

sl.on("rtc", (msg) => {
  if (msg.type === "relay.add") fanout.add(msg.connId, msg.peerId, msg.peerName);
  else if (msg.type === "relay.remove") fanout.remove(msg.connId);
  else if (msg.type === "signal") fanout.signal(msg.connId, msg.data);
});

await sl.invoke("bc:started", { audio: Boolean(audioTrack) });

setInterval(async () => {
  const stats = await fanout.encoderStats().catch(() => null);
  sl.invoke("bc:encoder", stats ? { ...stats, direct: fanout.size } : null).catch(() => {});
}, 2000);
