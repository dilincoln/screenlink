// WebRTC pieces shared by the broadcaster (sharer) and the viewer windows.
//
// Every edge of the relay tree is one RTCPeerConnection carrying one video track, from parent to
// child. The parent offers; the child answers. A viewer is both: an Upstream (its parent) and a
// Fanout (its own children, which get the track it receives).

const AUDIO_BITRATE = 128_000;

const CODEC_MIME = { h264: "video/H264", vp8: "video/VP8", vp9: "video/VP9", av1: "video/AV1", h265: "video/H265" };

/** Puts the chosen codec first; the other side picks the first one it can decode. */
function preferCodec(transceiver, codec) {
  const mime = CODEC_MIME[codec];
  const caps = RTCRtpSender.getCapabilities?.("video");
  if (!mime || !caps || !transceiver.setCodecPreferences) return;
  const chosen = caps.codecs.filter((c) => c.mimeType === mime);
  if (!chosen.length) return;
  // H.264: constrained baseline/high with packetization-mode=1 is what hardware decoders like most.
  if (codec === "h264") chosen.sort((a, b) => score(b) - score(a));
  const rest = caps.codecs.filter((c) => c.mimeType !== mime);
  transceiver.setCodecPreferences([...chosen, ...rest]);
}

function score(c) {
  const f = c.sdpFmtpLine ?? "";
  return (f.includes("packetization-mode=1") ? 2 : 0) + (f.includes("profile-level-id=640c") ? 1 : 0);
}

/**
 * Tunes the answer before the sender applies it (it is the remote description on the sending
 * side, and the sender obeys its parameters):
 * - video: Chrome starts a new connection at ~300 kbps and ramps up over several seconds. These
 *   Chrome-only fmtp hints make it start near the target bitrate, so the first seconds are sharp.
 * - audio: stereo Opus at a music-grade bitrate (the defaults are mono and tuned for voice).
 */
export function tuneSdp(sdp, bitrate) {
  const kbps = Math.round(bitrate / 1000);
  const start = Math.round(kbps * 0.7);
  const min = Math.min(1000, Math.round(kbps * 0.1));
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (section.startsWith("m=video")) {
        return section.replace(/^(a=fmtp:\d+ .*?)(?=\r?$)/gm, (line) =>
          line.includes("x-google-") || line.includes("apt=") ? line
            : `${line};x-google-start-bitrate=${start};x-google-min-bitrate=${min};x-google-max-bitrate=${kbps}`,
        );
      }
      if (section.startsWith("m=audio")) {
        const opus = section.match(/^a=rtpmap:(\d+) opus\/48000/m)?.[1];
        if (!opus) return section;
        return section.replace(new RegExp(`^(a=fmtp:${opus} .*?)(?=\\r?$)`, "m"), (line) =>
          line.includes("stereo=1") ? line : `${line};stereo=1;sprop-stereo=1;maxaveragebitrate=${AUDIO_BITRATE}`,
        );
      }
      return section;
    })
    .join("");
}

/** Serializes async work per connection so candidates never race the descriptions. */
function queue() {
  let tail = Promise.resolve();
  return (fn) => (tail = tail.then(fn).catch((err) => console.warn("[rtc]", err)));
}

/**
 * Sends the stream to N children (sharer: the capture; viewer: the tracks it receives). Video
 * always; audio when the stream has it (settings.audio).
 */
export class Fanout {
  /**
   * @param {{ iceServers: RTCIceServer[], settings: { bitrate: number, fps: number, codec: string, hint: string, audio?: boolean },
   *           send: (msg: object) => void, onChange?: () => void }} opts
   */
  constructor({ iceServers, settings, send, onChange }) {
    this.iceServers = iceServers;
    this.settings = settings;
    this.send = send;
    this.onChange = onChange ?? (() => {});
    this.tracks = { video: null, audio: null };
    /** @type {Map<string, { pc: RTCPeerConnection, peerId: string, peerName: string, senders: { video: RTCRtpSender, audio?: RTCRtpSender }, run: Function }>} */
    this.children = new Map();
  }

  get size() {
    return this.children.size;
  }

  /** Sets the source for the track's kind; children keep their connections. */
  setTrack(track) {
    this.tracks[track.kind] = track;
    if (track.kind === "video") track.contentHint = this.settings.hint === "detail" ? "detail" : "motion";
    else track.contentHint = "music";
    for (const child of this.children.values()) child.senders[track.kind]?.replaceTrack(track).catch(() => {});
  }

  add(connId, peerId, peerName) {
    this.remove(connId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const transceiver = pc.addTransceiver(this.tracks.video ?? "video", {
      direction: "sendonly",
      sendEncodings: [{ maxBitrate: this.settings.bitrate, maxFramerate: this.settings.fps, priority: "high", networkPriority: "high" }],
    });
    preferCodec(transceiver, this.settings.codec);
    const senders = { video: transceiver.sender };
    if (this.settings.audio) {
      // Deliberately not tied to the video (no shared MediaStream): A/V sync would make the
      // receiver hold video back to match the audio jitter buffer, costing tens of ms.
      senders.audio = pc.addTransceiver(this.tracks.audio ?? "audio", {
        direction: "sendonly",
        sendEncodings: [{ maxBitrate: AUDIO_BITRATE, priority: "high", networkPriority: "high" }],
      }).sender;
    }
    const child = { pc, peerId, peerName, senders, run: queue() };
    this.children.set(connId, child);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: "signal", connId, to: peerId, data: { candidate: candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      this.onChange();
      if (pc.connectionState === "failed") pc.restartIce?.();
    };
    pc.onnegotiationneeded = () =>
      child.run(async () => {
        await pc.setLocalDescription();
        this.send({ type: "signal", connId, to: peerId, data: { sdp: pc.localDescription.toJSON() } });
      });
    child.run(() => this.applyEncoding(child.senders.video));
    this.onChange();
  }

  async applyEncoding(sender) {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = this.settings.bitrate;
    params.encodings[0].maxFramerate = this.settings.fps;
    // Games and video: drop resolution before frames. Text and slides: the opposite.
    params.degradationPreference = this.settings.hint === "detail" ? "maintain-resolution" : "maintain-framerate";
    await sender.setParameters(params).catch(() => {
      delete params.degradationPreference;
      return sender.setParameters(params);
    });
  }

  signal(connId, data) {
    const child = this.children.get(connId);
    if (!child) return;
    child.run(async () => {
      if (data.sdp) {
        await child.pc.setRemoteDescription({ type: data.sdp.type, sdp: tuneSdp(data.sdp.sdp, this.settings.bitrate) });
        await this.applyEncoding(child.senders.video);
      } else if (data.candidate) {
        await child.pc.addIceCandidate(data.candidate);
      }
    });
  }

  remove(connId) {
    const child = this.children.get(connId);
    if (!child) return;
    this.children.delete(connId);
    child.pc.close();
    this.onChange();
  }

  closeAll() {
    for (const connId of [...this.children.keys()]) this.remove(connId);
  }

  /** Encoder stats of the first connected child (all children encode the same source). */
  async encoderStats() {
    for (const { pc } of this.children.values()) {
      if (pc.connectionState !== "connected") continue;
      const report = await pc.getStats();
      for (const s of report.values()) {
        if (s.type !== "outbound-rtp" || s.kind !== "video") continue;
        const codec = s.codecId ? report.get(s.codecId)?.mimeType?.split("/")[1] : null;
        return {
          encoder: s.encoderImplementation ?? null,
          powerEfficient: s.powerEfficientEncoder ?? null,
          codec,
          width: s.frameWidth ?? 0,
          height: s.frameHeight ?? 0,
          fps: Math.round(s.framesPerSecond ?? 0),
          limitedBy: s.qualityLimitationReason ?? "none",
          encodeMs: s.framesEncoded ? (1000 * s.totalEncodeTime) / s.framesEncoded : 0,
        };
      }
    }
    return null;
  }
}

/** Receives the track from the current parent. Replaced wholesale when the server re-parents. */
export class Upstream {
  /**
   * @param {{ iceServers: RTCIceServer[], send: (msg: object) => void,
   *           onTrack: (track: MediaStreamTrack) => void, onState: (state: string) => void }} opts
   */
  constructor({ iceServers, send, onTrack, onState }) {
    this.iceServers = iceServers;
    this.send = send;
    this.onTrack = onTrack;
    this.onState = onState;
    this.connId = null;
    this.parentId = null;
    this.pc = null;
    this.pending = new Map(); // signals that arrived before their stream.parent
  }

  setParent(connId, parentId) {
    this.pc?.close();
    this.connId = connId;
    this.parentId = parentId;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    this.run = queue();
    pc.ontrack = ({ track, receiver }) => {
      // Play frames as soon as they are decoded instead of buffering for smoothness.
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 0;
      if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = 0;
      this.onTrack(track);
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.pc === pc) {
        this.send({ type: "signal", connId, to: parentId, data: { candidate: candidate.toJSON() } });
      }
    };
    pc.onconnectionstatechange = () => this.pc === pc && this.onState(pc.connectionState);
    this.onState("connecting");
    for (const [id, msgs] of this.pending) {
      if (id === connId) msgs.forEach((m) => this.signal(connId, m.from, m.data));
    }
    this.pending.clear();
  }

  signal(connId, from, data) {
    if (connId !== this.connId) {
      if (!this.pending.has(connId)) this.pending.set(connId, []);
      this.pending.get(connId).push({ from, data });
      return;
    }
    const pc = this.pc;
    this.run(async () => {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        await pc.setLocalDescription();
        this.send({ type: "signal", connId, to: from, data: { sdp: pc.localDescription.toJSON() } });
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    });
  }

  close() {
    this.pc?.close();
    this.pc = null;
  }

  async stats() {
    if (!this.pc) return null;
    const report = await this.pc.getStats();
    let inbound = null;
    let audio = null;
    let pair = null;
    for (const s of report.values()) {
      if (s.type === "inbound-rtp" && s.kind === "video") inbound = s;
      if (s.type === "inbound-rtp" && s.kind === "audio") audio = s;
      if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pair = s;
    }
    if (!inbound) return null;
    const local = pair && report.get(pair.localCandidateId);
    return {
      timestamp: inbound.timestamp,
      bytes: inbound.bytesReceived,
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      fps: Math.round(inbound.framesPerSecond ?? 0),
      codec: inbound.codecId ? report.get(inbound.codecId)?.mimeType?.split("/")[1] : null,
      decoder: inbound.decoderImplementation ?? null,
      decodeMs: inbound.framesDecoded ? (1000 * inbound.totalDecodeTime) / inbound.framesDecoded : 0,
      jitterBufferMs: inbound.jitterBufferEmittedCount
        ? (1000 * inbound.jitterBufferDelay) / inbound.jitterBufferEmittedCount : 0,
      lost: inbound.packetsLost ?? 0,
      dropped: inbound.framesDropped ?? 0,
      rttMs: pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
      route: local?.candidateType === "relay" ? "TURN" : local ? "direct" : null,
      audioBytes: audio?.bytesReceived ?? null,
      audioCodec: audio?.codecId ? report.get(audio.codecId)?.mimeType?.split("/")[1] : null,
      audioChannels: audio?.codecId ? report.get(audio.codecId)?.channels ?? null : null,
    };
  }
}
