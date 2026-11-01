#!/usr/bin/env bash
# Prepares every sound the video uses into assets/audio/. Run from video/pt-br:
#
#   bash mock/audio.sh <music.mp3> <memes dir>
#
# <music.mp3>  "Powerup!" by Jeremy Blake (YouTube Audio Library), downloaded from
#              https://www.youtube.com/watch?v=-tJ23mRbmps — see LICENSES.txt.
# <memes dir>  the four dry meme clips, named as below.
#
# The memes are only loudness-matched and padded with silence here: the reverb, filters and
# level that push them into the background are in index.html (data-fx-chain), so they can be
# changed in the HyperFrames editor. The SFX are synthesized, so they carry no license.
set -euo pipefail
MUSIC="$1"
MEMES="$2"
OUT="assets/audio"
mkdir -p "$OUT"

# Only the part of the track the edit uses: 138 s → 226 s of the original (breakdown, build, drop).
ffmpeg -v error -y -ss 138 -t 88 -i "$MUSIC" -c:a libmp3lame -b:a 192k "$OUT/music-powerup.mp3"

# Memes: mono, loudness-matched to -20 LUFS, 2.5 s of silence after for the reverb tail.
for name in acorda-cara ja-comecou petralhada risada; do
  ffmpeg -v error -y -i "$MEMES/$name.mp3" \
    -af "aformat=channel_layouts=mono,loudnorm=I=-20:TP=-3:LRA=11,apad=pad_dur=2.5" \
    -ar 48000 -c:a libmp3lame -b:a 160k "$OUT/meme-$name.mp3"
done

synth() { ffmpeg -v error -y -f lavfi -i "$1" -af "$2" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k "$OUT/$3"; }
# Chat message pop.
synth "aevalsrc='0.5*sin(2*PI*(880+2400*t)*t)*exp(-38*t)':d=0.14:s=48000" "afade=t=out:st=0.1:d=0.04" sfx-pop.mp3
# Mouse click.
synth "anoisesrc=d=0.03:c=white:a=0.6:r=48000" "highpass=f=2500,afade=t=out:st=0.004:d=0.026" sfx-click.mp3
# Low boom for punch-ins and the logo.
synth "aevalsrc='0.9*sin(2*PI*(78*t-26*t*t))*exp(-2.6*t)':d=1.4:s=48000" "lowpass=f=300,afade=t=out:st=1.1:d=0.3" sfx-boom.mp3
# Error buzz: two falling square tones.
synth "aevalsrc='0.35*(sgn(sin(2*PI*233*t))*between(t,0,0.13)+sgn(sin(2*PI*156*t))*between(t,0.16,0.4))':d=0.45:s=48000" "lowpass=f=2400,afade=t=out:st=0.36:d=0.06" sfx-error.mp3
# Short whoosh for cuts.
synth "anoisesrc=d=0.5:c=pink:a=0.8:r=48000" "highpass=f=500,lowpass=f=5000,volume=6dB,afade=t=in:d=0.22:curve=tri,afade=t=out:st=0.24:d=0.26,alimiter=limit=0.7" sfx-whoosh.mp3
# Riser into the drop.
synth "anoisesrc=d=1.6:c=pink:a=0.7:r=48000" "highpass=f=500,lowpass=f=10000,volume=14dB,afade=t=in:d=1.55:curve=exp,afade=t=out:st=1.55:d=0.05,alimiter=limit=0.7" sfx-riser.mp3

ls -la "$OUT"
