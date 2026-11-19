'use strict';
/* Viewer: one shared WebGL canvas moved between stages, studio orbit controls, thumbnails */
const Viewer = (() => {
  const { M4, V } = E3;
  let canvas = null, R = null, failed = false, ctrl = null, raf = 0, host = null, ro = null;
  const dprCap = () => Math.min(window.devicePixelRatio || 1, 2);

  function ensure() {
    if (R || failed) return R;
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    try { R = new E3.Renderer(canvas, { xr: true }); } catch (e) { failed = true; console.warn('3D unavailable:', e); }
    if (R) canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); failed = true; });
    return R;
  }
  const ok = () => !!ensure();
  const model = (key) => E3.bake(R, Dishes.get(key));
  let tableModel = null;
  const table = () => (tableModel = tableModel || E3.bake(R, Dishes.table()));

  function resize() {
    if (!canvas || !host) return;
    const r = host.getBoundingClientRect(), d = ctrl && ctrl.dpr ? ctrl.dpr : dprCap();
    const w = Math.max(2, Math.round(r.width * d)), h = Math.max(2, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function loop(t) {
    raf = 0;
    if (!ctrl || !host || !canvas.isConnected || document.hidden || ctrl.xr) return;
    resize();
    try {
      const f = ctrl.frame(t, canvas.width, canvas.height);
      if (f) R.render(f.scene, f.cam, { clear: f.clear || [0, 0, 0, 0] });
    } catch (e) { console.error(e); return; }
    if (ctrl.animating ? ctrl.animating() : true) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf && R) raf = requestAnimationFrame(loop); };
  document.addEventListener('visibilitychange', kick);

  // attach the canvas to a stage element with a controller
  function mount(el, controller) {
    if (!ok() || !el) return null;
    if (ctrl && ctrl.detach) ctrl.detach();
    host = el; ctrl = controller;
    el.appendChild(canvas);
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
    if (ro) ro.disconnect();
    if ('ResizeObserver' in window) { ro = new ResizeObserver(() => { resize(); kick(); }); ro.observe(el); }
    if (controller.attach) controller.attach(el, kick);
    resize(); kick();
    return controller;
  }
  function unmount(el) { if (host === el) { if (ctrl && ctrl.detach) ctrl.detach(); ctrl = null; host = null; if (canvas && canvas.parentNode) canvas.remove(); } }

  const easeOutBack = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeIn = (t) => t * t * t;

  /* shared scene assembly for one or two dishes (transition) on a table plane */
  function dishItems(st, now) {
    const items = [], blobs = [];
    const dur = 420;
    const push = (key, k, x, z, yaw, sc) => {
      const m = model(key);
      const mat = M4.chain(M4.T(x, 0, z), M4.Ry(yaw), M4.S(sc), M4.T(-m.center[0], 0, -m.center[2]));
      items.push({ model: m, matrix: mat });
      if (sc > 0.02) blobs.push([x, z, m.footprint * sc * 1.08, 0.42 * Math.min(1, sc)]);
    };
    if (st.prev && now - st.prev.t0 < dur) {
      const t = (now - st.prev.t0) / dur, s = Math.max(0, 1 - easeIn(t));
      push(st.prev.key, 0, st.x + st.prev.dir * t * st.slide, st.z, st.yaw, st.scale * s);
    } else st.prev = null;
    let s = 1;
    if (st.cur.t0 && now - st.cur.t0 < dur + 120) { const t = Math.min(1, (now - st.cur.t0 - 60) / dur); s = t <= 0 ? 0.001 : easeOutBack(t); }
    push(st.cur.key, 1, st.x, st.z, st.yaw, st.scale * s);
    return { items, blobs, busy: !!st.prev || (st.cur.t0 && now - st.cur.t0 < dur + 120) };
  }

  /* studio controller: orbit, drag to turn, pinch/wheel zoom */
  function studio(o = {}) {
    const st = { cur: { key: o.key, t0: 0 }, prev: null, x: 0, z: 0, yaw: 0, scale: 1, slide: 0.3 };
    const c = { az: o.az == null ? 0.55 : o.az, el: o.el == null ? 0.58 : o.el, zoom: 1, auto: o.auto !== false && !UI.reduceMotion(), last: 0, idleAt: 0, pointers: new Map(), dpr: o.dpr };
    let el = null, kickFn = null;
    const onDown = (e) => { c.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture && el.setPointerCapture(e.pointerId); c.idleAt = performance.now(); };
    const onMove = (e) => {
      const p = c.pointers.get(e.pointerId); if (!p) return;
      if (c.pointers.size === 1) { c.az -= (e.clientX - p.x) * 0.012; c.el = Math.max(0.12, Math.min(1.3, c.el + (e.clientY - p.y) * 0.008)); }
      else if (c.pointers.size === 2) {
        const pts = [...c.pointers.values()], d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        p.x = e.clientX; p.y = e.clientY;
        const q = [...c.pointers.values()], d1 = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
        if (d0 > 0) c.zoom = Math.max(0.6, Math.min(2.6, c.zoom * (d1 / d0)));
      }
      p.x = e.clientX; p.y = e.clientY; c.idleAt = performance.now(); kickFn && kickFn();
    };
    const onUp = (e) => { c.pointers.delete(e.pointerId); c.idleAt = performance.now(); };
    const onWheel = (e) => { e.preventDefault(); c.zoom = Math.max(0.6, Math.min(2.6, c.zoom * Math.exp(-e.deltaY * 0.0015))); kickFn && kickFn(); };
    c.attach = (elx, k) => {
      el = elx; kickFn = k;
      if (o.interactive !== false) {
        el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
        el.addEventListener('wheel', onWheel, { passive: false });
      }
    };
    c.detach = () => {
      if (!el) return;
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); el.removeEventListener('wheel', onWheel);
      el = null;
    };
    c.show = (key, dir = 1) => { if (key === st.cur.key) return; st.prev = { key: st.cur.key, t0: performance.now(), dir }; st.cur = { key, t0: performance.now() }; kickFn && kickFn(); };
    c.key = () => st.cur.key;
    c.animating = () => c.auto || c.pointers.size > 0 || !!st.prev || performance.now() - c.idleAt < 600 || (st.cur.t0 && performance.now() - st.cur.t0 < 700);
    c.frame = (t, w, h) => {
      const dt = c.last ? Math.min(0.05, (t - c.last) / 1000) : 0; c.last = t;
      if (c.auto && c.pointers.size === 0 && performance.now() - c.idleAt > 1800) c.az += dt * 0.32;
      const m = model(st.cur.key);
      const { items, blobs } = dishItems(st, performance.now());
      const fov = 0.6, aspect = w / h;
      const fitR = m.radius * (o.fit || 1.0);
      let dist = fitR / Math.sin(fov / 2);
      if (aspect < 1) dist /= Math.max(0.55, aspect);
      dist /= c.zoom;
      const tgt = [0, Math.max(0.02, (m.max[1] - m.min[1]) * 0.42), 0];
      const cam = E3.orbitCam(tgt, dist, c.az, c.el, fov, aspect);
      const scene = {
        items, blobs, light: o.light || E3.LIGHTS.studio,
        shadowBox: { center: [0, m.radius * 0.5, 0], radius: Math.max(m.radius * 1.8, 0.12) },
        ground: { mode: 'catcher', y: 0, radius: Math.max(0.25, m.radius * 3), shadow: 0.34, center: [0, 0, 0] },
      };
      if (o.table) {
        const tr = Math.max(0.09, m.footprint * 1.35);
        scene.under = [{ model: table(), matrix: M4.mul(M4.T(0, -0.0006, 0), M4.S(tr / 1.2)) }];
        table().parts[0].mat.fadeR = tr * 0.98; table().parts[0].mat.fadeC = [0, 0, 0];
        scene.ground.radius = tr; scene.ground.shadow = 0.4;
      }
      return { scene, cam };
    };
    return c;
  }

  /* thumbnails: rendered once per dish with the shared context, cached as blob URLs */
  const thumbs = new Map(), waiting = new Map();
  let queue = [], busy = false, target = null;
  const TS = 288;
  function thumb(key) { return thumbs.get(key) || null; }
  function requestThumb(key, cb) {
    if (thumbs.has(key)) { cb && cb(thumbs.get(key)); return; }
    if (cb) { if (!waiting.has(key)) waiting.set(key, []); waiting.get(key).push(cb); }
    if (!queue.includes(key)) queue.push(key);
    pump();
  }
  function pump() {
    if (busy || !queue.length || !ok()) return;
    busy = true;
    const go = () => {
      const key = queue.shift();
      try {
        target = target || R.target(TS, TS);
        const m = model(key);
        const fov = 0.55, dist = (m.radius / Math.sin(fov / 2)) * 1.0;
        const tgt = [0, (m.max[1] - m.min[1]) * 0.38, 0];
        const cam = E3.orbitCam(tgt, dist, 0.5, 0.64, fov, 1);
        const scene = {
          items: [{ model: m, matrix: M4.T(-m.center[0], 0, -m.center[2]) }], light: E3.LIGHTS.studio,
          blobs: [[0, 0, m.footprint * 1.05, 0.38]], shadowBox: { center: [0, m.radius * 0.5, 0], radius: m.radius * 1.9 },
          ground: { mode: 'catcher', y: 0, radius: m.radius * 2.6, shadow: 0.3, center: [0, 0, 0] },
        };
        R.render(scene, cam, { fbo: target.fbo, w: TS, h: TS, clear: [0, 0, 0, 0] });
        const cv = R.readTarget(target);
        const done = (url) => {
          thumbs.set(key, url);
          for (const img of document.querySelectorAll(`img[data-thumb="${key}"]`)) { img.src = url; img.hidden = false; const ph = img.parentNode && img.parentNode.querySelector('.ph'); if (ph) ph.remove(); }
          (waiting.get(key) || []).forEach((f) => f(url)); waiting.delete(key);
          busy = false; setTimeout(pump, 0);
        };
        if (cv.toBlob) cv.toBlob((b) => done(b ? URL.createObjectURL(b) : cv.toDataURL()), 'image/png'); else done(cv.toDataURL());
        kick();
      } catch (e) { console.warn('thumb failed', key, e); busy = false; setTimeout(pump, 0); }
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 16)))(go, { timeout: 200 });
  }
  const img = (key, alt = '') => {
    const u = thumbs.get(key);
    if (!u) requestThumb(key);
    return u ? `<img src="${u}" alt="${UI.esc(alt)}" data-thumb="${key}" loading="lazy">` : `<span class="ph"></span><img alt="${UI.esc(alt)}" data-thumb="${key}" hidden>`;
  };

  return { ok, ensure, mount, unmount, studio, kick, model, table, thumb, requestThumb, img, get R() { return R; }, get canvas() { return canvas; }, get failed() { return failed; }, dishItems, setCtrlXR: (v) => { if (ctrl) ctrl.xr = v; if (!v) kick(); } };
})();
