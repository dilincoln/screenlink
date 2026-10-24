const FILES = {
  start: "stream-start.mp3",
  stop: "stream-stop.mp3",
  joined: "viewer-joined.mp3",
  left: "viewer-left.mp3",
};

const clips = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => {
    const audio = new Audio(`../assets/${file}`);
    audio.preload = "auto";
    return [name, audio];
  }),
);

sl.on("sound", ({ name, volume }) => {
  const audio = clips[name];
  if (!audio || volume <= 0) return;
  audio.volume = Math.min(1, volume);
  audio.currentTime = 0;
  audio.play().catch((err) => console.warn("sound:", err.message));
});
