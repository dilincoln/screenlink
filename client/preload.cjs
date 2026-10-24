// Shared by every window: a small, explicit bridge to the main process.
const { contextBridge, ipcRenderer } = require("electron");

const LISTEN = new Set(["state", "encoder", "rtc", "ended", "sound"]);
const SEND = new Set(["rtc:send", "popup:watch", "popup:close"]);

contextBridge.exposeInMainWorld("sl", {
  /** Calls a main-process handler; throws its error message. */
  async invoke(channel, ...args) {
    const res = await ipcRenderer.invoke(channel, ...args);
    if (!res.ok) throw new Error(res.error);
    return res.value;
  },
  send(channel, payload) {
    if (SEND.has(channel)) ipcRenderer.send(channel, payload);
  },
  on(channel, fn) {
    if (!LISTEN.has(channel)) return () => {};
    const listener = (_event, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  platform: process.platform,
});
