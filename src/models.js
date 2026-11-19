'use strict';
/* Procedural 3D dishes, real-world scale in metres. Each builder returns { parts:[{geo, mat, matrix}] } */
const Dishes = (() => {
  const { lathe, arc, sphere, dome, cylinder, puck, torus, disc, roundedBox, extrude, tube, displace, computeNormals, merge, M4, V, fbm, noise3, rng, canvas, pixels, bands, Geo } = E3;
  const T = M4.T, S = M4.S, Rx = M4.Rx, Ry = M4.Ry, Rz = M4.Rz, C = (...m) => (m.length === 1 ? m[0] : M4.chain(...m));
  const TAU = Math.PI * 2;
  const COBALT = '#1B3790', SAFFRON = '#F0A81C';
  const P = (geo, mat, matrix) => ({ geo, mat, matrix });

  /* ---------- textures (lazy, cached) ---------- */
  const TX = {};
  const tex = (k, make) => TX[k] || (TX[k] = make());
  const bandsV = (stops, h = 512) => canvas(4, h, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const [v, c] of stops) g.addColorStop(Math.max(0, Math.min(1, 1 - v)), c);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, h);
  });
  const bandsU = (stops, w = 256) => canvas(w, 4, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    for (const [u, c] of stops) g.addColorStop(Math.max(0, Math.min(1, u)), c);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, 4);
  });
  // hard-edged band list: [[v0, v1, color], ...] over a base color, along v (lathe profile)
  function hardBands(base, list, h = 512) {
    const stops = [[0, base], [1, base]];
    const e = 0.6 / h;
    for (const [a, b, c] of list) stops.push([a - e, base], [a + e, c], [b - e, c], [b + e, base]);
    stops.sort((x, y) => x[0] - y[0]);
    return bandsV(stops, h);
  }
  function rnd(seed) { return rng(seed); }

  function latteTex() {
    return canvas(512, 512, (ctx, w, h) => {
      const r = rnd(7);
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#C9965F'); g.addColorStop(0.55, '#A86F40'); g.addColorStop(0.86, '#714224'); g.addColorStop(1, '#4C2A14');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 1400; k++) {
        const x = r() * w, y = r() * h, rr = 1 + r() * 6;
        ctx.fillStyle = r() > 0.5 ? `rgba(255,232,200,${0.03 + r() * 0.05})` : `rgba(70,35,12,${0.03 + r() * 0.06})`;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      }
      const heart = (s, col, dy = 0) => {
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(0, 0.62 * s + dy);
        ctx.bezierCurveTo(-1.12 * s, -0.05 * s + dy, -0.62 * s, -1.0 * s + dy, 0, -0.42 * s + dy);
        ctx.bezierCurveTo(0.62 * s, -1.0 * s + dy, 1.12 * s, -0.05 * s + dy, 0, 0.62 * s + dy);
        ctx.fill();
      };
      ctx.save(); ctx.translate(w / 2, h * 0.53);
      ctx.shadowColor = 'rgba(250,238,220,0.95)'; ctx.shadowBlur = 22;
      heart(150, '#F8EEDF');
      ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(160,110,70,0.6)';
      heart(122, '#BA8452', 6); heart(104, '#F9F1E4', 8); heart(80, '#BD8856', 12); heart(62, '#FBF4EA', 14); heart(38, '#C08C5B', 18); heart(24, '#FCF6EE', 20);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#F6EADB'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -175); ctx.lineTo(0, 92); ctx.stroke();
      ctx.restore();
    });
  }
  function frothTex(base = '#C08551', light = '#E2B98C', seed = 3) {
    return canvas(256, 256, (ctx, w, h) => {
      const r = rnd(seed);
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 700; k++) {
        const x = r() * w, y = r() * h, rr = 0.8 + Math.pow(r(), 3) * 9;
        ctx.strokeStyle = `rgba(90,50,20,${0.15 + r() * 0.2})`; ctx.lineWidth = 0.8;
        ctx.fillStyle = r() > 0.4 ? light : base;
        ctx.globalAlpha = 0.55 + r() * 0.4;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(70,35,12,0.35)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
  }
  function chaiTex() {
    return canvas(256, 256, (ctx, w, h) => {
      const r = rnd(11);
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#CF9A68'); g.addColorStop(0.8, '#BF8657'); g.addColorStop(1, '#8E5A34');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 140; k++) { ctx.fillStyle = `rgba(${r() > 0.5 ? '80,40,15' : '235,200,160'},${0.15 + r() * 0.25})`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 1 + r() * 4, 1 + r() * 2, r() * 3, 0, TAU); ctx.fill(); }
      for (let k = 0; k < 40; k++) { ctx.fillStyle = 'rgba(60,30,10,0.55)'; ctx.fillRect(r() * w, r() * h, 1.5, 1.5); }
    });
  }
  function woodTex() {
    return pixels(512, 512, (u, v) => {
      const w = v * 9 + fbm(u * 1.6, v * 5, 3.3, 4) * 1.4;
      const ring = 0.5 + 0.5 * Math.sin(w * Math.PI * 2);
      const streak = fbm(u * 1.2, v * 70, 9.1, 3) * 0.5 + 0.5;
      const t = 0.5 * Math.pow(ring, 3) + 0.42 * streak;
      return [200 - t * 62, 156 - t * 56, 110 - t * 46];
    });
  }
  const rowsV = (fn, h = 256) => canvas(4, h, (ctx) => { for (let y = 0; y < h; y++) { ctx.fillStyle = fn(1 - (y + 0.5) / h); ctx.fillRect(0, y, 4, 1); } });
  function marbleTex() {
    return pixels(512, 512, (u, v) => {
      const x = u * 4, y = v * 4;
      const t = Math.abs(Math.sin((x * 0.8 + y * 1.3 + fbm(x, y, 0.5, 5) * 5.5) * 1.2));
      const vein = Math.pow(1 - t, 9), soft = Math.pow(1 - t, 3) * 0.25;
      const cloud = fbm(x * 2, y * 2, 4.4, 4) * 0.06;
      const c = 240 - vein * 62 - soft * 26 + cloud * 110;
      return [c - 4 * vein, c - 1 * vein, c + 5 + 4 * vein];
    });
  }
  function tomatoTex() {
    return canvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#B9231A'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#E04A33'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.44, 0, TAU); ctx.fill();
      const r = rnd(5);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4, cx = w / 2 + Math.cos(a) * w * 0.22, cy = h / 2 + Math.sin(a) * h * 0.22;
        ctx.fillStyle = '#F07A55'; ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.13, w * 0.09, a, 0, TAU); ctx.fill();
        for (let s = 0; s < 7; s++) { ctx.fillStyle = '#F2D27A'; ctx.beginPath(); ctx.ellipse(cx + (r() - 0.5) * 30, cy + (r() - 0.5) * 22, 4, 2.4, r() * 3, 0, TAU); ctx.fill(); }
      }
      ctx.fillStyle = '#F39B74'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.08, 0, TAU); ctx.fill();
    });
  }
  const linerTex = () => canvas(512, 8, (ctx, w) => { for (let k = 0; k < 28; k++) { ctx.fillStyle = k % 2 ? '#F7F4EE' : COBALT; ctx.fillRect((k * w) / 28, 0, w / 28 + 1, 8); } });
  const strawTex = () => canvas(8, 256, (ctx, w, h) => { for (let k = 0; k < 16; k++) { ctx.fillStyle = k % 2 ? '#F7F4EE' : COBALT; ctx.fillRect(0, (k * h) / 16, w, h / 16 + 1); } });

  /* ---------- helpers ---------- */
  function planarUV(g, cx = 0, cz = 0, size = 0.1) { g.uv = []; for (let k = 0; k < g.p.length; k += 3) g.uv.push((g.p[k] - cx) / size + 0.5, (g.p[k + 2] - cz) / size + 0.5); return g; }
  function fracs(profile) {
    const L = [0];
    for (let i = 1; i < profile.length; i++) L.push(L[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    return L.map((v) => v / L[L.length - 1]);
  }
  function param(nu, nv, fn) {
    const g = new Geo();
    for (let j = 0; j <= nu; j++) for (let i = 0; i <= nv; i++) { const p = fn(j / nu, i / nv); g.p.push(p[0], p[1], p[2]); g.n.push(0, 1, 0); g.uv.push(j / nu, i / nv); }
    const n = nv + 1;
    for (let j = 0; j < nu; j++) for (let i = 0; i < nv; i++) { const a = j * n + i, b = (j + 1) * n + i, c = a + 1, d = b + 1; g.i.push(a, c, b, b, c, d); }
    return computeNormals(g, true);
  }
  const ellipsoid = (rx, ry, rz, ws = 14, hs = 9) => sphere(1, ws, hs).apply(S(rx, ry, rz));
  // orientation that maps +Y to n and spins by yaw around it
  const orient = (n, yaw = 0) => M4.mul(M4.alignY(n), Ry(yaw));

  /* ---------- materials ---------- */
  const M = {};
  const mat = (k, d) => M[k] || (M[k] = d);
  const porcelain = () => mat('porcelain', { color: '#F5F4F0', rough: 0.14, coat: 0.6, wrap: 0.05 });
  const steel = () => mat('steel', { color: '#D3D8DE', metal: 1, rough: 0.13, vary: 0.03, varyF: 300 });
  const wood = () => mat('wood', { color: '#FFFFFF', map: tex('wood', woodTex), rough: 0.6, spec: 0.7 });
  const glass = () => mat('glass', { color: '#EEF5F6', rough: 0.03, opacity: 0.08, fresnelOpacity: 0.9, transparent: true, spec: 1.6, coat: 0.8, order: 0 });

  /* ---------- tableware ---------- */
  function plate(R, o = {}) {
    const h = o.h || R * 0.14;
    const prof = [
      [0, 0.003], [R * 0.4, 0.003], [R * 0.43, 0], [R * 0.5, 0], [R * 0.53, 0.003],
      [R * 0.75, h * 0.33], [R * 0.92, h * 0.62], [R, h * 0.93],
      [R * 0.996, h], [R * 0.975, h * 1.01], [R * 0.94, h * 0.94],
      [R * 0.86, h * 0.8], [R * 0.78, h * 0.6], [R * 0.7, h * 0.4], [R * 0.64, h * 0.33], [R * 0.5, h * 0.32], [0, h * 0.32],
    ];
    const f = fracs(prof);
    const key = 'plateBand' + f[7].toFixed(4) + f[10].toFixed(4);
    const m = mat('plate' + key, { color: '#FFFFFF', rough: 0.14, coat: 0.6, wrap: 0.05, map: tex(key, () => hardBands('#F5F4F0', [[f[8] + 0.002, f[10], '#173080']])) });
    return { part: P(lathe(prof, { segs: 72 }), m), top: h * 0.32 };
  }
  function bowl(R, H) {
    const prof = [[0, 0.004], [R * 0.33, 0.004], [R * 0.35, 0], [R * 0.41, 0], [R * 0.44, 0.004], [R * 0.6, H * 0.5], [R * 0.7, H * 0.8], [R * 0.8, H * 0.88], [R * 0.97, H * 0.93], [R, H * 0.97], [R * 0.995, H], [R * 0.975, H * 1.005], [R * 0.93, H * 0.985], [R * 0.8, H * 0.95], [R * 0.7, H * 0.88], [R * 0.6, H * 0.6], [R * 0.45, H * 0.22], [R * 0.3, H * 0.17], [0, H * 0.17]];
    const f = fracs(prof);
    const key = 'bowlBand' + f[9].toFixed(4);
    const m = mat('bowl' + key, { color: '#FFFFFF', rough: 0.14, coat: 0.6, map: tex(key, () => hardBands('#F5F4F0', [[f[10], f[12], '#173080']])) });
    return { part: P(lathe(prof, { segs: 72 }), m), floor: H * 0.17 };
  }
  function katori(r = 0.03, h = 0.022) {
    return lathe([[0, 0], [r * 0.72, 0], [r * 0.76, 0.0015], [r * 0.93, h * 0.6], [r * 0.99, h * 0.94], [r * 1.02, h], [r * 0.995, h * 1.05], [r * 0.955, h * 0.99], [r * 0.9, h * 0.6], [r * 0.7, h * 0.14], [0, h * 0.12]], { segs: 48 });
  }
  function board(r = 0.16, h = 0.014) { const g = puck(r, h, 0.003, 64); planarUV(g, 0, 0, Math.max(0.12, r * 2.4)); return g; }

  /* ---------- dishes ---------- */
  const B = {};

  B.cappuccino = () => {
    const parts = [];
    const sauc = plate(0.075, { h: 0.013 });
    parts.push(sauc.part);
    const y0 = sauc.top - 0.0003;
    const cupProf = [[0, 0.0006], [0.02, 0.0006], [0.022, 0], [0.025, 0], [0.0262, 0.003], [0.029, 0.01], [0.0335, 0.02], [0.0375, 0.032], [0.0408, 0.045], [0.043, 0.056], [0.0442, 0.062], [0.044, 0.0636], [0.0428, 0.064], [0.0418, 0.0632], [0.0405, 0.057], [0.0385, 0.047], [0.034, 0.03], [0.028, 0.015], [0, 0.012]];
    parts.push(P(lathe(cupProf, { segs: 64 }), porcelain(), T(0, y0, 0)));
    const coffee = planarUV(disc(0.0399, 64), 0, 0, 0.0798);
    parts.push(P(coffee, mat('latte', { color: '#FFFFFF', map: tex('latte', latteTex), rough: 0.36, coat: 0.25, wrap: 0.2, bump: 0.05, bumpF: 900 }), T(0, y0 + 0.054, 0)));
    const handle = torus(0.0145, 0.0042, 40, 14, { phi0: -0.78 * Math.PI, phiLen: 1.56 * Math.PI });
    parts.push(P(handle, porcelain(), C(T(0.0505, y0 + 0.038, 0), Rx(Math.PI / 2), S(1, 1, 0.75))));
    // spoon
    const bowlG = ellipsoid(0.011, 0.0028, 0.0075, 18, 10);
    const handleG = tube((t) => [0.009 + t * 0.07, 0.002 + Math.sin(t * Math.PI) * 0.003 + t * 0.002, 0], (t) => 0.0016 + t * 0.0012, 20, 8, { squash: 0.45 });
    const spoon = merge([bowlG, handleG]);
    parts.push(P(spoon, steel(), C(T(0.006, y0 + 0.0065, 0.054), Ry(0.35), Rz(-0.04))));
    return { parts };
  };

  B.filterCoffee = () => {
    const parts = [];
    const dav = lathe([[0, 0], [0.04, 0], [0.044, 0.003], [0.047, 0.02], [0.048, 0.03], [0.052, 0.036], [0.0535, 0.0372], [0.052, 0.0386], [0.0495, 0.0366], [0.046, 0.03], [0.0445, 0.012], [0.041, 0.004], [0, 0.004]], { segs: 64 });
    parts.push(P(dav, steel()));
    const fr = planarUV(disc(0.0445, 48), 0, 0, 0.089);
    parts.push(P(fr, mat('froth1', { color: '#FFFFFF', map: tex('froth1', () => frothTex('#8E5A32', '#C9925F', 4)), rough: 0.4, coat: 0.3, wrap: 0.2 }), T(0, 0.013, 0)));
    const tum = lathe([[0, 0], [0.022, 0], [0.0235, 0.002], [0.026, 0.026], [0.0285, 0.066], [0.0295, 0.081], [0.0306, 0.0826], [0.0296, 0.0842], [0.0281, 0.0826], [0.0274, 0.078], [0.025, 0.04], [0, 0.03]], { segs: 64 });
    parts.push(P(tum, steel(), T(0.009, 0.0042, 0.004)));
    const foam = planarUV(disc(0.0277, 48), 0, 0, 0.0554);
    displace(foam, (x, y, z) => [0, 0.0012 * Math.max(0, 1 - Math.hypot(x, z) / 0.03) + 0.0005 * fbm(x * 400, 0, z * 400, 3), 0]);
    parts.push(P(foam, mat('froth2', { color: '#FFFFFF', map: tex('froth2', () => frothTex('#B97F4C', '#E9C499', 9)), rough: 0.55, wrap: 0.35, bump: 0.08, bumpF: 1400 }), T(0.009, 0.0042 + 0.0778, 0.004)));
    return { parts };
  };

  B.masalaChai = () => {
    const parts = [];
    const co = board(0.046, 0.006);
    parts.push(P(co, wood()));
    const prof = [[0, 0], [0.02, 0], [0.0215, 0.002], [0.024, 0.012], [0.028, 0.04], [0.0315, 0.065], [0.033, 0.074], [0.0328, 0.0756], [0.031, 0.0758], [0.0298, 0.0742], [0.029, 0.066], [0.027, 0.05], [0, 0.045]];
    const kul = lathe(prof, { segs: 64, rmod: (phi, y) => 1 + 0.012 * Math.sin(phi * 3 + y * 60) + 0.01 * noise3(Math.cos(phi) * 2, y * 30, Math.sin(phi) * 2) });
    parts.push(P(kul, mat('clay', { color: '#8E4528', rough: 0.85, bump: 0.25, bumpF: 380, vary: 0.2, varyF: 90, wrap: 0.15, sss: '#C46A3D' }), T(0, 0.006, 0)));
    const chai = planarUV(disc(0.0287, 48), 0, 0, 0.0574);
    parts.push(P(chai, mat('chai', { color: '#FFFFFF', map: tex('chai', chaiTex), rough: 0.3, coat: 0.35, wrap: 0.2 }), T(0, 0.006 + 0.0638, 0)));
    // two rusks
    const rusk = roundedBox(0.05, 0.011, 0.02, 0.0035);
    const rm = mat('rusk', { color: '#D9A25E', rough: 0.7, toast: 0.55, varyF: 120, bump: 0.6, bumpF: 260, vary: 0.12, wrap: 0.2 });
    parts.push(P(rusk, rm, C(T(0.03, 0.0115, 0.028), Ry(-0.5))));
    return { parts };
  };

  B.coldCoffee = () => {
    const parts = [];
    const co = board(0.045, 0.005);
    parts.push(P(co, mat('cork', { color: '#B98C5F', rough: 0.9, bump: 0.5, bumpF: 900, vary: 0.25, varyF: 400 })));
    const y0 = 0.005;
    const gl = lathe([[0, 0], [0.028, 0], [0.0295, 0.002], [0.03, 0.006], [0.034, 0.1], [0.0365, 0.145], [0.0362, 0.1466], [0.0347, 0.1462], [0.0336, 0.1], [0.0292, 0.012], [0, 0.0105]], { segs: 64 });
    parts.push(P(gl, glass(), T(0, y0, 0)));
    const liqProf = [[0, 0.0106], [0.0287, 0.0106], [0.0287, 0.0106], [0.0332, 0.1], [0.0334, 0.112], [0.0334, 0.112], [0, 0.112]];
    const lf = fracs(liqProf);
    parts.push(P(lathe(liqProf, { segs: 64 }), mat('iced', { color: '#FFFFFF', rough: 0.22, coat: 0.5, wrap: 0.15, map: tex('icedGrad', () => bandsV([[0, '#4E2D18'], [lf[2], '#5E3720'], [lf[3] * 0.6, '#7C4C2E'], [lf[4], '#A8784F'], [1, '#B98A60']])) }), T(0, y0, 0)));
    // whipped cream swirl
    const cream = mat('cream', { color: '#FBF4E8', rough: 0.6, wrap: 0.55, sss: '#F2D6B0', bump: 0.15, bumpF: 500 });
    const turns = 2.6;
    const sw = tube((t) => { const rr = 0.026 * (1 - t) + 0.002, a = t * turns * TAU; return [rr * Math.cos(a), 0.117 + t * 0.03, rr * Math.sin(a)]; }, (t) => 0.0095 * (1 - t * 0.55), 90, 14);
    parts.push(P(sw, cream, T(0, y0, 0)));
    parts.push(P(ellipsoid(0.007, 0.006, 0.007), cream, T(0, y0 + 0.149, 0)));
    const drizzle = tube((t) => { const rr = 0.028 * (1 - t) + 0.006, a = t * turns * TAU + 0.5; return [rr * Math.cos(a), 0.124 + t * 0.03, rr * Math.sin(a)]; }, (t) => 0.0016 * Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02))), 120, 6);
    parts.push(P(drizzle, mat('choc', { color: '#2E160B', rough: 0.12, coat: 0.9 }), T(0, y0, 0)));
    const straw = tube((t) => [0.006 + t * 0.03, 0.03 + t * 0.165, -0.004 - t * 0.012], 0.0036, 24, 12);
    parts.push(P(straw, mat('straw', { color: '#FFFFFF', map: tex('straw', strawTex), rough: 0.35, coat: 0.3 }), T(0, y0, 0)));
    return { parts };
  };

  B.mangoLassi = () => {
    const parts = [];
    const co = board(0.045, 0.005);
    parts.push(P(co, wood()));
    const y0 = 0.005;
    const gl = lathe([[0, 0], [0.026, 0], [0.0275, 0.003], [0.03, 0.03], [0.032, 0.07], [0.0335, 0.11], [0.036, 0.135], [0.0357, 0.1366], [0.0343, 0.1362], [0.032, 0.11], [0.0305, 0.07], [0.0285, 0.03], [0.026, 0.012], [0, 0.0105]], { segs: 64 });
    parts.push(P(gl, glass(), T(0, y0, 0)));
    const lassi = lathe([[0, 0.0106], [0.0258, 0.0106], [0.0258, 0.0106], [0.028, 0.03], [0.0302, 0.07], [0.0317, 0.11], [0.0322, 0.118], [0.0322, 0.118], [0, 0.118]], { segs: 64 });
    parts.push(P(lassi, mat('lassi', { color: '#E8862A', rough: 0.5, wrap: 0.25, sss: '#F08A2A', vary: 0.05, varyF: 80 }), T(0, y0, 0)));
    const malai = dome(0.0318, 0.008, 48, 10);
    displace(malai, (x, y, z) => 0.0018 * fbm(x * 260, y * 260, z * 260, 3));
    parts.push(P(malai, mat('malai', { color: '#FBE3AE', rough: 0.55, wrap: 0.5, sss: '#F9C46B', bump: 0.2, bumpF: 400 }), T(0, y0 + 0.1175, 0)));
    const r = rnd(21), sf = [], pis = [];
    for (let k = 0; k < 14; k++) {
      const a = r() * TAU, d = r() * 0.02, yy = 0.008 * (1 - (d / 0.032) ** 2) + 0.1185;
      const ang = r() * TAU;
      sf.push(tube((t) => [Math.cos(a) * d + Math.cos(ang) * t * 0.012, yy + 0.001 + Math.sin(t * 3) * 0.0006, Math.sin(a) * d + Math.sin(ang) * t * 0.012], 0.00045, 8, 5));
    }
    for (let k = 0; k < 18; k++) {
      const a = r() * TAU, d = r() * 0.022, yy = 0.008 * (1 - (d / 0.032) ** 2) + 0.1185;
      pis.push(roundedBox(0.003 + r() * 0.002, 0.0016, 0.0025, 0.0006, 2, 2).apply(C(T(Math.cos(a) * d, yy + 0.0009, Math.sin(a) * d), Ry(r() * TAU), Rx((r() - 0.5) * 0.6))));
    }
    parts.push(P(merge(sf), mat('saffron', { color: '#D4420F', rough: 0.4, wrap: 0.3 }), T(0, y0, 0)));
    parts.push(P(merge(pis), mat('pista', { color: '#8DB64A', rough: 0.55, wrap: 0.3, vary: 0.2 }), T(0, y0, 0)));
    return { parts };
  };

  B.croissant = () => {
    const parts = [];
    const pl = plate(0.1);
    parts.push(pl.part);
    const Rc = 0.062, K = 6.5;
    const env = (t) => 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * t), 1.1);
    const rad = (t) => 0.026 * env(t) * (0.86 + 0.17 * Math.pow(Math.abs(Math.sin(Math.PI * t * K)), 0.55));
    const g = tube((t) => { const a = -1.25 + 2.5 * t; return [Rc * Math.sin(a), rad(t) * 0.74 + 0.0004, Rc * Math.cos(a) - Rc * 0.66]; }, rad, 150, 24, { squash: 0.74 });
    displace(g, (x, y, z) => 0.0006 * fbm(x * 320, y * 320, z * 320, 3));
    const ridge = tex('croissantRidge', () => rowsV((v) => { const k = Math.pow(Math.abs(Math.sin(Math.PI * v * K)), 0.5); const c = [150 + 95 * k, 92 + 82 * k, 40 + 60 * k].map((x) => Math.round(Math.min(255, x))); return `rgb(${c[0]},${c[1]},${c[2]})`; }, 512));
    parts.push(P(g, mat('croissant', { color: '#E3A458', map: ridge, rough: 0.4, coat: 0.4, toast: 0.75, varyF: 50, bump: 0.3, bumpF: 240, vary: 0.1, wrap: 0.3, sss: '#E9A15A' }), C(T(0, pl.top, -0.004), Ry(0.2))));
    return { parts };
  };

  B.blueberryMuffin = () => {
    const parts = [];
    const pl = plate(0.075);
    parts.push(pl.part);
    const y0 = pl.top;
    const liner = lathe([[0, 0], [0.026, 0], [0.026, 0], [0.033, 0.034]], { segs: 112, rmod: (phi) => 1 + 0.03 * Math.pow(Math.abs(Math.sin(phi * 14)), 0.6) });
    parts.push(P(liner, mat('liner', { color: '#FFFFFF', map: tex('liner', linerTex), rough: 0.75, wrap: 0.25 }), T(0, y0, 0)));
    const top = dome(0.04, 0.032, 56, 16);
    displace(top, (x, y, z) => 0.0035 * fbm(x * 70, y * 70, z * 70, 4) + (y > 0.001 ? 0.0012 * noise3(x * 300, y * 300, z * 300) : 0));
    parts.push(P(top, mat('muffin', { color: '#C98B47', rough: 0.7, toast: 0.7, varyF: 60, bump: 0.9, bumpF: 170, vary: 0.15, wrap: 0.25 }), T(0, y0 + 0.029, 0)));
    const r = rnd(42), berries = [], sugar = [];
    for (let k = 0; k < 14; k++) {
      const a = r() * TAU, e = 0.25 + r() * 1.0, rr = 0.04 * Math.cos(e) * 0.98, yy = 0.032 * Math.sin(e);
      berries.push(sphere(0.0045 + r() * 0.0012, 12, 8).apply(T(rr * Math.cos(a), y0 + 0.029 + yy + 0.0008, rr * Math.sin(a))));
    }
    for (let k = 0; k < 60; k++) {
      const a = r() * TAU, e = 0.5 + r() * 1.0, rr = 0.041 * Math.cos(e), yy = 0.033 * Math.sin(e);
      sugar.push(roundedBox(0.0016, 0.0016, 0.0016, 0.0003, 1, 1).apply(C(T(rr * Math.cos(a), y0 + 0.029 + yy + 0.001, rr * Math.sin(a)), Ry(r() * 3), Rx(r() * 3))));
    }
    parts.push(P(merge(berries), mat('blueberry', { color: '#323567', rough: 0.55, sheen: 0.5, wrap: 0.2, sss: '#4B2A5E' })));
    parts.push(P(merge(sugar), mat('sugar', { color: '#FFFFFF', rough: 0.25, coat: 0.5 })));
    return { parts };
  };

  B.glazedDonut = () => {
    const parts = [];
    const pl = plate(0.075);
    parts.push(pl.part);
    const R = 0.03, r = 0.016, sq = 0.82, y0 = pl.top + r * sq;
    const dough = torus(R, r, 72, 24).apply(S(1, sq, 1));
    parts.push(P(dough, mat('dough', { color: '#FFFFFF', map: tex('donutBand', () => bandsV([[0, '#C28440'], [0.38, '#C98C47'], [0.46, '#EFD6A6'], [0.54, '#EFD6A6'], [0.62, '#C98C47'], [1, '#C28440']])), rough: 0.6, wrap: 0.3, bump: 0.25, bumpF: 220, vary: 0.1 }), T(0, y0, 0)));
    const ri = r * 1.07;
    const icing = param(144, 26, (u, v) => {
      const phi = u * TAU;
      const lo = -0.14 - 0.36 * Math.pow(Math.max(0, Math.sin(phi * 5 + 0.3)), 6) - 0.12 * Math.pow(Math.max(0, Math.sin(phi * 9)), 8);
      const hi = Math.PI + 0.1 + 0.25 * Math.pow(Math.max(0, Math.sin(phi * 4 + 1)), 6);
      const th = lo + (hi - lo) * v;
      const rr = ri * (1 - 0.06 * (v < 0.04 || v > 0.96 ? 1 : 0));
      return [(R + rr * Math.cos(th)) * Math.cos(phi), rr * Math.sin(th) * sq, (R + rr * Math.cos(th)) * Math.sin(phi)];
    });
    parts.push(P(icing, mat('icing', { color: '#E8789A', rough: 0.1, coat: 0.9, wrap: 0.2, sss: '#FF9DB8' }), T(0, y0, 0)));
    const cols = ['#FAF6EE', SAFFRON, COBALT, '#5FB86B', '#F07A3A'];
    const groups = cols.map(() => []);
    const rg = rnd(99);
    const spr = tube((t) => [0, t * 0.0055 - 0.00275, 0], (t) => 0.00085 * Math.pow(Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, t))), 0.35), 6, 6);
    for (let k = 0; k < 140; k++) {
      const phi = rg() * TAU, th = 0.25 + rg() * (Math.PI - 0.5);
      const n = [Math.cos(th) * Math.cos(phi), Math.sin(th) * sq, Math.cos(th) * Math.sin(phi)];
      const p = [(R + (ri + 0.0008) * Math.cos(th)) * Math.cos(phi), y0 + (ri + 0.0008) * Math.sin(th) * sq, (R + (ri + 0.0008) * Math.cos(th)) * Math.sin(phi)];
      const m = C(T(p[0], p[1], p[2]), orient(V.norm(n), rg() * TAU), Rz(Math.PI / 2));
      groups[k % cols.length].push(spr.clone().apply(m));
    }
    cols.forEach((c, k) => parts.push(P(merge(groups[k]), mat('spr' + k, { color: c, rough: 0.35, coat: 0.3, wrap: 0.15 }))));
    return { parts };
  };

  B.pancakes = () => {
    const parts = [];
    const pl = plate(0.115);
    parts.push(pl.part);
    let y = pl.top;
    const pm = mat('pancake', { color: '#E3A75A', rough: 0.55, toast: 1.0, varyF: 70, wrap: 0.3, bump: 0.35, bumpF: 130, vary: 0.12, sss: '#E7A45A' });
    const r = rnd(3);
    for (let k = 0; k < 4; k++) {
      const rr = 0.056 + r() * 0.004, h = 0.0115;
      const g = puck(rr, h, 0.0045, 72, 4);
      const seed = r() * 10;
      for (let v = 0; v < g.count; v++) { const x = g.p[v * 3], z = g.p[v * 3 + 2], a = Math.atan2(z, x), f = 1 + 0.03 * noise3(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5, seed); g.p[v * 3] *= f; g.p[v * 3 + 2] *= f; }
      computeNormals(g, true);
      parts.push(P(g, pm, C(T((r() - 0.5) * 0.004, y, (r() - 0.5) * 0.004), Ry(r() * TAU))));
      y += h - 0.0012;
    }
    const top = y + 0.0004;
    const syrupM = mat('syrup', { color: '#7E3A0E', rough: 0.05, coat: 1, wrap: 0.1, sss: '#B4581A' });
    const pool = disc(0.044, 64);
    displace(pool, (x, yy, z) => { const a = Math.atan2(z, x), d = Math.hypot(x, z); const edge = 0.034 + 0.008 * noise3(Math.cos(a) * 2, Math.sin(a) * 2, 5); const k = Math.min(1, d / 0.044); return [x / (d || 1) * (edge * k - d), 0.0018 * (1 - k * k), z / (d || 1) * (edge * k - d)]; });
    parts.push(P(pool, syrupM, T(0, top, 0)));
    const drips = [];
    for (let k = 0; k < 4; k++) {
      const a = 0.6 + k * 1.55 + r() * 0.4, len = 0.012 + r() * 0.02;
      drips.push(tube((t) => { const d = 0.056 + 0.0015 * Math.sin(t * Math.PI); const yy = top - t * len; const dd = t < 0.15 ? 0.04 + (d - 0.04) * (t / 0.15) : d + 0.001; return [Math.cos(a) * dd, yy, Math.sin(a) * dd]; }, (t) => 0.0022 + 0.0016 * t, 18, 8));
    }
    parts.push(P(merge(drips), syrupM));
    parts.push(P(roundedBox(0.022, 0.009, 0.019, 0.002), mat('butter', { color: '#F7E08E', rough: 0.35, wrap: 0.45, coat: 0.35, sss: '#F2D26A' }), C(T(-0.004, top + 0.0055, 0.003), Ry(0.5), Rz(0.05))));
    const blu = [], rasp = [];
    for (let k = 0; k < 6; k++) { const a = r() * TAU, d = 0.02 + r() * 0.02; blu.push(sphere(0.0055, 12, 8).apply(T(Math.cos(a) * d, top + 0.005, Math.sin(a) * d))); }
    for (let k = 0; k < 3; k++) {
      const a = 2 + k * 1.2, d = 0.07 + r() * 0.012;
      const g = sphere(0.0085, 18, 12);
      displace(g, (x, yy, z) => 0.0012 * Math.pow(Math.abs(Math.sin(x * 900) * Math.sin(yy * 900) * Math.sin(z * 900)), 0.5));
      rasp.push(g.apply(T(Math.cos(a) * d, pl.top + 0.008, Math.sin(a) * d)));
    }
    parts.push(P(merge(blu), mat('blueberry', { color: '#323567', rough: 0.55, sheen: 0.5, wrap: 0.2, sss: '#4B2A5E' })));
    parts.push(P(merge(rasp), mat('rasp', { color: '#B3203F', rough: 0.45, wrap: 0.45, sss: '#E0405A', coat: 0.2 })));
    parts.push(P(ellipsoid(0.013, 0.0016, 0.0065), mat('mint', { color: '#3F8A3A', rough: 0.35, coat: 0.5, wrap: 0.4, sss: '#6CBF4F' }), C(T(0.012, top + 0.012, -0.004), Ry(0.8), Rz(0.25))));
    return { parts };
  };

  B.avocadoToast = () => {
    const parts = [];
    const bd = roundedBox(0.17, 0.016, 0.115, 0.006);
    planarUV(bd, 0, 0, 0.3);
    parts.push(P(bd, wood(), T(0, 0.008, 0)));
    const y0 = 0.016;
    const outline = [];
    for (let k = 0; k < 48; k++) { const a = (k / 48) * TAU; const rx = 0.068, rz = 0.05; const bump = 1 + 0.06 * Math.max(0, Math.sin(a)) ** 3 + 0.03 * Math.cos(a * 2); outline.push([rx * Math.cos(a) * bump, -rz * Math.sin(a) * (1 + 0.12 * Math.max(0, Math.sin(a)))]); }
    const sl = extrude(outline, 0.016, { bevel: 0.0035, bevelSegs: 3 });
    parts.push(P(sl.side, mat('crust', { color: '#8A5126', rough: 0.7, bump: 0.6, bumpF: 200, vary: 0.2, varyF: 80, toast: 0.3 }), T(0, y0, 0)));
    parts.push(P(sl.caps, mat('crumb', { color: '#E9CF9E', rough: 0.85, bump: 1.4, bumpF: 380, vary: 0.12, toast: 0.35, varyF: 90 }), T(0, y0, 0)));
    const mash = dome(0.05, 0.011, 64, 12).apply(S(1.15, 1, 0.82));
    displace(mash, (x, y, z) => 0.0025 * fbm(x * 120, y * 120, z * 120, 4) - (y < 0.0005 ? 0.002 : 0));
    parts.push(P(mash, mat('avo', { color: '#98B548', rough: 0.45, wrap: 0.4, sss: '#B9D46A', vary: 0.3, varyF: 140, bump: 0.6, bumpF: 280 }), T(0, y0 + 0.0155, 0)));
    const r = rnd(8);
    const skin = mat('tomSkin', { color: '#C4231A', rough: 0.15, coat: 0.6, wrap: 0.3, sss: '#E9442E' });
    const cut = mat('tomCut', { color: '#FFFFFF', map: tex('tomato', tomatoTex), rough: 0.25, coat: 0.6, wrap: 0.4 });
    const spots = [[-0.03, 0.012], [0.026, -0.016], [0.034, 0.016], [-0.012, -0.022]];
    for (const [x, z] of spots) {
      const h = dome(0.0105, 0.0095, 24, 8).apply(Rx(Math.PI));
      const cf = planarUV(disc(0.0105, 24), 0, 0, 0.021);
      const m = C(T(x, y0 + 0.0255, z), Ry(r() * 3), Rx((r() - 0.5) * 0.3));
      parts.push(P(h, skin, m), P(cf, cut, C(m, T(0, 0.0002, 0))));
    }
    const fl = [], seeds = [], blk = [];
    for (let k = 0; k < 40; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.045; fl.push(roundedBox(0.0018, 0.0006, 0.0012, 0.0002, 1, 1).apply(C(T(Math.cos(a) * d * 1.1, y0 + 0.0165 + 0.009 * (1 - (d / 0.05) ** 2), Math.sin(a) * d * 0.85), Ry(r() * 3)))); }
    for (let k = 0; k < 36; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.045; (k % 3 ? seeds : blk).push(ellipsoid(0.0014, 0.0005, 0.0008, 8, 5).apply(C(T(Math.cos(a) * d * 1.1, y0 + 0.0166 + 0.009 * (1 - (d / 0.05) ** 2), Math.sin(a) * d * 0.85), Ry(r() * 3)))); }
    parts.push(P(merge(fl), mat('chili', { color: '#B32E18', rough: 0.5, wrap: 0.2 })));
    parts.push(P(merge(seeds), mat('sesame', { color: '#EFE2C4', rough: 0.5, wrap: 0.3 })));
    parts.push(P(merge(blk), mat('blackSeed', { color: '#2A2522', rough: 0.4 })));
    const leaves = [], stems = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + r() * 0.4, len = 0.012 + r() * 0.006;
      const base = [Math.cos(a) * 0.004, y0 + 0.026, Math.sin(a) * 0.004];
      const tip = [base[0] + Math.cos(a) * len * 0.5, base[1] + len, base[2] + Math.sin(a) * len * 0.5];
      stems.push(tube((t) => V.lerp(base, tip, t), 0.0005, 6, 5));
      leaves.push(ellipsoid(0.0055, 0.0008, 0.0032, 10, 6).apply(C(T(tip[0], tip[1], tip[2]), Ry(-a), Rz(0.5))));
    }
    parts.push(P(merge(stems), mat('stem', { color: '#A6C978', rough: 0.5, wrap: 0.4 })));
    parts.push(P(merge(leaves), mat('micro', { color: '#4E9A35', rough: 0.35, coat: 0.3, wrap: 0.5, sss: '#7CCB4C' })));
    return { parts };
  };

  // rounded right-triangle outline (CCW seen from above) + fraction where the cut (hypotenuse) runs
  function triOutline(L, rc = 0.008, n = 6) {
    const A = [0, 0], Bp = [L, 0], Cp = [0, -L];
    const corners = [A, Bp, Cp];
    const out = [];
    for (let k = 0; k < 3; k++) {
      const p = corners[k], prev = corners[(k + 2) % 3], next = corners[(k + 1) % 3];
      const d1 = V.norm([prev[0] - p[0], 0, prev[1] - p[1]]), d2 = V.norm([next[0] - p[0], 0, next[1] - p[1]]);
      const s = rc;
      const a = [p[0] + d1[0] * s, p[1] + d1[2] * s], b = [p[0] + d2[0] * s, p[1] + d2[2] * s];
      for (let i = 0; i <= n; i++) { const t = i / n; const q = [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * p[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * p[1] + t * t * b[1]]; out.push(q); }
    }
    return out;
  }
  B.vegClub = () => {
    const parts = [];
    const pl = plate(0.11);
    parts.push(pl.part);
    const L = 0.095;
    const pts = triOutline(L, 0.009);
    const breadSide = mat('breadSide', { color: '#E7CF9F', rough: 0.8, bump: 1.1, bumpF: 380, vary: 0.1, varyF: 120 });
    const breadTop = mat('breadTop', { color: '#E2B776', rough: 0.7, toast: 0.9, varyF: 45, bump: 0.6, bumpF: 220, vary: 0.12, wrap: 0.15 });
    const layer = (shape, h, m1, m2, bev = 0.0018) => { const e = extrude(shape, h, { bevel: bev, bevelSegs: 2 }); return [e.side, e.caps, m1, m2]; };
    const wavy = (s, amp, seed) => s.map((p, k) => { const c = [L / 3, -L / 3]; const d = [p[0] - c[0], p[1] - c[1]]; const f = 1 + amp * (0.6 + 0.4 * Math.sin(k * 2.1 + seed)); return [c[0] + d[0] * f, c[1] + d[1] * f]; });
    const fill = (k, col, extra = {}) => mat('fill' + k, Object.assign({ color: col, rough: 0.4, wrap: 0.45, coat: 0.25 }, extra));
    const stack = [];
    let y = 0;
    const add = (spec) => { stack.push([spec, y]); y += spec[4]; };
    const bread = () => { const [s, c] = layer(pts, 0.011, breadSide, breadTop, 0.0022); return [s, c, breadSide, breadTop, 0.011]; };
    const flat = (shape, h, m) => { const e = extrude(shape, h, {}); return [e.side, e.caps, m, m, h]; };
    add(bread());
    add(flat(wavy(pts, 0.05, 1), 0.0022, fill('lettuce', '#7DB443', { sss: '#A8DB64', wrap: 0.6 })));
    add(flat(wavy(pts, 0.015, 2), 0.004, fill('tomato', '#D3301F', { sss: '#F05A3A' })));
    add(flat(wavy(pts, 0.035, 3), 0.0018, fill('cheese', '#F2B53A', { sss: '#F7C95A' })));
    add(bread());
    add(flat(wavy(pts, 0.02, 4), 0.004, fill('cucumber', '#B9D77E', { sss: '#D8EFA0' })));
    add(flat(wavy(pts, 0.03, 5), 0.0035, fill('paneer', '#F5EEDC', { wrap: 0.5 })));
    add(bread());
    const half = (m) => {
      for (const [spec, yy] of stack) { const [s, c, m1, m2] = spec; parts.push(P(s, m1, M4.mul(m, T(0, yy, 0))), P(c, m2, M4.mul(m, T(0, yy, 0)))); }
      parts.push(P(cylinder(0.0011, 0.0011, 0.075, 8), mat('pick', { color: '#E8CF9F', rough: 0.6 }), M4.mul(m, T(L * 0.3, 0.004, -L * 0.3))));
      parts.push(P(ellipsoid(0.0062, 0.0075, 0.0062), mat('olive', { color: '#5E6E23', rough: 0.2, coat: 0.6, wrap: 0.2 }), M4.mul(m, T(L * 0.3, 0.07, -L * 0.3))));
      parts.push(P(cylinder(0.0028, 0.0028, 0.0012, 12), mat('pimento', { color: '#C8281C', rough: 0.3 }), M4.mul(m, T(L * 0.3, 0.0772, -L * 0.3))));
    };
    half(C(T(-0.044, pl.top, 0.046), Ry(0.12)));
    half(C(T(0.046, pl.top, -0.04), Ry(Math.PI + 0.12)));
    return { parts };
  };

  B.chickenBurger = () => {
    const parts = [];
    const bd = board(0.085, 0.012);
    parts.push(P(bd, wood()));
    let y = 0.012;
    const bunM = mat('bun', { color: '#DE9A4C', rough: 0.5, toast: 0.95, varyF: 40, coat: 0.45, wrap: 0.3, sss: '#E8A050', bump: 0.15, bumpF: 200 });
    const bunBot = lathe([[0, 0], [0.046, 0], [0.05, 0.004], [0.0515, 0.011], [0.05, 0.016], [0.046, 0.0185], [0, 0.0185]], { segs: 64 });
    parts.push(P(bunBot, bunM, T(0, y, 0)));
    y += 0.0185;
    const let1 = disc(0.058, 120);
    const r = rnd(5);
    displace(let1, (x, yy, z) => { const d = Math.hypot(x, z), a = Math.atan2(z, x); return [0, (d / 0.058) ** 3 * (0.0045 * Math.sin(a * 11) + 0.0025 * Math.sin(a * 23 + 1)) - (d / 0.058) ** 2 * 0.002, 0]; });
    parts.push(P(let1, mat('lettuce', { color: '#86BD4A', rough: 0.4, wrap: 0.6, sss: '#B7E26A', coat: 0.3, vary: 0.15, varyF: 120 }), T(0, y + 0.002, 0)));
    y += 0.002;
    const patty = puck(0.049, 0.015, 0.005, 72, 4);
    displace(patty, (x, yy, z) => 0.0012 * fbm(x * 200, yy * 200, z * 200, 3));
    parts.push(P(patty, mat('patty', { color: '#9A5A2E', rough: 0.55, toast: 0.75, varyF: 50, bump: 1.2, bumpF: 210, vary: 0.2, coat: 0.25, wrap: 0.1 }), T(0, y, 0)));
    y += 0.015;
    const ch = roundedBox(0.074, 0.0022, 0.074, 0.0009, 3, 10);
    displace(ch, (x, yy, z) => { const d = Math.max(Math.abs(x), Math.abs(z)); const k = Math.max(0, Math.hypot(x, z) - 0.044); return [0, -k * 0.75 - k * k * 6, 0]; });
    parts.push(P(ch, mat('cheese', { color: '#F4B53A', rough: 0.3, wrap: 0.45, coat: 0.45, sss: '#F7C95A' }), C(T(0, y + 0.0011, 0), Ry(0.78))));
    y += 0.0024;
    const tomCap = planarUV(disc(0.023, 32), 0, 0, 0.046);
    const tomSide = cylinder(0.023, 0.023, 0.004, 32, false);
    const tomM = mat('tomSkin', { color: '#C4231A', rough: 0.15, coat: 0.6, wrap: 0.3, sss: '#E9442E' });
    const tomC = mat('tomCut', { color: '#FFFFFF', map: tex('tomato', tomatoTex), rough: 0.25, coat: 0.6, wrap: 0.4 });
    for (const [x, z] of [[-0.016, 0.01], [0.017, -0.008]]) { parts.push(P(tomSide, tomM, T(x, y, z)), P(tomCap, tomC, T(x, y + 0.004, z))); }
    y += 0.0042;
    const onion = merge([torus(0.017, 0.0018, 40, 8).apply(T(0.006, 0, 0.012)), torus(0.013, 0.0016, 36, 8).apply(T(-0.012, 0.0005, -0.01))]);
    parts.push(P(onion, mat('onion', { color: '#E8C9E4', rough: 0.3, coat: 0.5, wrap: 0.5, sss: '#C77DBF' }), T(0, y + 0.0015, 0)));
    const mayo = sphere(0.006, 16, 10).apply(S(1.6, 0.5, 1));
    parts.push(P(mayo, mat('mayo', { color: '#F4ECD3', rough: 0.25, coat: 0.5, wrap: 0.5 }), T(0.04, y - 0.001, 0.018)));
    y += 0.0025;
    const top = lathe([[0, 0], [0.048, 0], [0.0515, 0.003], [0.0525, 0.008], ...E3.arc(0, 0.008, 0.0525, 0, Math.PI / 2, 12).map(([xx, yy]) => [xx, 0.008 + (yy - 0.008) * 0.6]).slice(1)], { segs: 72 });
    computeNormals(top, true);
    parts.push(P(top, bunM, T(0, y, 0)));
    const ses = [];
    const sh = 0.0525 * 0.6, sr = 0.0525;
    for (let k = 0; k < 55; k++) {
      const a = r() * TAU, e = 0.45 + r() * 1.05;
      const p = [sr * Math.cos(e) * Math.cos(a), 0.008 + sh * Math.sin(e), sr * Math.cos(e) * Math.sin(a)];
      const n = V.norm([Math.cos(e) * Math.cos(a) / sr, Math.sin(e) / sh, Math.cos(e) * Math.sin(a) / sr]);
      ses.push(ellipsoid(0.0019, 0.0007, 0.0011, 8, 5).apply(C(T(p[0], y + p[1] + 0.0003, p[2]), orient(n, r() * TAU))));
    }
    parts.push(P(merge(ses), mat('sesame', { color: '#EFE2C4', rough: 0.5, wrap: 0.3 })));
    return { parts };
  };

  B.margherita = () => {
    const parts = [];
    const bd = board(0.155, 0.012);
    const handle = roundedBox(0.09, 0.012, 0.034, 0.004);
    planarUV(handle, 0.2, 0, 0.31);
    parts.push(P(bd, wood()), P(handle, wood(), T(0.19, 0.006, 0)));
    const y0 = 0.012;
    parts.push(P(puck(0.128, 0.006, 0.002, 96, 2), mat('base', { color: '#E8C27D', rough: 0.7, toast: 0.4, varyF: 60 }), T(0, y0, 0)));
    const crust = torus(0.121, 0.012, 160, 18).apply(S(1, 0.72, 1));
    displace(crust, (x, y, z) => 0.0025 * fbm(x * 45, y * 45, z * 45, 4));
    parts.push(P(crust, mat('crust', { color: '#E9B867', rough: 0.6, toast: 1.0, varyF: 70, bump: 0.6, bumpF: 160, vary: 0.15, wrap: 0.25 }), T(0, y0 + 0.007, 0)));
    const sauce = disc(0.116, 96);
    displace(sauce, (x, y, z) => [0, 0.0008 * fbm(x * 90, 0, z * 90, 3), 0]);
    parts.push(P(sauce, mat('sauce', { color: '#B02C18', rough: 0.35, coat: 0.35, vary: 0.25, varyF: 90, wrap: 0.25 }), T(0, y0 + 0.0063, 0)));
    const r = rnd(12), cheese = [], basil = [];
    const spots = [[0, 0], [0.055, 0.02], [-0.05, 0.03], [0.02, -0.06], [-0.035, -0.05], [0.07, -0.035], [-0.075, -0.01], [0.03, 0.07], [-0.02, 0.075]];
    for (const [x, z] of spots) {
      const g = dome(0.019 + r() * 0.006, 0.0045, 32, 6);
      displace(g, (xx, yy, zz) => { const a = Math.atan2(zz, xx); return [Math.cos(a) * 0.004 * noise3(Math.cos(a) * 2 + x * 50, Math.sin(a) * 2, z * 50), 0.001 * fbm(xx * 200, yy * 200, zz * 200, 3), Math.sin(a) * 0.004 * noise3(Math.cos(a) * 2 + x * 50, Math.sin(a) * 2, z * 50)]; });
      cheese.push(g.apply(C(T(x, y0 + 0.0064, z), Ry(r() * TAU), S(1 + r() * 0.3, 1, 1))));
    }
    parts.push(P(merge(cheese), mat('mozz', { color: '#FBF2DC', rough: 0.35, coat: 0.35, toast: 0.35, varyF: 120, wrap: 0.4, sss: '#F5DDB0' })));
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + r(), d = 0.03 + r() * 0.06;
      const g = ellipsoid(0.014, 0.0011, 0.0078, 14, 6);
      displace(g, (x, y, z) => [0, -Math.abs(x) * 0.08 + z * z * 8, 0]);
      basil.push(g.apply(C(T(Math.cos(a) * d, y0 + 0.0115, Math.sin(a) * d), Ry(r() * TAU))));
    }
    parts.push(P(merge(basil), mat('basil', { color: '#2E6A2A', rough: 0.3, coat: 0.55, wrap: 0.4, sss: '#57A23E' })));
    return { parts };
  };

  B.penne = () => {
    const parts = [];
    const bw = bowl(0.11, 0.042);
    parts.push(bw.part);
    const fl = bw.floor;
    const pool = disc(0.062, 64);
    displace(pool, (x, y, z) => [0, 0.004 * (1 - (Math.hypot(x, z) / 0.062) ** 2) + 0.0008 * fbm(x * 80, 0, z * 80, 2), 0]);
    parts.push(P(pool, mat('arrab', { color: '#A02B14', rough: 0.3, coat: 0.5, wrap: 0.3, vary: 0.2, varyF: 100 }), T(0, fl + 0.0005, 0)));
    const r = rnd(77), pen = [];
    const base = cylinder(0.0054, 0.0054, 0.036, 16, false).apply(T(0, -0.018, 0));
    for (let k = 0; k < 62; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 0.052;
      const yy = fl + 0.008 + 0.022 * (1 - (d / 0.06) ** 2) * (0.6 + r() * 0.4);
      const g = base.clone();
      displace(g, (x, y, z) => { return [0, 0, 0]; });
      pen.push(g.apply(C(T(Math.cos(a) * d, yy, Math.sin(a) * d), Ry(r() * TAU), Rz(Math.PI / 2 + (r() - 0.5) * 0.9), Rx((r() - 0.5) * 0.5))));
    }
    parts.push(P(merge(pen), mat('pasta', { color: '#C8521F', rough: 0.38, coat: 0.3, wrap: 0.3, vary: 0.22, varyF: 160, sss: '#E0602A' })));
    const parm = [], pars = [];
    for (let k = 0; k < 26; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.045; parm.push(roundedBox(0.0035 + r() * 0.002, 0.0006, 0.0018 + r() * 0.001, 0.0002, 1, 1).apply(C(T(Math.cos(a) * d, fl + 0.036 * (1 - (d / 0.06) ** 2) + 0.004, Math.sin(a) * d), Ry(r() * 3), Rx((r() - 0.5) * 0.8)))); }
    for (let k = 0; k < 50; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.048; pars.push(roundedBox(0.0016, 0.0005, 0.0012, 0.0002, 1, 1).apply(C(T(Math.cos(a) * d, fl + 0.034 * (1 - (d / 0.06) ** 2) + 0.005, Math.sin(a) * d), Ry(r() * 3)))); }
    parts.push(P(merge(parm), mat('parm', { color: '#F3E6B9', rough: 0.55, wrap: 0.35 })));
    parts.push(P(merge(pars), mat('parsley', { color: '#3C7A2E', rough: 0.4, wrap: 0.3 })));
    const leaves = [];
    for (let k = 0; k < 3; k++) { const g = ellipsoid(0.013, 0.0011, 0.0075, 14, 6); displace(g, (x, y, z) => [0, -Math.abs(x) * 0.1 + z * z * 8, 0]); leaves.push(g.apply(C(T(0.004, fl + 0.041, 0.002), Ry(k * 2.1), T(0.009, 0, 0), Rz(-0.25)))); }
    parts.push(P(merge(leaves), mat('basil', { color: '#2E6A2A', rough: 0.3, coat: 0.55, wrap: 0.4, sss: '#57A23E' })));
    return { parts };
  };

  B.samosa = () => {
    const parts = [];
    const pl = plate(0.11);
    parts.push(pl.part);
    const sm = mat('samosa', { color: '#D88E3C', rough: 0.45, toast: 0.85, varyF: 70, bump: 1.3, bumpF: 230, vary: 0.14, coat: 0.3, wrap: 0.25, sss: '#E9A85A' });
    const prof = [[0, 0], [0.03, 0], [0.034, 0.005], [0.033, 0.016], [0.026, 0.032], [0.016, 0.047], [0.007, 0.058], [0.002, 0.0625], [0, 0.063]];
    const make = (seed) => { const g = lathe(prof, { segs: 72, rmod: (phi, y) => (1 + 0.24 * Math.cos(3 * phi)) * (1 + 0.02 * noise3(Math.cos(phi) * 3 + seed, y * 40, Math.sin(phi) * 3)) }); return displace(g, (x, y, z) => 0.0009 * fbm(x * 150 + seed, y * 150, z * 150, 3)); };
    parts.push(P(make(1), sm, C(T(-0.026, pl.top, -0.01), Ry(0.4))));
    parts.push(P(make(5), sm, C(T(0.03, pl.top, -0.024), Ry(1.3))));
    const kat = katori(0.026, 0.02);
    for (const [x, z, col, k] of [[-0.03, 0.055, '#4C8D2C', 'mintCh'], [0.038, 0.048, '#6A2C12', 'imli']]) {
      parts.push(P(kat, steel(), T(x, pl.top, z)));
      const s = disc(0.0236, 32);
      displace(s, (xx, y, zz) => [0, 0.0006 * fbm(xx * 200, 0, zz * 200, 2), 0]);
      parts.push(P(s, mat(k, { color: col, rough: 0.25, coat: 0.5, wrap: 0.3, vary: 0.15, varyF: 200 }), T(x, pl.top + 0.0165, z)));
    }
    return { parts };
  };

  B.fries = () => {
    const parts = [];
    const pl = plate(0.1);
    parts.push(pl.part);
    const y0 = pl.top;
    const prof = [[0, 0], [0.031, 0], [0.031, 0], [0.043, 0.072]];
    const ff = fracs(prof);
    const carton = lathe(prof, { segs: 48, rmod: (phi) => 1 + 0.035 * Math.cos(4 * phi) });
    parts.push(P(carton, mat('carton', { color: '#FFFFFF', map: tex('cartonBand', () => hardBands(COBALT, [[ff[2] + (1 - ff[2]) * 0.72, ff[2] + (1 - ff[2]) * 0.8, SAFFRON]])), rough: 0.65, wrap: 0.2 }), T(-0.012, y0, 0.005)));
    const r = rnd(31), fr = [], specks = [];
    for (let k = 0; k < 30; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 0.022, len = 0.07 + r() * 0.03;
      const tilt = 0.08 + (d / 0.022) * 0.22;
      const g = roundedBox(0.0085, len, 0.0085, 0.0022, 2, 4);
      const m = C(T(-0.012 + Math.cos(a) * d, y0 + 0.012 + len / 2 + r() * 0.01, 0.005 + Math.sin(a) * d), Ry(-a), Rz(tilt * (r() > 0.5 ? 1 : -1) * 0.5 + tilt * 0.5), Ry(r() * 3));
      fr.push(g.apply(m));
      for (let s = 0; s < 3; s++) specks.push(roundedBox(0.0012, 0.0012, 0.0012, 0.0003, 1, 1).apply(C(m, T((r() - 0.5) * 0.008, len * (0.1 + r() * 0.38), 0.0043))));
    }
    parts.push(P(merge(fr), mat('fry', { color: '#D98F2E', rough: 0.5, toast: 0.55, varyF: 90, bump: 0.3, bumpF: 220, vary: 0.18, wrap: 0.15, sss: '#E9A040', coat: 0.2 })));
    parts.push(P(merge(specks), mat('periperi', { color: '#C2401A', rough: 0.6 })));
    const kt = katori(0.022, 0.018);
    parts.push(P(kt, steel(), T(0.05, y0, -0.02)));
    const dip = disc(0.0198, 32);
    displace(dip, (x, y, z) => [0, 0.003 * (1 - (Math.hypot(x, z) / 0.02) ** 2), 0]);
    parts.push(P(dip, mat('dip', { color: '#E59A55', rough: 0.25, coat: 0.5, wrap: 0.4 }), T(0.05, y0 + 0.015, -0.02)));
    return { parts };
  };

  B.chocoCake = () => {
    const parts = [];
    const pl = plate(0.095);
    parts.push(pl.part);
    const Rr = 0.1, half = 0.36, pts = [[0, 0]];
    for (let k = 0; k <= 14; k++) { const a = -half + (2 * half * k) / 14; pts.push([Rr * Math.cos(a), -Rr * Math.sin(a)]); }
    const sponge = mat('sponge', { color: '#4B2817', rough: 0.85, bump: 1.6, bumpF: 520, vary: 0.15, varyF: 160, wrap: 0.2 });
    const gan = mat('ganache', { color: '#2A140B', rough: 0.18, coat: 0.7, wrap: 0.1 });
    const layers = [[0.017, sponge], [0.004, gan], [0.017, sponge], [0.004, gan], [0.017, sponge], [0.006, gan]];
    let y = 0;
    const off = C(T(-0.045, pl.top, 0), Ry(0.5));
    for (const [h, m] of layers) { const e = extrude(pts, h, m === gan ? {} : { bevel: 0.0008, bevelSegs: 1 }); parts.push(P(e.all, m, M4.mul(off, T(0, y, 0)))); y += h; }
    const ring = [];
    for (let k = 0; k <= 14; k++) { const a = -half + (2 * half * k) / 14; ring.push([(Rr + 0.0025) * Math.cos(a), -(Rr + 0.0025) * Math.sin(a)]); }
    for (let k = 14; k >= 0; k--) { const a = -half + (2 * half * k) / 14; ring.push([(Rr - 0.0004) * Math.cos(a), -(Rr - 0.0004) * Math.sin(a)]); }
    parts.push(P(extrude(ring, y + 0.0015, { sharp: 70 }).all, gan, off));
    parts.push(P(extrude(pts, 0.0012, {}).all, gan, M4.mul(off, T(0, y, 0))));
    const r = rnd(4), curls = [];
    for (let k = 0; k < 7; k++) {
      const x = 0.035 + r() * 0.05, z = (r() - 0.5) * 0.03 * (x / 0.05), a = r() * TAU;
      curls.push(tube((t) => [Math.cos(t * 9) * 0.0025 + t * 0.012, Math.sin(t * 9) * 0.0025, 0], 0.0011, 30, 6).apply(C(M4.mul(off, T(x, y + 0.004, z)), Ry(a))));
    }
    parts.push(P(merge(curls), mat('curl', { color: '#3A1C0E', rough: 0.3, coat: 0.4 })));
    parts.push(P(sphere(0.0085, 20, 14), mat('cherry', { color: '#9C0E1A', rough: 0.08, coat: 1, wrap: 0.3, sss: '#D8203A' }), M4.mul(off, T(0.068, y + 0.0092, 0))));
    parts.push(P(tube((t) => [Math.sin(t * 1.4) * 0.008, t * 0.022, 0], 0.0007, 12, 5), mat('cstem', { color: '#5B6B2A', rough: 0.5 }), M4.mul(off, T(0.068, y + 0.016, 0))));
    const dr = tube((t) => [0.02 + t * 0.07 - 0.035, 0.0012, Math.sin(t * TAU * 1.2) * 0.022 + 0.05], 0.0022, 60, 6, { squash: 0.35 });
    parts.push(P(dr, gan, T(0, pl.top, 0)));
    return { parts };
  };

  B.sizzler = () => {
    const parts = [];
    const bd = board(0.125, 0.016);
    parts.push(P(bd, wood()));
    const y0 = 0.016;
    const iron = lathe([[0, 0], [0.095, 0], [0.1, 0.004], [0.104, 0.013], [0.102, 0.0145], [0.098, 0.0125], [0.094, 0.006], [0.085, 0.004], [0, 0.004]], { segs: 72 });
    parts.push(P(iron, mat('iron', { color: '#2C2C2F', metal: 0.6, rough: 0.55, vary: 0.2, varyF: 200, bump: 0.3, bumpF: 400 }), T(0, y0, 0)));
    const pool = disc(0.07, 64);
    displace(pool, (x, y, z) => { const a = Math.atan2(z, x), d = Math.hypot(x, z), e = 0.055 + 0.012 * noise3(Math.cos(a) * 2, Math.sin(a) * 2, 2); const k = d / 0.07; return [x / (d || 1) * (e * k - d), 0.0012 * (1 - k * k), z / (d || 1) * (e * k - d)]; });
    const choc = mat('chocSauce', { color: '#2A1309', rough: 0.08, coat: 1, wrap: 0.1 });
    parts.push(P(pool, choc, T(0, y0 + 0.0042, 0)));
    const br = roundedBox(0.074, 0.032, 0.068, 0.004, 3, 3);
    displace(br, (x, y, z) => (y > 0.012 ? 0.0012 * fbm(x * 150, 0, z * 150, 4) : 0.0003 * noise3(x * 300, y * 300, z * 300)));
    parts.push(P(br, mat('brownie', { color: '#3F2214', rough: 0.55, toast: 0.25, varyF: 80, bump: 1.1, bumpF: 260, vary: 0.2, coat: 0.25, wrap: 0.15 }), C(T(0, y0 + 0.0045 + 0.016, 0), Ry(0.3))));
    const sy = y0 + 0.0045 + 0.032;
    const scoop = sphere(0.024, 40, 26);
    displace(scoop, (x, y, z) => 0.0014 * fbm(x * 90, y * 90, z * 90, 4) - (y < -0.012 ? (-0.012 - y) * 0.7 : 0));
    parts.push(P(scoop.apply(S(1, 0.86, 1)), mat('vanilla', { color: '#F7ECD5', rough: 0.62, wrap: 0.55, sss: '#F0D2A8', bump: 0.7, bumpF: 240, vary: 0.05, varyF: 300 }), T(0.004, sy + 0.017, 0.002)));
    const cap = param(96, 20, (u, v) => {
      const phi = u * TAU, edge = 0.62 + 0.55 * Math.pow(Math.max(0, Math.sin(phi * 3 + 0.5)), 6) + 0.22 * Math.pow(Math.max(0, Math.sin(phi * 7)), 8);
      const th = edge * (1 - v);
      const rr = 0.0246 + 0.0002;
      return [rr * Math.sin(th) * Math.cos(phi), rr * Math.cos(th) * 0.86, rr * Math.sin(th) * Math.sin(phi)];
    });
    parts.push(P(cap, choc, T(0.004, sy + 0.017, 0.002)));
    const r = rnd(9), nuts = [];
    for (let k = 0; k < 6; k++) { const g = sphere(0.0045, 12, 8); displace(g, (x, y, z) => 0.0012 * noise3(x * 600, y * 600, z * 600)); nuts.push(g.apply(C(T((r() - 0.5) * 0.06, sy + 0.001, (r() - 0.5) * 0.05), S(1.3, 0.6, 1)))); }
    parts.push(P(merge(nuts), mat('walnut', { color: '#9A6A3B', rough: 0.6, wrap: 0.2, vary: 0.25, varyF: 300 })));
    return { parts };
  };

  /* ---------- registry ---------- */
  const LIST = [
    ['cappuccino', 'Cappuccino'], ['filterCoffee', 'Filter coffee'], ['masalaChai', 'Masala chai'], ['coldCoffee', 'Cold coffee'], ['mangoLassi', 'Mango lassi'],
    ['croissant', 'Croissant'], ['blueberryMuffin', 'Muffin'], ['glazedDonut', 'Donut'], ['pancakes', 'Pancakes'], ['avocadoToast', 'Avocado toast'],
    ['vegClub', 'Club sandwich'], ['chickenBurger', 'Burger'], ['margherita', 'Pizza'], ['penne', 'Pasta'], ['samosa', 'Samosa'], ['fries', 'Fries'],
    ['chocoCake', 'Cake slice'], ['sizzler', 'Sizzling brownie'],
  ];
  const cache = {};
  function get(key) {
    if (!B[key]) key = 'cappuccino';
    if (!cache[key]) cache[key] = B[key]();
    return cache[key];
  }
  // marble table top used for the "virtual table" background
  let marble = null;
  function table() {
    if (marble) return marble;
    const g = planarUV(disc(1.2, 96), 0, 0, 0.55);
    marble = { parts: [P(g, { color: '#FFFFFF', map: tex('marble', marbleTex), rough: 0.18, coat: 0.5, wrap: 0, fadeR: 1.0, transparent: false })] };
    return marble;
  }
  return { get, LIST, keys: LIST.map((x) => x[0]), table, tex: TX };
})();
