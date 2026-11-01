// "O LAG SUPREMO": the made-up boss fight the video streams. Pixel art drawn as SVG rects and
// animated with GSAP, so every frame is a pure function of timeline time (HyperFrames seeks).
//
//   const game = SLGame.mount(container);        // builds a 1920×1080 scene inside container
//   game.addTo(tl, startTime);                    // adds the fight (~5.6 s) to a paused timeline
(function () {
  const W = 1920;
  const H = 1080;
  const GROUND = 840;

  // Seeded PRNG: same numbers on every render.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NS = "http://www.w3.org/2000/svg";
  function sprite(rows, palette, px) {
    const w = rows[0].length;
    const h = rows.length;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w * px);
    svg.setAttribute("height", h * px);
    svg.setAttribute("shape-rendering", "crispEdges");
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const fill = palette[ch];
        if (!fill) return;
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", x);
        r.setAttribute("y", y);
        r.setAttribute("width", 1.02);
        r.setAttribute("height", 1.02);
        r.setAttribute("fill", fill);
        svg.appendChild(r);
      });
    });
    return svg;
  }

  const KNIGHT = [
    "....hhhh....",
    "...hHHHHh...",
    "...hHHHHh...",
    "...hVVVVh...",
    "...hHHHHh...",
    "....hHHh....",
    "..CaAAAAaC..",
    ".CCaAAAAaCC.",
    ".CaAAGGAAaC.",
    ".C.aAAAAa.C.",
    "...aAAAAa...",
    "...aa..aa...",
    "...aa..aa...",
    "...BB..BB...",
    "..BBB..BBB..",
  ];
  const KNIGHT_PAL = { H: "#d7dde4", h: "#7d8794", V: "#14171c", A: "#4f6bed", a: "#2c3d9e", G: "#f5a524", C: "#e5484d", B: "#4a3326" };

  const SWORD = ["..W..", ".WWW.", ".WWW.", ".WWW.", ".WWW.", ".WWW.", ".WWW.", "GGGGG", "..b..", "..b.."];
  const SWORD_PAL = { W: "#eef3f8", G: "#f5a524", b: "#6b4a2f" };

  const BOSS = [
    "........Y..Y..Y.........",
    "........YYYYYYYY........",
    "........YRYYYYRY........",
    ".......oooooooooo.......",
    ".....ooGGGGGGGGGGoo.....",
    "....oGGGGGGGGGGGGGGo....",
    "...oGGgGGGGGGGGGGgGGo...",
    "..oGGGGGWWWWWWWWGGGGGo..",
    "..oGGGGWWWWWWWWWWGGGGo..",
    ".oGGGGGWWWKKKKWWWGGGGGo.",
    ".oGGGGGWWWKRRKWWWGGGGGo.",
    ".oGGGGGWWWKKKKWWWGGGGGo.",
    ".oGGGGGGWWWWWWWWGGGGGGo.",
    "oGGGGGGGGGGGGGGGGGGGGGGo",
    "oGGGGMMMMMMMMMMMMMMGGGGo",
    "oGGGGMTMTMTMTMTMTMMGGGGo",
    "oGGGGGMMMMMMMMMMMMGGGGGo",
    "oGGgGGGGGGGGGGGGGGGGgGGo",
    ".oGGGGGGGGGGGGGGGGGGGGo.",
    "..oooooooooooooooooooo..",
  ];
  const BOSS_PAL = { Y: "#f5c518", R: "#e5484d", o: "#0f4a2b", G: "#2fbf71", g: "#8af0b5", W: "#f4f7fb", K: "#14171c", M: "#3a0d16", T: "#f4f7fb" };

  function el(tag, cls, style, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  const CSS = `
  .slg { position:absolute; left:0; top:0; width:${W}px; height:${H}px; overflow:hidden; background:#140b2b; font-family:"Press Start 2P", monospace; color:#fff; }
  .slg * { box-sizing:border-box; }
  .slg .band { position:absolute; left:0; width:100%; }
  .slg .star { position:absolute; width:6px; height:6px; background:#fff; }
  .slg .moon { position:absolute; left:1660px; top:220px; width:120px; height:120px; border-radius:50%; background:#ffe7a8; box-shadow: 0 0 0 14px #ffe7a822; }
  .slg .hill { position:absolute; bottom:${H - GROUND}px; }
  .slg .ground { position:absolute; left:0; top:${GROUND}px; width:100%; height:${H - GROUND}px; background:#3b2a1e; }
  .slg .ground::before { content:""; position:absolute; left:0; top:0; width:100%; height:28px; background:repeating-linear-gradient(90deg,#4caf50 0 48px,#3d9442 48px 96px); }
  .slg .ground::after { content:""; position:absolute; left:0; top:28px; width:100%; height:100%; background:repeating-linear-gradient(90deg,#3b2a1e 0 64px,#33241a 64px 128px); opacity:.9; }
  .slg .actor { position:absolute; will-change:transform; }
  .slg .hud { position:absolute; text-shadow: 4px 4px 0 #000; }
  .slg .bossbar { position:absolute; left:460px; top:96px; width:1000px; height:34px; background:#2a0f14; border:6px solid #fff; box-shadow: 6px 6px 0 #000; }
  .slg .bossbar i { position:absolute; left:0; top:0; bottom:0; background:#e5484d; }
  .slg .orb { position:absolute; width:44px; height:44px; background:#ff4f7b; box-shadow: inset -10px -10px 0 #b0123d, 0 0 0 6px #ff4f7b55; }
  .slg .bit { position:absolute; width:26px; height:26px; }
  .slg .flash { position:absolute; inset:0; background:#fff; opacity:0; }
  .slg .crit { position:absolute; left:920px; top:300px; font-size:64px; color:#f5c518; text-shadow: 6px 6px 0 #000; white-space:nowrap; }
  .slg .dmg { position:absolute; left:1180px; top:400px; font-size:56px; color:#fff; text-shadow: 6px 6px 0 #e5484d, 10px 10px 0 #000; white-space:nowrap; }
  .slg .win { position:absolute; left:0; width:100%; top:360px; text-align:center; font-size:110px; color:#f5c518; text-shadow: 8px 8px 0 #a0410d, 14px 14px 0 #000; white-space:nowrap; }
  .slg .xp { position:absolute; left:0; width:100%; top:540px; text-align:center; font-size:40px; color:#8af0b5; text-shadow: 5px 5px 0 #000; white-space:nowrap; }
  `;

  function mount(container, { seed = 7 } = {}) {
    const rand = rng(seed);
    if (!document.getElementById("slg-style")) {
      const style = el("style");
      style.id = "slg-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = el("div", "slg");
    const world = el("div", "", `position:absolute;inset:0;`);
    root.appendChild(world);

    // Sky in flat pixel bands, stars, moon, two rows of hills.
    const bands = ["#140b2b", "#1d1140", "#2a1652", "#3d1d63", "#57266f", "#7a3374"];
    bands.forEach((c, i) => world.appendChild(el("div", "band", `top:${i * 120}px;height:${i === bands.length - 1 ? 260 : 120}px;background:${c}`)));
    for (let i = 0; i < 46; i++) world.appendChild(el("div", "star", `left:${Math.floor(rand() * 1900)}px;top:${Math.floor(rand() * 520)}px;opacity:${0.35 + rand() * 0.65}`));
    world.appendChild(el("div", "moon"));
    const hills = (color, base, step, height, offset) => {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("width", W);
      svg.setAttribute("height", height);
      svg.setAttribute("shape-rendering", "crispEdges");
      svg.setAttribute("class", "hill");
      svg.style.left = "0px";
      let d = `M0 ${height}`;
      for (let x = 0; x <= W; x += step) {
        const y = base + Math.round((Math.sin((x + offset) / 170) * 0.5 + Math.sin((x + offset) / 61) * 0.25) * (height - base)) ;
        d += ` L${x} ${Math.max(0, y)} L${x + step} ${Math.max(0, y)}`;
      }
      d += ` L${W} ${height} Z`;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", color);
      svg.appendChild(p);
      return svg;
    };
    world.appendChild(hills("#2b1446", 120, 32, 300, 0));
    world.appendChild(hills("#1b0d30", 150, 24, 220, 400));
    world.appendChild(el("div", "ground"));

    // Actors.
    const boss = el("div", "actor", `left:1210px;top:${GROUND - 20 * 19}px;transform-origin:50% 100%`);
    const bossBody = sprite(BOSS, BOSS_PAL, 19);
    boss.appendChild(bossBody);
    const crown = el("div", "actor", `left:${1210 + 8 * 19}px;top:${GROUND - 20 * 19}px;width:${8 * 19}px;height:${3 * 19}px;overflow:hidden`);
    crown.appendChild(sprite(BOSS.slice(0, 3).map((r) => r.slice(8, 16)), BOSS_PAL, 19));
    const knight = el("div", "actor", `left:560px;top:${GROUND - 15 * 10}px;transform-origin:50% 100%`);
    knight.appendChild(sprite(KNIGHT, KNIGHT_PAL, 10));
    const sword = el("div", "actor", `left:${560 + 112}px;top:${GROUND - 15 * 10 - 30}px;transform-origin:50% 90%`);
    sword.appendChild(sprite(SWORD, SWORD_PAL, 10));
    world.append(boss, crown, knight, sword);

    const orbs = [0, 1].map(() => {
      const o = el("div", "orb", `left:1180px;top:${GROUND - 120}px;opacity:0`);
      world.appendChild(o);
      return o;
    });

    // Explosion bits: fixed vectors from the seeded PRNG.
    const bitColors = ["#2fbf71", "#8af0b5", "#0f4a2b", "#f4f7fb", "#f5c518"];
    const bits = Array.from({ length: 44 }, (_, i) => {
      const b = el("div", "bit", `left:${1210 + 228}px;top:${GROUND - 190}px;background:${bitColors[i % bitColors.length]};opacity:0`);
      world.appendChild(b);
      const angle = rand() * Math.PI * 2;
      const speed = 300 + rand() * 700;
      return { b, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed * 0.7 - 260, rot: (rand() - 0.5) * 720 };
    });

    // HUD.
    const hud = el("div", "", "position:absolute;inset:0");
    hud.appendChild(el("div", "hud", "left:460px;top:44px;font-size:30px;letter-spacing:2px", "O LAG SUPREMO"));
    const bar = el("div", "bossbar");
    const fill = el("i", "", "width:1.4%");
    bar.appendChild(fill);
    hud.appendChild(bar);
    const pct = el("div", "hud", "left:1490px;top:96px;font-size:30px;color:#ff7a7f", "1%");
    hud.appendChild(pct);
    hud.appendChild(el("div", "hud", "left:60px;top:44px;font-size:26px;color:#cfd6ff", "FASE 99"));
    hud.appendChild(el("div", "hud", "left:60px;top:100px;font-size:26px", "LUCAS ♥ 1 HP"));
    hud.appendChild(el("div", "hud", "left:1460px;top:968px;font-size:26px;color:#cfd6ff", "SCORE 999999"));
    world.appendChild(hud);

    const crit = el("div", "crit", "opacity:0", "CRÍTICO!");
    const dmg = el("div", "dmg", "opacity:0", "-9999");
    const flash = el("div", "flash");
    const win = el("div", "win", "opacity:0", "VITÓRIA!");
    const xp = el("div", "xp", "opacity:0", "BOSS DERROTADO  +1000 XP");
    root.append(crit, dmg, flash, win, xp);
    container.appendChild(root);

    function addTo(tl, at = 0) {
      const T = (t) => at + t;
      // Idle bobbing (finite repeats: no infinite loops in a seekable film).
      tl.fromTo(boss, { scaleY: 1, scaleX: 1 }, { scaleY: 0.94, scaleX: 1.04, duration: 0.36, ease: "sine.inOut", yoyo: true, repeat: 7 }, T(0));
      tl.fromTo(crown, { y: 0 }, { y: 22, duration: 0.36, ease: "sine.inOut", yoyo: true, repeat: 7 }, T(0));
      tl.fromTo(sword, { rotation: -8 }, { rotation: 8, duration: 0.36, ease: "sine.inOut", yoyo: true, repeat: 5 }, T(0));

      // Orb 1, dodged with a jump.
      tl.fromTo(orbs[0], { x: 0, y: 0, opacity: 0 }, { opacity: 1, duration: 0.05 }, T(0.25));
      tl.fromTo(orbs[0], { x: 0 }, { x: -1400, duration: 1.3, ease: "none" }, T(0.25));
      tl.to(orbs[0], { opacity: 0, duration: 0.05 }, T(1.5));
      tl.fromTo([knight, sword], { y: 0 }, { y: -240, duration: 0.26, ease: "power2.out" }, T(0.72));
      tl.to([knight, sword], { y: 0, duration: 0.26, ease: "power2.in" }, T(0.98));

      // Charge, dash, hit.
      tl.fromTo(sword, { rotation: 0, scale: 1 }, { rotation: -150, scale: 1.5, duration: 0.3, ease: "back.out(2)", immediateRender: false }, T(1.55));
      tl.fromTo([knight, sword], { x: 0 }, { x: 640, duration: 0.24, ease: "power4.in", immediateRender: false }, T(1.95));
      tl.to(sword, { rotation: 40, duration: 0.12, ease: "power3.out" }, T(2.19));
      tl.fromTo(flash, { opacity: 0.9 }, { opacity: 0, duration: 0.25, ease: "power2.out", immediateRender: false }, T(2.2));
      tl.fromTo(world, { x: 0, y: 0 }, { keyframes: [{ x: -26, y: 14 }, { x: 22, y: -12 }, { x: -16, y: 8 }, { x: 10, y: -4 }, { x: 0, y: 0 }], duration: 0.4, immediateRender: false }, T(2.2));
      tl.fromTo(fill, { width: "1.4%" }, { width: "0%", duration: 0.2, ease: "power2.out", immediateRender: false }, T(2.2));
      tl.set(pct, { textContent: "0%" }, T(2.25));
      tl.fromTo(crit, { opacity: 0, scale: 0.4, rotation: -8 }, { opacity: 1, scale: 1, rotation: -4, duration: 0.25, ease: "back.out(3)", immediateRender: false }, T(2.2));
      tl.fromTo(dmg, { opacity: 0, y: 0 }, { opacity: 1, y: -160, duration: 0.8, ease: "power2.out", immediateRender: false }, T(2.22));
      tl.to([crit, dmg], { opacity: 0, duration: 0.2 }, T(3.0));

      // Boss blinks, then bursts.
      tl.fromTo(boss, { opacity: 1 }, { keyframes: [{ opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], duration: 0.6, immediateRender: false }, T(2.45));
      tl.to(boss, { opacity: 0, scale: 1.25, duration: 0.08 }, T(3.1));
      bits.forEach(({ b, dx, dy, rot }) => {
        tl.fromTo(b, { opacity: 1, x: 0, y: 0, rotation: 0 }, { x: dx, y: dy + 900, rotation: rot, duration: 1.4, ease: "power1.in", immediateRender: false }, T(3.1));
        tl.to(b, { opacity: 0, duration: 0.3 }, T(4.2));
      });
      tl.to(crown, { y: -520, x: 120, rotation: 260, duration: 0.7, ease: "power2.out" }, T(3.1));
      tl.to(crown, { y: 400, rotation: 540, duration: 0.9, ease: "power2.in" }, T(3.8));

      // Victory.
      tl.to([knight, sword], { x: 300, duration: 0.4, ease: "power2.inOut" }, T(3.2));
      tl.to(sword, { rotation: -180, y: -60, duration: 0.3, ease: "back.out(2)" }, T(3.6));
      tl.fromTo(win, { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.2)", immediateRender: false }, T(3.6));
      tl.fromTo(xp, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, T(3.9));
      return tl;
    }

    return { root, addTo };
  }

  window.SLGame = { mount, W, H };
})();
