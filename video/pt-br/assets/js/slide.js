// The study group's slide ("TCC — Grupo 4") that Gabi presents in the video. 1920×1080.
//   SLSlide.mount(container) → { root, bars }  (bars: the chart's bar elements, to animate)
(function () {
  const CSS = `
  .sls { position:absolute; left:0; top:0; width:1920px; height:1080px; background:#fbfaf7; color:#1d2230; font-family: Inter, sans-serif; overflow:hidden; }
  .sls .side { position:absolute; left:0; top:0; bottom:0; width:28px; background:#4f6bed; }
  .sls .kicker { position:absolute; left:150px; top:120px; font-size:30px; font-weight:700; color:#4f6bed; letter-spacing:.02em; }
  .sls h1 { position:absolute; left:150px; top:170px; margin:0; font-size:84px; line-height:1.05; font-weight:800; letter-spacing:-.02em; width:900px; }
  .sls ul { position:absolute; left:150px; top:470px; margin:0; padding:0; list-style:none; font-size:38px; line-height:1.5; width:820px; color:#3a4152; }
  .sls li::before { content:"— "; color:#4f6bed; font-weight:800; }
  .sls .chart { position:absolute; left:1100px; top:200px; width:680px; height:640px; }
  .sls .chart .axis { position:absolute; left:0; right:0; bottom:80px; height:4px; background:#1d2230; }
  .sls .bar { position:absolute; bottom:84px; width:150px; border-radius:10px 10px 0 0; transform-origin:50% 100%; }
  .sls .lbl { position:absolute; bottom:20px; width:200px; text-align:center; font-size:26px; font-weight:600; color:#3a4152; }
  .sls .val { position:absolute; width:150px; text-align:center; font-size:34px; font-weight:800; }
  .sls .ctitle { position:absolute; left:0; top:-10px; font-size:28px; font-weight:700; color:#3a4152; }
  .sls .foot { position:absolute; left:150px; bottom:70px; font-size:24px; color:#8a90a0; }
  .sls .page { position:absolute; right:90px; bottom:70px; font-size:24px; color:#8a90a0; }
  `;
  const BARS = [
    { label: "Ping 20 ms", value: 92, color: "#3dd68c" },
    { label: "Ping 80 ms", value: 64, color: "#f5a524" },
    { label: "Ping 200 ms", value: 21, color: "#e5484d" },
  ];

  function mount(container) {
    if (!document.getElementById("sls-style")) {
      const s = document.createElement("style");
      s.id = "sls-style";
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    const root = document.createElement("div");
    root.className = "sls";
    root.innerHTML = `
      <i class="side"></i>
      <div class="kicker">TCC · Grupo 4 · Resultados</div>
      <h1>Latência muda o jogo</h1>
      <ul>
        <li>40 jogadores, 3 níveis de ping</li>
        <li>Acertos caem 77% a 200 ms</li>
        <li>Abaixo de 50 ms ninguém percebe</li>
      </ul>
      <div class="chart"><div class="ctitle">Taxa de acerto (%)</div><i class="axis"></i></div>
      <div class="foot">Gabi · Bia · Nanda · Lucas</div>
      <div class="page">7 / 12</div>`;
    const chart = root.querySelector(".chart");
    const bars = BARS.map((b, i) => {
      const left = 30 + i * 220;
      const bar = document.createElement("i");
      bar.className = "bar";
      bar.style.cssText = `left:${left}px;height:${b.value * 4.8}px;background:${b.color}`;
      const val = document.createElement("div");
      val.className = "val";
      val.style.cssText = `left:${left}px;bottom:${84 + b.value * 4.8 + 14}px;color:${b.color}`;
      val.textContent = `${b.value}%`;
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.style.left = `${left - 25}px`;
      lbl.textContent = b.label;
      chart.append(bar, val, lbl);
      return bar;
    });
    container.appendChild(root);
    return { root, bars };
  }

  window.SLSlide = { mount };
})();
