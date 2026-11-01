// "TRETA EM BRASÍLIA": the made-up fighting game the video streams. A political parody: two
// pixel caricatures trade specials in front of the Congresso Nacional and the round ends in a
// double K.O. ("empate técnico"), so nobody wins. Pixel art drawn as SVG rects and animated
// with GSAP, so every frame is a pure function of timeline time (HyperFrames seeks).
//
//   const game = SLGame.mount(container);        // builds a 1920×1080 scene inside container
//   game.addTo(tl, startTime);                    // adds the round (~7 s) to a paused timeline
//
// Beats of the round, relative to startTime (82.5 BPM, one beat = 0.727 s):
//   0.00  P1 charges: "DEMOCRACIA..."          1.46  "RELATIVAAAAAA!!" and the beam
//   2.18  P2's shield takes it: "DEFESAAA...."  3.64  "IMBROCHÁVEEEELLL!!!", the beams fight
//   5.09  it all blows up                       5.46  "DOUBLE K.O.!"   6.18  "EMPATE TÉCNICO"
(function () {
  const W = 1920;
  const H = 1080;
  const GROUND = 860;
  const P = 0.72727; // one beat

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
  // Characters are drawn as their left half and mirrored; `marks` then breaks the symmetry
  // ([row, col, char]: a pin, a hair parting).
  const mirror = (half, marks = []) => {
    const rows = half.map((r) => r + [...r].reverse().join(""));
    marks.forEach(([y, x, ch]) => (rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1)));
    return rows;
  };

  // P1: white hair and beard, dark suit, red tie, red star pin.
  const P1 = mirror(
    [
      "....ghhh",
      "..ghhhhh",
      ".ghhhhhh",
      ".ghsssss",
      ".gssggss",
      ".gsseess",
      ".gsssssS",
      ".bbsssss",
      ".bbbBBBB",
      ".bbbbbmm",
      "..bbbbbb",
      "...bbbbb",
      ".....bbb",
      "...JJJww",
      "..JJJJwr",
      ".JJJJJwr",
      "JJJJJJJr",
      "JjJJJJJr",
      "JjJJJJJJ",
      "ssJJJJJJ",
      "..pppppp",
      "...ppp..",
      "...ppp..",
      "..kkkk..",
    ],
    [[15, 3, "R"], [15, 4, "R"], [16, 3, "R"]],
  );
  const P1_PAL = { h: "#e3e6ea", g: "#a3a9b2", s: "#e2a77f", S: "#c08560", e: "#1b1b1f", b: "#f4f5f7", B: "#c9cdd3", m: "#7a2e2e", J: "#27324d", j: "#1a2236", w: "#f5f5f5", r: "#d62828", R: "#ff3b3b", p: "#222a3f", k: "#121212" };

  // P2: dark side-parted hair, clean-shaven, the yellow-and-green football shirt.
  const P2 = mirror(
    [
      "...ddddd",
      "..dddddd",
      ".ddddddd",
      ".ddddddd",
      ".dssssss",
      ".dssddss",
      ".dsseess",
      ".ssssssS",
      ".Sssssss",
      ".Sssssmm",
      "..ssssss",
      "...sssss",
      "......ss",
      "..YYYYGG",
      ".YYYYYYG",
      "YYYYYYYY",
      "GYYYYYYY",
      "sYYYYYYY",
      "sYYYYYYY",
      "..UUUUUU",
      "..UUUUUU",
      "...ss...",
      "...ww...",
      "..kkk...",
    ],
    [[3, 10, "s"], [3, 11, "s"], [3, 12, "D"], [2, 11, "D"]],
  );
  const P2_PAL = { d: "#2b2b30", D: "#5b5b66", s: "#edb994", S: "#cf9672", e: "#1b1b1f", m: "#8a3a3a", Y: "#ffd400", G: "#0f9d58", U: "#1f4fbf", w: "#f2f2f2", k: "#121212" };

  // P2's special: a shield in the flag's colours.
  const SHIELD = [
    "..OOOOOOOO..",
    ".OGGGGGGGGO.",
    "OGGGGYYGGGGO",
    "OGGGYYYYGGGO",
    "OGGYYYYYYGGO",
    "OGYYYBBYYYGO",
    "OGYYBBBBYYGO",
    "OYYBBWWBBYYO",
    "OGYYBBBBYYGO",
    "OGYYYBBYYYGO",
    "OGGYYYYYYGGO",
    "OGGGYYYYGGGO",
    "OGGGGYYGGGGO",
    ".OGGGGGGGGO.",
    ".OGGGGGGGGO.",
    "..OGGGGGGO..",
    "..OGGGGGGO..",
    "...OGGGGO...",
    "....OGGO....",
    ".....OO.....",
  ];
  const SHIELD_PAL = { O: "#0b3d1f", G: "#12a150", Y: "#ffd400", B: "#1f3fbf", W: "#ffffff" };

  // P1's special: a red star at the head of the beam.
  const STAR = [
    ".....W.....",
    "....WRW....",
    "....WRW....",
    "WWWWRRRWWWW",
    ".WRRRRRRRW.",
    "..WRRRRRW..",
    "..WRRRRRW..",
    ".WRRRWRRRW.",
    ".WRRW.WRRW.",
    "WRRW...WRRW",
    "WWW.....WWW",
  ];
  const STAR_PAL = { R: "#ff2d2d", W: "#ffffff" };

  // Press Start 2P draws accented capitals as small lowercase-looking glyphs, so an acute is
  // drawn here: the plain capital plus two pixels above it (one font pixel = 1/8 em).
  const ACUTE = { "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U" };
  const fmt = (text) => [...text].map((c) => (ACUTE[c] ? `<span class="acc">${ACUTE[c]}</span>` : c)).join("");

  function el(tag, cls, style, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }

  const P1X = 520; // fighters' left edges; 16 px wide sprites at 15 px → 240 px
  const P2X = 1180;
  const BEAM_X = P1X + 230; // where the beam leaves P1's hands
  const BEAM_Y = GROUND - 250;
  const CONTACT = 1010; // the shield's front
  const CSS = `
  .slg { position:absolute; left:0; top:0; width:${W}px; height:${H}px; overflow:hidden; background:#1b1035; font-family:"Press Start 2P", monospace; color:#fff; }
  .slg * { box-sizing:border-box; }
  .slg .band { position:absolute; left:0; width:100%; }
  .slg .star { position:absolute; width:6px; height:6px; background:#fff; }
  .slg .sun { position:absolute; left:1470px; top:430px; width:200px; height:200px; border-radius:50%; background:#ffb347; box-shadow:0 0 0 22px #ffb34733, 0 0 0 48px #ffb34718; }
  .slg .cn { position:absolute; background:#2a1538; }
  .slg .cn.win { background:#ffcf6e; width:8px; height:8px; }
  .slg .ground { position:absolute; left:0; top:${GROUND}px; width:100%; height:${H - GROUND}px; background:#2f6b33; }
  .slg .ground::before { content:""; position:absolute; left:0; top:0; width:100%; height:24px; background:repeating-linear-gradient(90deg,#4caf50 0 48px,#3d9442 48px 96px); }
  .slg .ground::after { content:""; position:absolute; left:0; top:110px; width:100%; height:110px; background:repeating-linear-gradient(90deg,#55555f 0 120px,#4a4a54 120px 240px); }
  .slg .actor { position:absolute; will-change:transform; }
  .slg .shadow { position:absolute; top:${GROUND - 12}px; width:220px; height:24px; border-radius:50%; background:#00000055; }
  .slg .hud { position:absolute; text-shadow: 4px 4px 0 #000; white-space:nowrap; }
  .slg .hp { position:absolute; top:70px; width:700px; height:44px; background:#3a0d16; border:6px solid #fff; box-shadow: 6px 6px 0 #000; }
  .slg .hp i { position:absolute; top:0; bottom:0; background:#f5c518; }
  .slg .hp.p1 { left:80px; } .slg .hp.p1 i { right:0; }
  .slg .hp.p2 { left:1140px; } .slg .hp.p2 i { left:0; }
  .slg .timer { position:absolute; left:900px; top:52px; width:120px; height:84px; display:grid; place-items:center; font-size:52px; background:#111; border:6px solid #fff; box-shadow: 6px 6px 0 #000; }
  .slg .aura { position:absolute; left:${P1X - 90}px; top:${GROUND - 470}px; width:420px; height:500px; border-radius:50%; background:radial-gradient(closest-side, #ff3b3bcc, #ff3b3b55 60%, #ff3b3b00); opacity:0; }
  .slg .glow { position:absolute; left:${CONTACT - 260}px; top:${BEAM_Y - 200}px; width:520px; height:470px; border-radius:50%; background:radial-gradient(closest-side, #fff8, #ffd40066 55%, #ffd40000); opacity:0; }
  .slg .beam { position:absolute; left:${BEAM_X}px; top:${BEAM_Y}px; width:0; height:84px; background:linear-gradient(#ff8a8a, #ff2d2d 28%, #fff 50%, #ff2d2d 72%, #ff8a8a); box-shadow: 0 0 30px #ff2d2d, 0 0 0 6px #ff2d2d44; opacity:0; }
  .slg .beam .head { position:absolute; right:-60px; top:-13px; }
  .slg .spark { position:absolute; width:20px; height:20px; }
  .slg .bit { position:absolute; width:28px; height:28px; }
  .slg .flash { position:absolute; inset:0; background:#fff; opacity:0; }
  .slg .call { position:absolute; top:220px; font-size:52px; line-height:1.5; white-space:pre; text-shadow: 5px 5px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000; }
  .slg .call b { display:block; font-weight:400; }
  .slg .call.p1 { left:80px; text-align:left; transform-origin:0% 50%; }
  .slg .call.p1 b + b { color:#ff6b6b; }
  .slg .call.p2 { right:80px; text-align:right; transform-origin:100% 50%; }
  .slg .call.p2 b + b { color:#ffd400; }
  .slg .acc { position:relative; }
  .slg .acc::after { content:""; position:absolute; left:0.375em; top:-0.2em; width:0.125em; height:0.125em; background:currentColor; box-shadow: 0.125em -0.125em 0 currentColor; }
  .slg .ko { position:absolute; left:0; width:100%; top:360px; text-align:center; font-size:120px; color:#f5c518; text-shadow: 8px 8px 0 #a0410d, 14px 14px 0 #000; white-space:nowrap; }
  .slg .draw { position:absolute; left:0; width:100%; top:560px; text-align:center; font-size:56px; color:#8af0b5; text-shadow: 6px 6px 0 #000; white-space:nowrap; }
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

    // Sunset over Brasília: flat pixel bands, a few stars, the sun.
    const bands = ["#1b1035", "#2c1650", "#4a1d63", "#7a2b6b", "#b8466a", "#e8775a"];
    bands.forEach((c, i) => world.appendChild(el("div", "band", `top:${i * 130}px;height:${i === bands.length - 1 ? 300 : 130}px;background:${c}`)));
    for (let i = 0; i < 34; i++) world.appendChild(el("div", "star", `left:${Math.floor(rand() * 1900)}px;top:${Math.floor(rand() * 330)}px;opacity:${0.3 + rand() * 0.6}`));
    world.appendChild(el("div", "sun"));

    // The Congresso Nacional in silhouette: the slab, the two towers, the dome and the bowl.
    const cn = (x, y, w, h, extra = "") => world.appendChild(el("div", "cn", `left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}`));
    cn(600, GROUND - 70, 720, 70);
    cn(920, GROUND - 440, 40, 370);
    cn(980, GROUND - 440, 40, 370);
    cn(960, GROUND - 330, 20, 18);
    cn(680, GROUND - 160, 210, 90, "border-radius:105px 105px 0 0");
    cn(1090, GROUND - 160, 250, 90, "border-radius:0 0 125px 125px");
    for (let y = GROUND - 420; y < GROUND - 90; y += 22) {
      [928, 944, 988, 1004].forEach((x) => {
        if (rand() < 0.45) world.appendChild(el("div", "cn win", `left:${x}px;top:${y}px`));
      });
    }
    world.appendChild(el("div", "ground"));

    // Fighters, the shield, the beam.
    const aura = el("div", "aura");
    world.appendChild(aura);
    world.appendChild(el("div", "shadow", `left:${P1X + 10}px`));
    world.appendChild(el("div", "shadow", `left:${P2X + 10}px`));
    const p1 = el("div", "actor", `left:${P1X}px;top:${GROUND - 24 * 15}px;transform-origin:50% 100%`);
    p1.appendChild(sprite(P1, P1_PAL, 15));
    const p2 = el("div", "actor", `left:${P2X}px;top:${GROUND - 24 * 15}px;transform-origin:50% 100%`);
    p2.appendChild(sprite(P2, P2_PAL, 15));
    const shield = el("div", "actor", `left:${CONTACT}px;top:${BEAM_Y - 118}px;transform-origin:50% 50%;opacity:0`);
    shield.appendChild(sprite(SHIELD, SHIELD_PAL, 16));
    const beam = el("div", "beam");
    const head = el("div", "head");
    head.appendChild(sprite(STAR, STAR_PAL, 10));
    beam.appendChild(head);
    // Glow and sparks ride one layer, so the push-back moves them with the shield.
    const clash = el("div", "", "position:absolute;inset:0");
    const glow = el("div", "glow");
    clash.appendChild(glow);
    world.append(p1, p2, beam, shield, clash);

    // Sparks where beam meets shield, and the bits of the final blast (seeded vectors).
    const sparkColors = ["#ffffff", "#ffd400", "#ff6b6b", "#8af0b5"];
    const sparks = Array.from({ length: 18 }, (_, i) => {
      const s = el("div", "spark", `left:${CONTACT - 10}px;top:${BEAM_Y + 32}px;background:${sparkColors[i % 4]};opacity:0`);
      clash.appendChild(s);
      const a = Math.PI * (0.6 + rand() * 0.8) * (rand() < 0.5 ? 1 : -1);
      const v = 90 + rand() * 170;
      return { s, dx: Math.cos(a) * v, dy: Math.sin(a) * v };
    });
    const bitColors = ["#ff2d2d", "#ffd400", "#12a150", "#ffffff", "#1f3fbf"];
    const bits = Array.from({ length: 48 }, (_, i) => {
      const b = el("div", "bit", `left:${CONTACT - 14}px;top:${BEAM_Y + 28}px;background:${bitColors[i % bitColors.length]};opacity:0`);
      world.appendChild(b);
      const angle = rand() * Math.PI * 2;
      const speed = 300 + rand() * 750;
      return { b, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed * 0.7 - 260, rot: (rand() - 0.5) * 720 };
    });

    // HUD: health bars that fill toward the timer, names, the round.
    const hud = el("div", "", "position:absolute;inset:0");
    const hp1 = el("div", "hp p1");
    const fill1 = el("i", "", "width:11%");
    hp1.appendChild(fill1);
    const hp2 = el("div", "hp p2");
    const fill2 = el("i", "", "width:9%");
    hp2.appendChild(fill2);
    hud.append(hp1, hp2);
    hud.appendChild(el("div", "timer", "", "07"));
    hud.appendChild(el("div", "hud", "left:80px;top:136px;font-size:30px", "LULA"));
    hud.appendChild(el("div", "hud", "right:80px;top:136px;font-size:30px", "BOLSONARO"));
    hud.appendChild(el("div", "hud", "left:0;width:100%;top:156px;text-align:center;font-size:22px;color:#cfd6ff", "ROUND FINAL"));
    hud.appendChild(el("div", "hud", "right:60px;top:1000px;font-size:22px;color:#cfd6ff")).innerHTML = fmt("TRETA EM BRASÍLIA");
    world.appendChild(hud);

    // The specials, shouted.
    const call1 = el("div", "call p1");
    const c1a = el("b", "", "", "");
    const c1b = el("b", "", "", "");
    call1.append(c1a, c1b);
    const call2 = el("div", "call p2");
    const c2a = el("b", "", "", "");
    const c2b = el("b", "", "", "");
    call2.append(c2a, c2b);
    const flash = el("div", "flash");
    const ko = el("div", "ko", "opacity:0", "DOUBLE K.O.!");
    const draw = el("div", "draw", "opacity:0");
    draw.innerHTML = fmt("EMPATE TÉCNICO");
    root.append(call1, call2, flash, ko, draw);
    container.appendChild(root);

    // Text typed out with discrete sets, so a seek lands on the same letters every time.
    // `from` letters appear at once, the rest one by one until `end`.
    function type(tl, node, text, at, end, from = 0) {
      const steps = text.length - from;
      for (let i = 0; i <= steps; i++) tl.set(node, { innerHTML: fmt(text.slice(0, from + i)) }, at + (steps ? (i / steps) * (end - at) : 0));
    }
    const shake = (tl, at, amp = 1) =>
      tl.fromTo(world, { x: 0, y: 0 }, { keyframes: [{ x: -26 * amp, y: 14 * amp }, { x: 22 * amp, y: -12 * amp }, { x: -16 * amp, y: 8 * amp }, { x: 10 * amp, y: -4 * amp }, { x: 0, y: 0 }], duration: 0.4, immediateRender: false }, at);

    function addTo(tl, at = 0) {
      const T = (t) => at + t;
      // Fighting-stance bob, both (finite repeats: no infinite loops in a seekable film).
      tl.fromTo([p1, p2], { scaleY: 1 }, { scaleY: 0.965, duration: P / 2, ease: "sine.inOut", yoyo: true, repeat: 13 }, T(0));

      // P1 charges: "DEMOCRACIA..."
      tl.set(call1, { opacity: 1 }, T(0));
      type(tl, c1a, "DEMOCRACIA...", T(0.05), T(0.95));
      tl.fromTo(aura, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out", immediateRender: false }, T(0.1));
      tl.fromTo(aura, { scale: 1 }, { scale: 1.12, duration: P / 4, yoyo: true, repeat: 7, ease: "sine.inOut", immediateRender: false }, T(0.6));
      tl.fromTo(p1, { y: 0 }, { y: 14, duration: 0.3, ease: "power2.out", immediateRender: false }, T(0.2));

      // "RELATIVAAAAAA!!" and the beam.
      type(tl, c1b, "RELATIVAAAAAA!!", T(1.46), T(2.0), 7);
      tl.fromTo(call1, { scale: 1 }, { keyframes: [{ scale: 1.08 }, { scale: 1 }, { scale: 1.05 }, { scale: 1 }], duration: 0.5, immediateRender: false }, T(1.46));
      tl.to(p1, { y: 0, x: -24, duration: 0.12, ease: "power3.out" }, T(1.46));
      tl.fromTo(beam, { opacity: 0, width: 0 }, { opacity: 1, width: CONTACT - BEAM_X, duration: P, ease: "power1.in", immediateRender: false }, T(1.46));
      tl.to(aura, { opacity: 0.5, duration: 0.3 }, T(2.0));

      // P2's shield takes it: "DEFESAAA...."
      tl.fromTo(shield, { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1, duration: 0.18, ease: "back.out(2.5)", immediateRender: false }, T(2.0));
      tl.fromTo(p2, { x: 0 }, { x: 30, duration: 0.15, ease: "power3.out", immediateRender: false }, T(2.18));
      tl.fromTo(glow, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.2, immediateRender: false }, T(2.18));
      shake(tl, T(2.18), 0.6);
      tl.fromTo(fill2, { width: "9%" }, { width: "6%", duration: 0.2, immediateRender: false }, T(2.2));
      tl.to(call1, { opacity: 0, duration: 0.25 }, T(2.45));
      tl.set(call2, { opacity: 1 }, T(2.18));
      type(tl, c2a, "DEFESAAA....", T(2.25), T(3.0));

      // Sparks for as long as the two specials push against each other.
      [2.18, 2.55, 2.9, 3.27, 3.64, 4.0, 4.36, 4.72].forEach((t0, k) => {
        sparks.forEach(({ s, dx, dy }, i) => {
          if ((i + k) % 2) return;
          tl.fromTo(s, { opacity: 1, x: 0, y: 0 }, { x: dx, y: dy, opacity: 0, duration: 0.34, ease: "power2.out", immediateRender: false }, T(t0 + (i % 3) * 0.04));
        });
      });

      // "IMBROCHÁVEEEELLL!!!": the shield grows and pushes the beam back, P1 pushes again.
      type(tl, c2b, "IMBROCHÁVEEEELLL!!!", T(3.64), T(4.3), 9);
      tl.fromTo(call2, { scale: 1 }, { keyframes: [{ scale: 1.08 }, { scale: 1 }, { scale: 1.05 }, { scale: 1 }], duration: 0.5, immediateRender: false }, T(3.64));
      tl.to(shield, { scale: 1.3, duration: 0.2, ease: "back.out(2)" }, T(3.64));
      tl.to([shield, clash], { x: -150, duration: 0.5, ease: "power2.out" }, T(3.7));
      tl.to(beam, { width: CONTACT - BEAM_X - 150, duration: 0.5, ease: "power2.out" }, T(3.7));
      tl.to(p2, { x: -40, duration: 0.3, ease: "power2.out" }, T(3.64));
      tl.fromTo(fill1, { width: "11%" }, { width: "7%", duration: 0.2, immediateRender: false }, T(3.8));
      shake(tl, T(3.64), 0.8);
      tl.to(aura, { opacity: 1, scale: 1.25, duration: 0.3 }, T(4.36));
      tl.to([shield, clash], { x: 0, duration: 0.6, ease: "power2.inOut" }, T(4.36));
      tl.to(beam, { width: CONTACT - BEAM_X, duration: 0.6, ease: "power2.inOut" }, T(4.36));
      tl.fromTo(glow, { scale: 1 }, { scale: 1.5, duration: 0.7, ease: "power2.in", immediateRender: false }, T(4.4));

      // It all blows up: both fly, both fall.
      const B = 5.09;
      tl.fromTo(flash, { opacity: 1 }, { opacity: 0, duration: 0.45, ease: "power2.out", immediateRender: false }, T(B));
      shake(tl, T(B), 1.3);
      tl.to([beam, shield, glow, aura, call2], { opacity: 0, duration: 0.06 }, T(B));
      bits.forEach(({ b, dx, dy, rot }) => {
        tl.fromTo(b, { opacity: 1, x: 0, y: 0, rotation: 0 }, { x: dx, y: dy + 900, rotation: rot, duration: 1.5, ease: "power1.in", immediateRender: false }, T(B));
        tl.to(b, { opacity: 0, duration: 0.3 }, T(B + 1.2));
      });
      tl.to(p1, { x: -150, y: -160, rotation: -70, duration: 0.42, ease: "power2.out" }, T(B));
      tl.to(p1, { y: 0, rotation: -90, duration: 0.36, ease: "power2.in" }, T(B + 0.42));
      tl.to(p2, { x: 150, y: -160, rotation: 70, duration: 0.42, ease: "power2.out" }, T(B));
      tl.to(p2, { y: 0, rotation: 90, duration: 0.36, ease: "power2.in" }, T(B + 0.42));
      tl.to([fill1, fill2], { width: "0%", duration: 0.25, ease: "power2.out" }, T(B + 0.05));
      shake(tl, T(B + 0.8), 0.5);

      // DOUBLE K.O. — EMPATE TÉCNICO.
      tl.fromTo(ko, { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.2)", immediateRender: false }, T(5.46));
      tl.fromTo(draw, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, T(6.18));
      return tl;
    }

    return { root, addTo };
  }

  window.SLGame = { mount, W, H };
})();
