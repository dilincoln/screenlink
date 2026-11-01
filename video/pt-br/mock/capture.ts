// Screenshots of the real app UI (client/ui, client/popup) filled with the demo database.
//
//   bun mock/seed.ts && bun mock/capture.ts      (from video/pt-br)
//
// The UI window normally talks to Electron's main process through `window.sl` (preload.cjs).
// Here a stand-in `sl` answers "state:get" with the state state.ts builds from SQLite, so the
// page renders exactly what the app would show, from the app's own HTML, CSS and JS.
// Writes assets/screens/*.png and assets/screens/rects.json (where buttons are, for the cursor).

import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { stateFor } from "./state.ts";

const PROJECT = join(import.meta.dir, "..");
const REPO = join(PROJECT, "..", "..");
const OUT = join(PROJECT, "assets", "screens");
mkdirSync(OUT, { recursive: true });

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
};
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = Bun.file(join(REPO, path));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, { headers: { "content-type": TYPES[extname(path)] ?? "application/octet-stream" } });
  },
});
const BASE = `http://127.0.0.1:${server.port}`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--hide-scrollbars", "--font-render-hinting=none", "--force-color-profile=srgb"],
});

const rects: Record<string, Record<string, { x: number; y: number; w: number; h: number }>> = {};

// ---------- stills of the made-up windows ----------

async function still(name: string, query: string) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/video/pt-br/mock/stills.html?${query}`);
  await page.waitForSelector("body[data-ready]");
  await page.screenshot({ path: join(OUT, `still-${name}.png`) });
  const small = await page.screenshot({ encoding: "base64", clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 / 6 } });
  await page.close();
  return `data:image/png;base64,${small}`;
}

const thumbs = {
  game: await still("game", "scene=game&t=1.9"),
  slides: await still("slides", "scene=slides"),
  browser: await still("browser", "scene=browser"),
};

const SOURCES = [
  { id: "screen:0:0", name: "Tela inteira", kind: "screen", thumbnail: thumbs.game, icon: null },
  { id: "window:101:0", name: "Treta em Brasília", kind: "window", thumbnail: thumbs.game, icon: null },
  { id: "window:102:0", name: "Slides — apresentação final", kind: "window", thumbnail: thumbs.slides, icon: null },
  { id: "window:103:0", name: "Navegador", kind: "window", thumbnail: thumbs.browser, icon: null },
];

// ---------- the app's UI window ----------

async function openUi(shot: string) {
  const { state, selectedRoom } = stateFor(shot);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluateOnNewDocument(
    (state, selectedRoom, sources) => {
      localStorage.setItem("room", selectedRoom);
      const listeners: Record<string, ((p: unknown) => void)[]> = {};
      (window as any).sl = {
        platform: "linux",
        async invoke(channel: string) {
          if (channel === "state:get") return state;
          if (channel === "sources:list") return sources;
          return null;
        },
        send() {},
        on(channel: string, fn: (p: unknown) => void) {
          (listeners[channel] ??= []).push(fn);
          return () => {};
        },
      };
    },
    state,
    selectedRoom,
    SOURCES,
  );
  await page.goto(`${BASE}/client/ui/index.html`);
  await page.waitForSelector("#app:not([hidden]) .room-head");
  return page;
}

async function rectOf(page: Page, selector: string) {
  const r = await page.$eval(selector, (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  return r;
}

async function record(page: Page, shot: string, selectors: Record<string, string>) {
  rects[shot] = {};
  for (const [name, sel] of Object.entries(selectors)) rects[shot][name] = await rectOf(page, sel);
}

// Lucas's room, before sharing.
{
  const page = await openUi("lucas-room");
  await record(page, "lucas-room", {
    copy: ".invite button.ghost",
    invite: ".invite",
    share: ".share-cta button.primary",
    members: ".members",
    rooms: "#room-list",
  });
  await page.screenshot({ path: join(OUT, "lucas-room.png") });

  // The share dialog, set up for the fight.
  await page.click(".share-cta button.primary");
  await page.waitForSelector("#share-dialog[open] .source");
  await page.click('.tab[data-kind="window"]');
  await page.click(".source:first-child");
  await page.evaluate(() => {
    const form = document.getElementById("share-form") as HTMLFormElement & Record<string, any>;
    form.title.value = "Treta em Brasília";
    form.title.dataset.touched = "1";
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await record(page, "share-dialog", {
    dialog: "#share-dialog",
    source: ".source.on",
    title: '#share-form input[name="title"]',
    fps: '#share-form select[name="fps"]',
    hint: '#share-form select[name="hint"]',
    audio: '#share-form select[name="audio"]',
    resolution: '#share-form select[name="resolution"]',
    codec: '#share-form select[name="codec"]',
    start: "#share-start",
  });
  await page.screenshot({ path: join(OUT, "share-dialog.png") });
  await page.close();
}

{
  const page = await openUi("lucas-sharing");
  await record(page, "lucas-sharing", { card: ".stream-card.mine", tree: ".stream-card.mine .tree" });
  await page.screenshot({ path: join(OUT, "lucas-sharing.png") });
  await page.close();
}

{
  const page = await openUi("bia-room");
  await record(page, "bia-room", { card: ".stream-card", watch: ".stream-card button.primary" });
  await page.screenshot({ path: join(OUT, "bia-room.png") });
  await page.close();
}

{
  const page = await openUi("lucas-tcc");
  await record(page, "lucas-tcc", { card: ".stream-card" });
  await page.screenshot({ path: join(OUT, "lucas-tcc.png") });
  await page.close();
}

// The "X is sharing" popup, as Bia sees it (380×118, client/main.js POPUP).
{
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  await page.setViewport({ width: 380, height: 118, deviceScaleFactor: 3 });
  const data = { sharerName: "Lucas", title: "Treta em Brasília", room: "Jogatina de Sexta", streamId: "s-fight" };
  await page.goto(`${BASE}/client/popup/index.html?data=${encodeURIComponent(JSON.stringify(data))}`);
  await page.waitForSelector("#headline");
  // Freeze the entry and countdown animations at their resting frame.
  await page.addStyleTag({ content: ".card{animation:none!important}.timer{animation:none!important;transform:scaleX(.92)}.dot{animation:none!important}" });
  await record(page, "popup", { watch: "#watch" });
  await page.screenshot({ path: join(OUT, "popup.png"), omitBackground: true });
  await page.close();
}

writeFileSync(join(OUT, "rects.json"), JSON.stringify(rects, null, 2) + "\n");
await browser.close();
server.stop();
console.log(`screens written to ${OUT}`);
