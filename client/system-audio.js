// System audio for sharing, minus Discord and ScreenLink itself.
//
// Plain loopback captures everything the computer plays. That includes Discord, so viewers who
// are in a call with the sharer hear their own voices back, and ScreenLink's own sounds (and any
// stream the sharer is watching). Each platform excludes them differently:
//
// - Linux: venmic builds a virtual microphone ("vencord-screen-share") in PipeWire and links every
//   playback stream to it except the excluded ones, including streams that start later. The
//   broadcaster records that microphone.
// - Windows: WASAPI process loopback in "exclude target process tree" mode (loopback-capture).
//   It excludes one process tree, so Discord's when it is running and ScreenLink's otherwise. The
//   PCM arrives here and is posted to the broadcaster, which turns it into a track.
// - Anything else, or if the native module fails: Chromium's own loopback (everything).
import { app, MessageChannelMain } from "electron";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Executable names of Discord clients, as PipeWire (Linux) and the process list (Windows) see them. */
const DISCORD = ["Discord", "DiscordPTB", "DiscordCanary", "discord", "vesktop", "Vesktop", "Equibop", "equibop"];
const DISCORD_EXE = new Set(DISCORD.map((name) => `${name.toLowerCase()}.exe`));

export const VIRTUAL_MIC = "vencord-screen-share";

/** Lets tests force the PCM path on Linux, where loopback-capture also works (without exclusion). */
const FORCE = process.env.SCREENLINK_AUDIO_BACKEND;

function ownAudioPid() {
  return app.getAppMetrics().find((p) => p.name === "Audio Service")?.pid ?? null;
}

// ---------- Linux: venmic ----------

let patchBay = null;

function startVenmic() {
  if (!patchBay) {
    const { PatchBay } = require("@vencord/venmic");
    if (!PatchBay.hasPipeWire()) throw new Error("PipeWire not running");
    patchBay = new PatchBay();
  }
  const exclude = [
    ...DISCORD.map((binary) => ({ "application.process.binary": binary })),
    { "media.class": "Stream/Input/Audio" }, // recording streams (microphones), never playback
  ];
  const pid = ownAudioPid();
  if (pid) exclude.push({ "application.process.id": String(pid) });
  const ok = patchBay.link({ exclude, ignore_devices: true, only_speakers: true, only_default_speakers: true, mute: false });
  if (!ok) throw new Error("venmic could not link");
  return { kind: "device", label: VIRTUAL_MIC };
}

// ---------- Windows: WASAPI process loopback ----------

/** Root PID of the running Discord client (the process whose parent is not Discord), or null. */
function findDiscordRoot() {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const list = [].concat(JSON.parse(stdout));
        const discord = list.filter((p) => DISCORD_EXE.has(String(p.Name).toLowerCase()));
        const pids = new Set(discord.map((p) => p.ProcessId));
        resolve(discord.find((p) => !pids.has(p.ParentProcessId))?.ProcessId ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

class PcmCapture {
  constructor() {
    this.Capture = require("loopback-capture").LoopbackCapture;
    this.capture = null;
    this.target = undefined;
    this.port = null;
    this.timer = null;
  }

  /** Starts capturing and hands the broadcaster a port that receives 48 kHz stereo s16 chunks. */
  async start(webContents) {
    const { port1, port2 } = new MessageChannelMain();
    this.port = port1;
    port1.start();
    await this.retarget();
    if (FORCE !== "pcm") this.timer = setInterval(() => this.retarget().catch(() => {}), 10_000);
    webContents.postMessage("system-audio-port", null, [port2]);
    return { kind: "pcm" };
  }

  /** Points the exclusion at Discord, or at ScreenLink when Discord is not running. */
  async retarget() {
    if (FORCE === "pcm") {
      if (this.capture) return;
      this.capture = new this.Capture();
      this.capture.startSystemAudio((chunk) => this.port?.postMessage(chunk));
      return;
    }
    const target = (await findDiscordRoot()) ?? process.pid;
    if (target === this.target && this.capture) return;
    this.capture?.stop();
    this.target = target;
    this.capture = new this.Capture();
    // false = WASAPI's PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE: everything but this tree.
    this.capture.start(target, false, (chunk) => this.port?.postMessage(chunk));
    console.log(`system audio: excluding ${target === process.pid ? "ScreenLink" : `Discord (pid ${target})`}`);
  }

  stop() {
    clearInterval(this.timer);
    this.capture?.stop();
    this.capture = null;
    this.port?.close();
    this.port = null;
  }
}

// ---------- entry points ----------

let active = null;

/**
 * Prepares system audio for the broadcaster window. Returns how it should get the audio:
 * { kind: "device", label } (record that input), { kind: "pcm" } (a port arrives with PCM) or
 * { kind: "loopback" } (Chromium's loopback, nothing excluded).
 */
export async function startSystemAudio(webContents) {
  stopSystemAudio();
  try {
    if (FORCE === "pcm" || process.platform === "win32") {
      const pcm = new PcmCapture();
      const result = await pcm.start(webContents);
      active = pcm;
      return result;
    }
    if (process.platform === "linux") {
      const result = startVenmic();
      active = { stop: () => patchBay?.unlink() };
      return result;
    }
  } catch (err) {
    console.warn("system audio without exclusions (native capture failed):", err.message);
  }
  return { kind: "loopback" };
}

export function stopSystemAudio() {
  try {
    active?.stop();
  } catch {}
  active = null;
}
