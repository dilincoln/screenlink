import { expect, test } from "bun:test";
import { tuneSdp } from "./rtc.js";

const sdp = [
  "v=0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97",
  "a=rtpmap:96 H264/90000",
  "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1",
  "a=rtpmap:97 rtx/90000",
  "a=fmtp:97 apt=96",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=fmtp:63 111/111",
  "",
].join("\r\n");

const fmtp = (out, pt) => out.split("\r\n").find((l) => l.startsWith(`a=fmtp:${pt} `));

test("video starts near the target bitrate; retransmission lines untouched", () => {
  const out = tuneSdp(sdp, 12_000_000);
  expect(fmtp(out, 96)).toBe(
    "a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;x-google-start-bitrate=8400;x-google-min-bitrate=1000;x-google-max-bitrate=12000",
  );
  expect(fmtp(out, 97)).toBe("a=fmtp:97 apt=96");
});

test("Opus becomes stereo at 128 kbps; other audio codecs untouched", () => {
  const out = tuneSdp(sdp, 12_000_000);
  expect(fmtp(out, 111)).toBe("a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000");
  expect(fmtp(out, 63)).toBe("a=fmtp:63 111/111");
});

test("keeps CRLF line endings intact", () => {
  const out = tuneSdp(sdp, 12_000_000);
  expect(out.split("\r\n").some((l) => l.includes("\r") || l.includes("\n"))).toBe(false);
  expect(out.split("\r\n").length).toBe(sdp.split("\r\n").length);
});
