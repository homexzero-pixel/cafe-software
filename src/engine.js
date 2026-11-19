'use strict';
/* E3 - a small dependency-free WebGL1 renderer tuned for food.
   Geometry builders, procedural textures, PBR-ish shading with
   wrap/subsurface, procedural bump + browning, shadow map, shadow
   catcher for AR compositing. */
const E3 = (() => {
  const TAU = Math.PI * 2;

  /* ---------------- random + noise ---------------- */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PERM = new Uint8Array(512);
  (() => {
    const r = rng(1337), p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();
  const h3 = (x, y, z) => PERM[PERM[PERM[x & 255] + (y & 255)] + (z & 255)] / 255;
  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    const x0 = L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v);
    const x1 = L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v);
    return L(x0, x1, w) * 2 - 1;
  }
  function fbm(x, y, z, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
  }

  /* ---------------- color ---------------- */
  function hex(h) {
    if (Array.isArray(h)) return h;
    h = h.replace('#', '');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const toLin = (c) => hex(c).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));

  /* ---------------- vec / mat ---------------- */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };
  const M4 = {
    id() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    chain(...ms) { return ms.reduce((acc, m) => M4.mul(acc, m)); },
    T(x, y, z) { const m = M4.id(); m[12] = x; m[13] = y; m[14] = z; return m; },
    S(x, y = x, z = x) { const m = M4.id(); m[0] = x; m[5] = y; m[10] = z; return m; },
    Rx(a) { const m = M4.id(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    Ry(a) { const m = M4.id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    Rz(a) { const m = M4.id(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    // rotation that maps +Y to direction d
    alignY(d) {
      d = V.norm(d);
      const y = [0, 1, 0], c = V.dot(y, d);
      if (c > 0.99999) return M4.id();
      if (c < -0.99999) return M4.Rx(Math.PI);
      const ax = V.norm(V.cross(y, d)), a = Math.acos(c);
      return M4.axisAngle(ax, a);
    },
    axisAngle(ax, a) {
      const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c, m = M4.id();
      m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
      m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
      m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
      return m;
    },
    persp(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
      return m;
    },
    ortho(l, r, b, t, n, f) {
      const m = M4.id();
      m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n);
      return m;
    },
    lookAt(eye, target, up = [0, 1, 0]) {
      let z = V.norm(V.sub(eye, target));
      let x = V.cross(up, z);
      if (V.len(x) < 1e-6) x = V.cross([0, 0, 1], z);
      x = V.norm(x);
      const y = V.cross(z, x), m = new Float32Array(16);
      m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
      m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
      m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
      m[12] = -V.dot(x, eye); m[13] = -V.dot(y, eye); m[14] = -V.dot(z, eye); m[15] = 1;
      return m;
    },
    inv(m) {
      const o = new Float32Array(16);
      const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return M4.id();
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    // 3x3 inverse-transpose of the upper-left of m (for normals)
    normal3(m) {
      const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const det = a * A + b * B + c * C || 1e-12, s = 1 / det;
      return new Float32Array([
        A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
        B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
        C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
      ]);
    },
    xform(m, p) {
      const x = p[0], y = p[1], z = p[2], w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    },
  };

  /* ---------------- geometry ---------------- */
  class Geo {
    constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
    get count() { return this.p.length / 3; }
    clone() { const g = new Geo(); g.p = this.p.slice(); g.n = this.n.slice(); g.uv = this.uv.slice(); g.i = this.i.slice(); return g; }
    apply(m) {
      const nm = M4.normal3(m);
      for (let k = 0; k < this.p.length; k += 3) {
        const x = this.p[k], y = this.p[k + 1], z = this.p[k + 2];
        this.p[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
        this.p[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        this.p[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const a = this.n[k], b = this.n[k + 1], c = this.n[k + 2];
        let nx = nm[0] * a + nm[3] * b + nm[6] * c, ny = nm[1] * a + nm[4] * b + nm[7] * c, nz = nm[2] * a + nm[5] * b + nm[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        this.n[k] = nx / l; this.n[k + 1] = ny / l; this.n[k + 2] = nz / l;
      }
      // mirrored transforms flip winding
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      if (det < 0) for (let k = 0; k < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; }
      return this;
    }
    bounds() {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < this.p.length; k += 3) for (let a = 0; a < 3; a++) { const v = this.p[k + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
      return { min: mn, max: mx };
    }
  }
  function merge(list) {
    const g = new Geo();
    for (const s of list) {
      if (!s) continue;
      const base = g.count;
      for (const v of s.p) g.p.push(v);
      for (const v of s.n) g.n.push(v);
      for (const v of s.uv) g.uv.push(v);
      for (const v of s.i) g.i.push(v + base);
    }
    return g;
  }

  function computeNormals(g, weld = true) {
    const vc = g.count, acc = new Float64Array(vc * 3);
    let map = null;
    if (weld) {
      map = new Int32Array(vc);
      const keys = new Map();
      for (let v = 0; v < vc; v++) {
        const k = Math.round(g.p[v * 3] * 2e5) + ',' + Math.round(g.p[v * 3 + 1] * 2e5) + ',' + Math.round(g.p[v * 3 + 2] * 2e5);
        let t = keys.get(k);
        if (t === undefined) { t = v; keys.set(k, v); }
        map[v] = t;
      }
    }
    const P = g.p;
    for (let t = 0; t < g.i.length; t += 3) {
      const a = g.i[t], b = g.i[t + 1], c = g.i[t + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { const d = map ? map[v] : v; acc[d * 3] += nx; acc[d * 3 + 1] += ny; acc[d * 3 + 2] += nz; }
    }
    for (let v = 0; v < vc; v++) {
      const s = map ? map[v] : v;
      const x = acc[s * 3], y = acc[s * 3 + 1], z = acc[s * 3 + 2], l = Math.hypot(x, y, z);
      if (l > 1e-20) { g.n[v * 3] = x / l; g.n[v * 3 + 1] = y / l; g.n[v * 3 + 2] = z / l; }
    }
    return g;
  }

  // Surface of revolution around Y. profile: [[r, y], ...] or [[r, y, nr, ny], ...]
  // A repeated point creates a crease. x = r cos(phi), z = r sin(phi).
  function lathe(profile, o = {}) {
    const segs = o.segs || 48, phi0 = o.phi0 || 0, phiLen = o.phiLen == null ? TAU : o.phiLen;
    const g = new Geo(), n = profile.length, nrm = [];
    const same = (a, b) => a && b && Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
    for (let i = 0; i < n; i++) {
      const p = profile[i];
      if (p.length >= 4) { nrm.push([p[2], p[3]]); continue; }
      let prev = profile[i - 1], next = profile[i + 1];
      if (same(prev, p)) prev = null;
      if (same(next, p)) next = null;
      let tr = 0, ty = 0;
      if (prev) { const dr = p[0] - prev[0], dy = p[1] - prev[1], l = Math.hypot(dr, dy) || 1; tr += dr / l; ty += dy / l; }
      if (next) { const dr = next[0] - p[0], dy = next[1] - p[1], l = Math.hypot(dr, dy) || 1; tr += dr / l; ty += dy / l; }
      if (!prev && !next) ty = 1;
      const l = Math.hypot(tr, ty) || 1;
      nrm.push([ty / l, -tr / l]);
    }
    const lens = [0];
    for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    const total = lens[n - 1] || 1;
    for (let j = 0; j <= segs; j++) {
      const phi = phi0 + (phiLen * j) / segs, c = Math.cos(phi), s = Math.sin(phi);
      for (let i = 0; i < n; i++) {
        let r = profile[i][0];
        const y = profile[i][1];
        if (o.rmod) r *= o.rmod(phi, y, i / (n - 1));
        g.p.push(r * c, y, r * s);
        g.n.push(nrm[i][0] * c, nrm[i][1], nrm[i][0] * s);
        g.uv.push(j / segs, o.vByIndex ? i / (n - 1) : lens[i] / total);
      }
    }
    for (let j = 0; j < segs; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = (j + 1) * n + i, c = j * n + i + 1, d = (j + 1) * n + i + 1;
        if (profile[i][0] === 0 && profile[i + 1][0] === 0) continue;
        g.i.push(a, c, b, b, c, d);
      }
    if (o.rmod) computeNormals(g, true);
    return g;
  }
  const arc = (cx, cy, r, a0, a1, n) => { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };

  function sphere(r, ws = 32, hs = 18) {
    const prof = [];
    for (let i = 0; i <= hs; i++) { const t = (Math.PI * i) / hs, s = Math.sin(t), c = -Math.cos(t); prof.push([r * s, r * c, s, c]); }
    return lathe(prof, { segs: ws });
  }
  // dome: spherical cap from equator (y=0) to top, radius r, flattened by k
  function dome(r, h, ws = 32, hs = 12, closed = true) {
    const prof = closed ? [[0, 0], [r, 0]] : [];
    for (let i = 0; i <= hs; i++) { const t = (Math.PI / 2) * (i / hs); prof.push([r * Math.cos(t), h * Math.sin(t)]); }
    if (closed) prof.splice(2, 0, [r, 0]);
    return lathe(prof, { segs: ws });
  }
  function cylinder(rb, rt, h, segs = 32, caps = true) {
    const P = caps ? [[0, 0], [rb, 0], [rb, 0], [rt, h], [rt, h], [0, h]] : [[rb, 0], [rt, h]];
    return lathe(P, { segs });
  }
  // cylinder with rounded (filleted) top+bottom edges
  function puck(r, h, f, segs = 40, fs = 4) {
    f = Math.min(f, h / 2, r);
    const P = [[0, 0]];
    P.push(...arc(r - f, f, f, -Math.PI / 2, 0, fs));
    P.push(...arc(r - f, h - f, f, 0, Math.PI / 2, fs));
    P.push([0, h]);
    return lathe(P, { segs });
  }
  function torus(R, r, segs = 48, ts = 16, o = {}) {
    const v0 = o.v0 == null ? -Math.PI : o.v0, v1 = o.v1 == null ? Math.PI : o.v1, prof = [];
    for (let k = 0; k <= ts; k++) { const v = v0 + ((v1 - v0) * k) / ts; prof.push([R + r * Math.cos(v), r * Math.sin(v), Math.cos(v), Math.sin(v)]); }
    return lathe(prof, { segs, phi0: o.phi0, phiLen: o.phiLen });
  }
  function disc(r, segs = 48) { return lathe([[r, 0], [0, 0]], { segs }); }
  function plane(w, d) {
    const g = new Geo(), x = w / 2, z = d / 2;
    g.p.push(-x, 0, z, x, 0, z, -x, 0, -z, x, 0, -z);
    g.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    g.uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    g.i.push(0, 1, 2, 1, 3, 2);
    return g;
  }
  function roundedBox(w, h, d, r, K = 4, Mid = 2) {
    const g = new Geo(), hx = w / 2, hy = h / 2, hz = d / 2;
    r = Math.max(1e-5, Math.min(r, hx, hy, hz));
    const axisCoords = (hh) => {
      const out = [], rr = Math.min(r, hh);
      for (let k = 0; k <= K; k++) out.push(-hh + (rr * k) / K);
      for (let m = 1; m < Mid; m++) out.push(-(hh - rr) + (2 * (hh - rr) * m) / Mid);
      for (let k = 0; k <= K; k++) out.push(hh - rr + (rr * k) / K);
      return out.filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-9);
    };
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const H = [hx, hy, hz];
    const cl = (v, a) => Math.max(-a, Math.min(a, v));
    for (const [N, U, Vv] of faces) {
      const ua = U.findIndex((v) => v !== 0), va = Vv.findIndex((v) => v !== 0), na = N.findIndex((v) => v !== 0);
      const us = axisCoords(H[ua]), vs = axisCoords(H[va]);
      const base = g.count, nu = us.length, nv = vs.length;
      for (let tj = 0; tj < nv; tj++) for (let si = 0; si < nu; si++) {
        const p = [0, 0, 0];
        p[na] = N[na] * H[na]; p[ua] = us[si] * U[ua]; p[va] = vs[tj] * Vv[va];
        const inner = [cl(p[0], hx - r), cl(p[1], hy - r), cl(p[2], hz - r)];
        let nn = V.sub(p, inner);
        const l = V.len(nn);
        nn = l > 1e-12 ? V.mul(nn, 1 / l) : N.slice();
        const q = V.add(inner, V.mul(nn, r));
        g.p.push(q[0], q[1], q[2]); g.n.push(nn[0], nn[1], nn[2]);
        g.uv.push(si / (nu - 1), tj / (nv - 1));
      }
      for (let tj = 0; tj < nv - 1; tj++) for (let si = 0; si < nu - 1; si++) {
        const a = base + tj * nu + si, b = a + 1, c = a + nu, dd = c + 1;
        g.i.push(a, b, c, b, dd, c);
      }
    }
    return g;
  }

  // ear clipping, pts CCW in 2D -> triangles (indices) CCW
  function earcut2(pts) {
    const n = pts.length, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const tris = [];
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
        const A = pts[ia], B = pts[ib], C = pts[ic];
        if (cross(A, B, C) <= 1e-14) continue;
        let ok = true;
        for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], A, B, C)) { ok = false; break; } }
        if (!ok) continue;
        tris.push(ia, ib, ic); idx.splice(k, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }
  // extrude shape [[x,z],...] along +Y. Rounded top/bottom edges via centroid inset.
  function extrude(shape, depth, o = {}) {
    const bevel = o.bevel || 0, bs = o.bevelSegs || 3, sharpDeg = o.sharp == null ? 40 : o.sharp;
    let pts = shape.map((p) => [p[0], p[1]]);
    const area = pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + (p[0] * -q[1] - q[0] * -p[1]); }, 0);
    if (area < 0) pts.reverse();
    const n = pts.length;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    const inset = (p, d) => { const dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz) || 1, f = Math.max(0.05, (l - d) / l); return [cx + dx * f, cz + dz * f]; };
    const rings = [];
    if (bevel > 0) {
      for (let k = 0; k <= bs; k++) { const a = (Math.PI / 2) * (1 - k / bs); rings.push({ d: bevel * (1 - Math.cos(a)), y: bevel * (1 - Math.sin(a)) }); }
      for (let k = 0; k <= bs; k++) { const a = (Math.PI / 2) * (k / bs); rings.push({ d: bevel * (1 - Math.cos(a)), y: depth - bevel + bevel * Math.sin(a) }); }
    } else rings.push({ d: 0, y: 0 }, { d: 0, y: depth });
    // perimeter slots with duplicated vertices at sharp corners
    const slots = [];
    for (let k = 0; k < n; k++) {
      const a = pts[(k + n - 1) % n], b = pts[k], c = pts[(k + 1) % n];
      const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [c[0] - b[0], c[1] - b[1]];
      const ang = Math.acos(Math.max(-1, Math.min(1, (e1[0] * e2[0] + e1[1] * e2[1]) / ((Math.hypot(...e1) * Math.hypot(...e2)) || 1)))) * 180 / Math.PI;
      if (ang > sharpDeg) slots.push({ k, role: 'in' }, { k, role: 'out' }); else slots.push({ k, role: 'both' });
    }
    const S = slots.length, side = new Geo();
    let perim = 0; const plen = [0];
    for (let s = 1; s <= S; s++) { const A = pts[slots[s - 1].k], B = pts[slots[s % S].k]; perim += Math.hypot(B[0] - A[0], B[1] - A[1]); plen.push(perim); }
    rings.forEach((rg, ri) => {
      for (let s = 0; s <= S; s++) {
        const sl = slots[s % S], q = inset(pts[sl.k], rg.d);
        side.p.push(q[0], rg.y, q[1]); side.n.push(0, 1, 0); side.uv.push(plen[s] / (perim || 1), rg.y / depth);
      }
    });
    const R = S + 1;
    for (let ri = 0; ri < rings.length - 1; ri++)
      for (let s = 0; s < S; s++) {
        if (slots[s].role === 'in') continue; // the in->out gap at a corner has zero width
        const A = ri * R + s, B = ri * R + s + 1, C = (ri + 1) * R + s, D = (ri + 1) * R + s + 1;
        side.i.push(A, B, C, B, D, C);
      }
    computeNormals(side, false);
    // caps
    const caps = new Geo();
    const P2 = (q) => [q[0], -q[1]];
    const bot = pts.map((p) => inset(p, rings[0].d)), top = pts.map((p) => inset(p, rings[rings.length - 1].d));
    const tri = earcut2(top.map(P2));
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
    const U = (p) => [(p[0] - minx) / (maxx - minx || 1), (p[1] - minz) / (maxz - minz || 1)];
    for (const p of top) { caps.p.push(p[0], depth, p[1]); caps.n.push(0, 1, 0); caps.uv.push(...U(p)); }
    for (let t = 0; t < tri.length; t += 3) caps.i.push(tri[t], tri[t + 1], tri[t + 2]);
    const base = caps.count;
    for (const p of bot) { caps.p.push(p[0], 0, p[1]); caps.n.push(0, -1, 0); caps.uv.push(...U(p)); }
    for (let t = 0; t < tri.length; t += 3) caps.i.push(base + tri[t], base + tri[t + 2], base + tri[t + 1]);
    return { side, caps, all: merge([side, caps]) };
  }

  // tube along path(t)->[x,y,z], radius(t)
  function tube(path, radius, tSegs = 32, rSegs = 10, o = {}) {
    const P = [], T = [];
    for (let i = 0; i <= tSegs; i++) P.push(path(i / tSegs));
    for (let i = 0; i <= tSegs; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(tSegs, i + 1)];
      T.push(V.norm(V.sub(b, a)));
    }
    let N = Math.abs(T[0][1]) < 0.9 ? V.norm(V.cross(T[0], [0, 1, 0])) : V.norm(V.cross(T[0], [1, 0, 0]));
    const frames = [];
    for (let i = 0; i <= tSegs; i++) {
      if (i > 0) {
        const ax = V.cross(T[i - 1], T[i]), l = V.len(ax);
        if (l > 1e-8) {
          const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(T[i - 1], T[i]))));
          N = M4.xform(M4.axisAngle(V.mul(ax, 1 / l), ang), N);
        }
        N = V.norm(V.sub(N, V.mul(T[i], V.dot(N, T[i]))));
      }
      frames.push([N, V.cross(T[i], N)]);
    }
    const g = new Geo();
    for (let i = 0; i <= tSegs; i++) {
      const [Nn, B] = frames[i], r = typeof radius === 'function' ? radius(i / tSegs) : radius;
      const sy = o.squash || 1;
      for (let k = 0; k <= rSegs; k++) {
        const a = (TAU * k) / rSegs, ca = Math.cos(a), sa = Math.sin(a) * sy;
        const nn = V.norm([ca * Nn[0] + sa * B[0], ca * Nn[1] + sa * B[1], ca * Nn[2] + sa * B[2]]);
        g.p.push(P[i][0] + r * (ca * Nn[0] + sa * B[0]), P[i][1] + r * (ca * Nn[1] + sa * B[1]), P[i][2] + r * (ca * Nn[2] + sa * B[2]));
        g.n.push(nn[0], nn[1], nn[2]);
        g.uv.push(k / rSegs, i / tSegs);
      }
    }
    const R = rSegs + 1;
    for (let i = 0; i < tSegs; i++) for (let k = 0; k < rSegs; k++) {
      const a = i * R + k, b = i * R + k + 1, c = (i + 1) * R + k, d = (i + 1) * R + k + 1;
      g.i.push(a, b, c, b, d, c);
    }
    if (o.squash) computeNormals(g, true);
    return g;
  }

  function displace(g, fn) {
    for (let v = 0; v < g.count; v++) {
      const k = v * 3, x = g.p[k], y = g.p[k + 1], z = g.p[k + 2];
      const d = fn(x, y, z, g.n[k], g.n[k + 1], g.n[k + 2]);
      if (Array.isArray(d)) { g.p[k] += d[0]; g.p[k + 1] += d[1]; g.p[k + 2] += d[2]; }
      else { g.p[k] += g.n[k] * d; g.p[k + 1] += g.n[k + 1] * d; g.p[k + 2] += g.n[k + 2] * d; }
    }
    return computeNormals(g, true);
  }

  /* ---------------- canvas textures ---------------- */
  function canvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  // per-pixel helper
  function pixels(w, h, fn) {
    return canvas(w, h, (ctx) => {
      const img = ctx.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = fn(x / w, y / h), k = (y * w + x) * 4;
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c[3] == null ? 255 : c[3];
      }
      ctx.putImageData(img, 0, 0);
    });
  }
  // vertical bands along v (for lathe uv.v): stops [[v, '#hex'], ...]
  function bands(stops, h = 256) {
    return canvas(4, h, (ctx) => {
      const gr = ctx.createLinearGradient(0, 0, 0, h);
      for (const [v, c] of stops) gr.addColorStop(Math.max(0, Math.min(1, v)), c);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 4, h);
    });
  }
  function stripes(c1, c2, n = 8, w = 64, h = 256, horizontal = false) {
    return canvas(w, h, (ctx) => {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = c2;
      for (let k = 0; k < n; k++) {
        if (horizontal) ctx.fillRect(0, (k * h) / n, w, h / n / 2);
        else ctx.fillRect((k * w) / n, 0, w / n / 2, h);
      }
    });
  }

  /* ---------------- shaders ---------------- */
  const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat4 uModel; uniform mat3 uNrmM; uniform mat4 uVP; uniform mat4 uLightVP; uniform float uNOff;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vO; varying vec4 vSh;
void main(){
  vec4 w = uModel*vec4(aPos,1.0);
  vW = w.xyz; vN = normalize(uNrmM*aNrm); vUv = aUv; vO = aPos;
  vSh = uLightVP*vec4(w.xyz + vN*uNOff, 1.0);
  gl_Position = uVP*w;
}`;
  const FS_COMMON = `
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float s=0.0, a=0.5; for(int k=0;k<4;k++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
float unpackD(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
uniform sampler2D uShadow; uniform float uShadowOn; uniform float uTexel;
float shadowAt(vec4 sh){
  if (uShadowOn < 0.5) return 1.0;
  vec3 c = sh.xyz/sh.w*0.5+0.5;
  if (c.x<0.0||c.x>1.0||c.y<0.0||c.y>1.0||c.z>1.0) return 1.0;
  float s=0.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++){
    float d = unpackD(texture2D(uShadow, c.xy + vec2(float(x),float(y))*uTexel*1.25));
    s += (c.z - 0.0015 > d) ? 0.0 : 1.0;
  }
  return s/9.0;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
`;
  const FS = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vO; varying vec4 vSh;
uniform vec3 uCam; uniform vec3 uColor; uniform sampler2D uMap; uniform float uHasMap;
uniform float uRough, uMetal, uSpec, uCoat, uWrap, uOpacity, uFresOp, uBump, uBumpF, uVar, uVarF, uToast, uSheen, uGlow, uFadeR, uRecv, uAoOn;
uniform vec3 uSss; uniform vec3 uFadeC;
uniform vec3 uL; uniform vec3 uLC; uniform vec3 uSky; uniform vec3 uGnd; uniform float uExp; uniform float uEnv; uniform float uGroundY;
${FS_COMMON}
vec3 env(vec3 R, float r){
  float y = R.y;
  vec3 top = mix(uSky*1.15, vec3(1.45,1.45,1.42), smoothstep(0.45, 1.0, y));
  vec3 hor = uSky*0.42 + uGnd*0.12;
  vec3 gnd = uGnd*0.85 + vec3(0.06);
  vec3 c = y > 0.0 ? mix(hor, top, smoothstep(0.02, 0.7, y)) : mix(hor, gnd, smoothstep(0.0, -0.35, y));
  c = mix(c, uSky*0.55 + uGnd*0.3, r*0.55);
  float w = mix(0.012, 0.5, r);
  c += uLC*0.75*smoothstep(1.0-w-0.035, 1.0-w*0.2, dot(R,uL))*(1.0-r*0.55);
  c += vec3(2.2)*smoothstep(1.0-w-0.04, 1.0-w*0.25, dot(R, normalize(vec3(0.75,0.35,-0.55))))*(1.0-r*0.7);
  c += vec3(1.1)*smoothstep(1.0-w-0.07, 1.0-w*0.3, dot(R, normalize(vec3(-0.85,0.2,-0.3))))*(1.0-r*0.75);
  vec2 h2 = normalize(R.xz + vec2(1e-5));
  float band = smoothstep(0.75, 0.0, abs(R.y - 0.05));
  c += vec3(2.3)*smoothstep(0.93 - w*0.6, 0.988 - w*0.25, dot(h2, normalize(vec2(0.9,-0.42))))*band*(1.0-r*0.7);
  c += vec3(1.25)*smoothstep(0.93 - w*0.6, 0.988 - w*0.25, dot(h2, normalize(vec2(-0.95,-0.25))))*band*(1.0-r*0.7);
  return c;
}
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 Vv = normalize(uCam - vW);
  if (uBump > 0.0) {
    float h = fbm(vO*uBumpF);
    vec3 dpx = dFdx(vW), dpy = dFdy(vW);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det)*(dhx*r1 + dhy*r2);
    N = normalize(abs(det)*N - uBump*grad*0.001);
  }
  vec3 base = uColor;
  if (uHasMap > 0.5) { vec4 t = texture2D(uMap, vUv); base *= pow(t.rgb, vec3(2.2)); }
  if (uVar > 0.0) { float n = fbm(vO*uVarF + 7.1); base *= mix(1.0-uVar, 1.0+uVar*0.7, n); }
  if (uToast > 0.0) {
    float n = fbm(vO*uVarF*0.6 + 3.3);
    float t = clamp(smoothstep(0.42, 0.78, n)*0.75 + smoothstep(0.1, 0.95, normalize(vN).y)*0.55, 0.0, 1.0);
    base = mix(base, base*vec3(0.52,0.33,0.17), t*uToast);
  }
  float NdL = dot(N, uL);
  float dif = max((NdL + uWrap)/(1.0 + uWrap), 0.0);
  float sh = uRecv > 0.5 ? shadowAt(vSh) : 1.0;
  float ao = uAoOn > 0.5 ? mix(0.55, 1.0, smoothstep(0.0, 0.012, vW.y - uGroundY)) : 1.0;
  vec3 H = normalize(Vv + uL);
  float NdH = max(dot(N,H),0.0), NdV = max(dot(N,Vv),1e-3), NL = max(NdL,0.0), LdH = max(dot(uL,H),0.0);
  float a = max(uRough*uRough, 0.002), a2 = a*a;
  float dd = NdH*NdH*(a2-1.0)+1.0;
  float D = a2/(3.14159*dd*dd);
  float k = (uRough+1.0)*(uRough+1.0)/8.0;
  float G = (NL/(NL*(1.0-k)+k))*(NdV/(NdV*(1.0-k)+k));
  vec3 F0 = mix(vec3(0.04*uSpec), base, uMetal);
  vec3 F = F0 + (1.0-F0)*pow(1.0-LdH, 5.0);
  vec3 spec = D*G*F/max(4.0*NL*NdV, 1e-3)*NL;
  vec3 kd = (1.0-F)*(1.0-uMetal);
  vec3 col = (kd*base*dif + spec)*uLC*sh;
  col += uSss*base*pow(max(0.0, 1.0-abs(NdL)), 2.0)*uWrap*uLC*0.25*sh;
  float hemi = N.y*0.5+0.5;
  col += mix(uGnd, uSky, hemi)*base*kd*ao*0.95;
  vec3 R = reflect(-Vv, N);
  vec3 Fr = F0 + (max(vec3(1.0-uRough), F0)-F0)*pow(1.0-NdV, 5.0);
  col += env(R, uRough)*Fr*uEnv*mix(0.6, 1.0, sh)*ao;
  if (uCoat > 0.0) {
    float fc = 0.04 + 0.96*pow(1.0-NdV, 5.0);
    col += env(R, 0.06)*fc*uCoat*uEnv*mix(0.55,1.0,sh);
    float Dc = 0.0036/(3.14159*pow(NdH*NdH*(0.0036-1.0)+1.0, 2.0));
    col += uLC*Dc*0.04*uCoat*NL*sh;
  }
  if (uSheen > 0.0) col += uSky*base*pow(1.0-NdV, 3.0)*uSheen;
  col += base*uGlow;
  col *= uExp;
  col = aces(col);
  col = pow(col, vec3(1.0/2.2));
  float alpha = uOpacity;
  if (uFresOp > 0.0) alpha = clamp(mix(uOpacity, 1.0, pow(1.0-NdV, 2.5)*uFresOp) + dot(spec, vec3(0.3))*0.5, 0.0, 1.0);
  if (uFadeR > 0.0) { float d = length(vW.xz - uFadeC.xz); alpha *= 1.0 - smoothstep(uFadeR*0.55, uFadeR, d); }
  gl_FragColor = vec4(col*alpha, alpha);
}`;
  const VS_DEPTH = `
attribute vec3 aPos; uniform mat4 uModel; uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP*uModel*vec4(aPos,1.0); }`;
  const FS_DEPTH = `
precision highp float;
void main(){
  vec4 enc = vec4(1.0, 255.0, 65025.0, 16581375.0)*gl_FragCoord.z;
  enc = fract(enc);
  enc -= enc.yzww*vec4(1.0/255.0,1.0/255.0,1.0/255.0,0.0);
  gl_FragColor = enc;
}`;
  const VS_CATCH = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat4 uModel; uniform mat4 uVP; uniform mat4 uLightVP;
varying vec3 vW; varying vec4 vSh;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vW = w.xyz; vSh = uLightVP*vec4(w.xyz + vec3(0.0,0.0015,0.0),1.0); gl_Position = uVP*w; }`;
  const FS_CATCH = `
precision highp float;
varying vec3 vW; varying vec4 vSh;
uniform vec4 uBlob0; uniform vec4 uBlob1; uniform float uShadowAmt; uniform float uFade; uniform vec3 uFadeC;
${FS_COMMON}
float blob(vec4 b){ if (b.w <= 0.0) return 0.0; float d = length(vW.xz - b.xy)/b.z; return b.w*(1.0 - smoothstep(0.35, 1.25, d)); }
void main(){
  float s = 1.0 - shadowAt(vSh);
  float a = s*uShadowAmt;
  a = max(a, blob(uBlob0)); a = max(a, blob(uBlob1));
  a = 1.0 - (1.0-a)*(1.0 - max(blob(uBlob0),blob(uBlob1))*0.35);
  float d = length(vW.xz - uFadeC.xz);
  a *= 1.0 - smoothstep(uFade*0.5, uFade, d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 0.9));
}`;

  /* ---------------- renderer ---------------- */
  class Renderer {
    constructor(canvasEl, opts = {}) {
      this.canvas = canvasEl;
      const attrs = { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' };
      if (opts.xr) attrs.xrCompatible = true;
      const gl = canvasEl.getContext('webgl', attrs) || canvasEl.getContext('experimental-webgl', attrs);
      if (!gl) throw new Error('WebGL unavailable');
      this.gl = gl;
      this.derivs = !!gl.getExtension('OES_standard_derivatives');
      gl.getExtension('OES_element_index_uint');
      this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
      const fs = this.derivs ? FS : FS.replace('#extension GL_OES_standard_derivatives : enable', '').replace(/if \(uBump > 0\.0\) \{[\s\S]*?\n  \}\n/, '');
      this.prog = this._program(VS, fs);
      this.dprog = this._program(VS_DEPTH, FS_DEPTH);
      this.cprog = this._program(VS_CATCH, FS_CATCH);
      this.texCache = new Map();
      this.white = this._tex1([255, 255, 255, 255]);
      this.groundGeo = this.upload(disc(1, 64));
      this.shadowSize = opts.shadowSize || 1024;
      this._makeShadowFbo();
      this.dpr = 1;
    }
    _shader(type, src) {
      const gl = this.gl, s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 5).join('\n'));
      return s;
    }
    _program(vs, fs) {
      const gl = this.gl, p = gl.createProgram();
      gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 2, 'aUv');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let k = 0; k < n; k++) { const info = gl.getActiveUniform(p, k); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    _tex1(rgba) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
      return t;
    }
    _makeShadowFbo() {
      const gl = this.gl, S = this.shadowSize;
      this.shTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.shRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, S, S);
      this.shFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.shRb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // offscreen target for thumbnails
    target(w, h) {
      const gl = this.gl, t = { w, h };
      t.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      t.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      t.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.rb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return t;
    }
    upload(g) {
      const gl = this.gl, m = { count: g.i.length };
      const buf = (data, type = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(type, b); gl.bufferData(type, data, gl.STATIC_DRAW); return b; };
      m.pb = buf(new Float32Array(g.p)); m.nb = buf(new Float32Array(g.n)); m.ub = buf(new Float32Array(g.uv.length ? g.uv : new Array((g.p.length / 3) * 2).fill(0)));
      m.big = g.count > 65535;
      m.ib = buf(m.big ? new Uint32Array(g.i) : new Uint16Array(g.i), gl.ELEMENT_ARRAY_BUFFER);
      const b = g.bounds(); m.min = b.min; m.max = b.max;
      return m;
    }
    texture(src, o = {}) {
      if (!src) return null;
      if (this.texCache.has(src)) return this.texCache.get(src);
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const pot = (v) => (v & (v - 1)) === 0;
      const wrap = o.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      if (pot(src.width) && pot(src.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        if (this.anisoExt) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this.texCache.set(src, t);
      return t;
    }
    // replace a dynamic texture (e.g. photo background) - not cached
    _bindMesh(m, prog, withAttribs = true) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (withAttribs) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.ub); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      } else { gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
    }
    _draw(m) { const gl = this.gl; gl.drawElements(gl.TRIANGLES, m.count, m.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0); }

    /* scene: { items:[{model, matrix}], light:{dir,color,sky,ground,exposure,env}, ground:{mode:'catcher'|'none'|'mesh', y, radius, shadow, center}, blobs:[[x,z,r,s]] }
       cam: { view, proj, pos } ; out: { fbo, x, y, w, h, clear:[r,g,b,a] } */
    render(scene, cam, out = {}) {
      const gl = this.gl;
      const L = scene.light;
      const parts = [];
      for (const it of scene.items) {
        if (!it || !it.model) continue;
        for (const pt of it.model.parts) {
          const world = M4.mul(it.matrix, pt.matrix);
          parts.push({ mesh: pt.mesh, mat: pt.mat, world, nm: M4.normal3(world) });
        }
      }
      // shadow pass
      const sc = scene.shadowBox; // {center, radius}
      let lightVP = M4.id();
      const shadowOn = !!sc;
      if (shadowOn) {
        const eye = V.add(sc.center, V.mul(V.norm(L.dir), sc.radius * 3));
        const up = Math.abs(V.norm(L.dir)[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
        const lv = M4.lookAt(eye, sc.center, up), r = sc.radius;
        lightVP = M4.mul(M4.ortho(-r, r, -r, r, r * 0.5, r * 6), lv);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clearColor(1, 1, 1, 1); gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        gl.useProgram(this.dprog.p);
        gl.uniformMatrix4fv(this.dprog.u.uLightVP, false, lightVP);
        for (const pt of parts) {
          if (pt.mat.noShadow || (pt.mat.opacity != null && pt.mat.opacity < 0.5 && !pt.mat.castShadow)) continue;
          this._bindMesh(pt.mesh, this.dprog, false);
          gl.uniformMatrix4fv(this.dprog.u.uModel, false, pt.world);
          this._draw(pt.mesh);
        }
      }
      // main pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo || null);
      const W = out.w || this.canvas.width, Hh = out.h || this.canvas.height;
      gl.viewport(out.x || 0, out.y || 0, W, Hh);
      if (out.clear !== false) {
        const c = out.clear || [0, 0, 0, 0];
        gl.clearColor(c[0], c[1], c[2], c[3]); gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const VP = M4.mul(cam.proj, cam.view);
      const G = scene.ground || { mode: 'none' };
      const p = this.prog;
      const setMain = () => {
        gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u.uVP, false, VP);
        gl.uniformMatrix4fv(p.u.uLightVP, false, lightVP);
        gl.uniform3fv(p.u.uCam, cam.pos);
        gl.uniform3fv(p.u.uL, V.norm(L.dir));
        gl.uniform3fv(p.u.uLC, L.color);
        gl.uniform3fv(p.u.uSky, L.sky);
        gl.uniform3fv(p.u.uGnd, L.ground);
        gl.uniform1f(p.u.uExp, L.exposure || 1);
        gl.uniform1f(p.u.uEnv, L.env == null ? 1 : L.env);
        gl.uniform1f(p.u.uGroundY, G.y || 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(p.u.uShadow, 1);
        gl.uniform1f(p.u.uShadowOn, shadowOn ? 1 : 0); gl.uniform1f(p.u.uTexel, 1 / this.shadowSize);
        gl.uniform1f(p.u.uNOff, sc ? sc.radius * 0.004 : 0.001);
      };
      // backdrop items (e.g. a table top) drawn before the shadow catcher
      if (scene.under && scene.under.length) {
        setMain();
        gl.depthMask(true);
        for (const it of scene.under) for (const pt of it.model.parts) { const world = M4.mul(it.matrix, pt.matrix); this._drawPart({ mesh: pt.mesh, mat: pt.mat, world, nm: M4.normal3(world) }); }
      }
      if (G.mode === 'catcher') {
        const cp = this.cprog; gl.useProgram(cp.p);
        gl.depthMask(false);
        const gm = M4.mul(M4.T(G.center ? G.center[0] : 0, G.y || 0, G.center ? G.center[2] : 0), M4.S(G.radius || 1));
        gl.uniformMatrix4fv(cp.u.uModel, false, gm);
        gl.uniformMatrix4fv(cp.u.uVP, false, VP);
        gl.uniformMatrix4fv(cp.u.uLightVP, false, lightVP);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(cp.u.uShadow, 1);
        gl.uniform1f(cp.u.uShadowOn, shadowOn ? 1 : 0); gl.uniform1f(cp.u.uTexel, 1 / this.shadowSize);
        const bl = scene.blobs || [];
        gl.uniform4fv(cp.u.uBlob0, bl[0] || [0, 0, 1, 0]);
        gl.uniform4fv(cp.u.uBlob1, bl[1] || [0, 0, 1, 0]);
        gl.uniform1f(cp.u.uShadowAmt, G.shadow == null ? 0.55 : G.shadow);
        gl.uniform1f(cp.u.uFade, G.radius || 1);
        gl.uniform3fv(cp.u.uFadeC, G.center || [0, 0, 0]);
        this._bindMesh(this.groundGeo, cp, true);
        this._draw(this.groundGeo);
        gl.depthMask(true);
      }
      setMain();
      const opaque = [], trans = [];
      for (const pt of parts) (pt.mat.transparent ? trans : opaque).push(pt);
      const camPos = cam.pos;
      trans.sort((a, b) => {
        const ca = M4.xform(a.world, [(a.mesh.min[0] + a.mesh.max[0]) / 2, (a.mesh.min[1] + a.mesh.max[1]) / 2, (a.mesh.min[2] + a.mesh.max[2]) / 2]);
        const cb = M4.xform(b.world, [(b.mesh.min[0] + b.mesh.max[0]) / 2, (b.mesh.min[1] + b.mesh.max[1]) / 2, (b.mesh.min[2] + b.mesh.max[2]) / 2]);
        return V.len(V.sub(cb, camPos)) - V.len(V.sub(ca, camPos)) + ((b.mat.order || 0) - (a.mat.order || 0)) * 10;
      });
      gl.depthMask(true);
      for (const pt of opaque) this._drawPart(pt);
      gl.depthMask(false);
      for (const pt of trans) this._drawPart(pt);
      gl.depthMask(true);
    }
    _drawPart(pt) {
      const gl = this.gl, p = this.prog, u = p.u, m = pt.mat;
      if (!m._lin) m._lin = { color: toLin(m.color || '#ffffff'), sss: toLin(m.sss || '#000000') };
      gl.uniformMatrix4fv(u.uModel, false, pt.world);
      gl.uniformMatrix3fv(u.uNrmM, false, pt.nm);
      gl.uniform3fv(u.uColor, m._lin.color);
      gl.uniform3fv(u.uSss, m._lin.sss);
      gl.uniform1f(u.uRough, m.rough == null ? 0.5 : m.rough);
      gl.uniform1f(u.uMetal, m.metal || 0);
      gl.uniform1f(u.uSpec, m.spec == null ? 1 : m.spec);
      gl.uniform1f(u.uCoat, m.coat || 0);
      gl.uniform1f(u.uWrap, m.wrap || 0);
      gl.uniform1f(u.uOpacity, m.opacity == null ? 1 : m.opacity);
      gl.uniform1f(u.uFresOp, m.fresnelOpacity || 0);
      gl.uniform1f(u.uBump, m.bump || 0);
      gl.uniform1f(u.uBumpF, m.bumpF || 200);
      gl.uniform1f(u.uVar, m.vary || 0);
      gl.uniform1f(u.uVarF, m.varyF || 60);
      gl.uniform1f(u.uToast, m.toast || 0);
      gl.uniform1f(u.uSheen, m.sheen || 0);
      gl.uniform1f(u.uGlow, m.glow || 0);
      gl.uniform1f(u.uFadeR, m.fadeR || 0);
      gl.uniform3fv(u.uFadeC, m.fadeC || [0, 0, 0]);
      gl.uniform1f(u.uRecv, m.recv === false ? 0 : 1);
      gl.uniform1f(u.uAoOn, m.ao === false ? 0 : 1);
      gl.activeTexture(gl.TEXTURE0);
      const tex = m.map ? this.texture(m.map, m.mapOpts) : null;
      gl.bindTexture(gl.TEXTURE_2D, tex || this.white);
      gl.uniform1i(u.uMap, 0);
      gl.uniform1f(u.uHasMap, tex ? 1 : 0);
      this._bindMesh(pt.mesh, p, true);
      this._draw(pt.mesh);
    }
    // read the given target into a 2D canvas (un-premultiplied, flipped)
    readTarget(t) {
      const gl = this.gl, px = new Uint8Array(t.w * t.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return canvas(t.w, t.h, (ctx) => {
        const img = ctx.createImageData(t.w, t.h);
        for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
          const s = ((t.h - 1 - y) * t.w + x) * 4, d = (y * t.w + x) * 4, a = px[s + 3];
          if (a > 0) { img.data[d] = Math.min(255, (px[s] * 255) / a); img.data[d + 1] = Math.min(255, (px[s + 1] * 255) / a); img.data[d + 2] = Math.min(255, (px[s + 2] * 255) / a); }
          img.data[d + 3] = a;
        }
        ctx.putImageData(img, 0, 0);
      });
    }
  }

  // Upload a CPU model ({parts:[{geo, mat, matrix?}]}) to a renderer, merging parts by material
  function bake(renderer, cpu) {
    if (cpu._baked && cpu._baked.r === renderer) return cpu._baked.m;
    const byMat = new Map();
    for (const pt of cpu.parts) {
      const g = pt.matrix ? pt.geo.clone().apply(pt.matrix) : pt.geo;
      if (!byMat.has(pt.mat)) byMat.set(pt.mat, []);
      byMat.get(pt.mat).push(g);
    }
    const parts = [];
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const [mat, list] of byMat) {
      const g = merge(list);
      const mesh = renderer.upload(g);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], mesh.min[a]); mx[a] = Math.max(mx[a], mesh.max[a]); }
      parts.push({ mesh, mat, matrix: M4.id() });
    }
    const model = { parts, min: mn, max: mx };
    model.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    model.radius = Math.max(0.01, V.len(V.sub(mx, mn)) / 2);
    model.footprint = Math.max(mx[0] - mn[0], mx[2] - mn[2]) / 2;
    cpu._baked = { r: renderer, m: model };
    return model;
  }

  function orbitCam(target, dist, az, el, fov, aspect) {
    const eye = [target[0] + dist * Math.cos(el) * Math.sin(az), target[1] + dist * Math.sin(el), target[2] + dist * Math.cos(el) * Math.cos(az)];
    return { pos: eye, view: M4.lookAt(eye, target), proj: M4.persp(fov, aspect, Math.max(0.005, dist * 0.05), dist * 20) };
  }

  const LIGHTS = {
    studio: { dir: [-0.38, 1.0, 0.5], color: [3.0, 2.86, 2.62], sky: [0.66, 0.7, 0.78], ground: [0.34, 0.28, 0.23], exposure: 0.98, env: 1 },
  };

  return { TAU, rng, noise3, fbm, hex, toLin, V, M4, Geo, merge, computeNormals, lathe, arc, sphere, dome, cylinder, puck, torus, disc, plane, roundedBox, extrude, tube, displace, earcut2, canvas, pixels, bands, stripes, Renderer, bake, orbitCam, LIGHTS };
})();
