'use strict';
/* AR table view: live camera (+gyro anchoring), photo of the table, virtual marble table, or WebXR placement */
const AR = (() => {
  const { M4, V } = E3;
  const { $, esc, icon, vmark, toast } = UI;
  let root = null, o = null, ctrl = null, bg = null;
  let stream = null, photoUrl = null, lightTimer = 0, hintTimer = 0;
  let xr = null; // {session, ref, hitSource, placed, hit}
  let xrSupported = null;
  const st = { cur: { key: 'cappuccino', t0: 0 }, prev: null, x: 0, z: -0.3, y: 0, yaw: 0.5, scale: 1, slide: 0.32 };
  const cam = { h: 0.42, pitch: -0.95, fov: 1.12 };
  let light = JSON.parse(JSON.stringify(E3.LIGHTS.studio));
  let gyro = { on: false, q: null, target: null, events: 0 };
  let autoSpin = !UI.reduceMotion();
  let moveAnim = null;

  /* ---------- camera math ---------- */
  const portrait = () => window.innerHeight >= window.innerWidth;
  function quatEulerYXZ(x, y, z) {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  }
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  function qslerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((v) => -v); d = -d; }
    if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t); const l = Math.hypot(...r); return r.map((v) => v / l); }
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  }
  function qmat(q) {
    const [x, y, z, w] = q, m = M4.id();
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + w * z); m[2] = 2 * (x * z - w * y);
    m[4] = 2 * (x * y - w * z); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + w * x);
    m[8] = 2 * (x * z + w * y); m[9] = 2 * (y * z - w * x); m[10] = 1 - 2 * (x * x + y * y);
    return m;
  }
  function camRot() {
    if (gyro.on && gyro.q) return qmat(gyro.q);
    return M4.Rx(cam.pitch);
  }
  function camera(w, h) {
    const aspect = w / h, fov = portrait() ? 1.12 : 0.8;
    cam.fov = fov;
    const world = M4.mul(M4.T(0, cam.h, 0), camRot());
    return { pos: [0, cam.h, 0], view: M4.inv(world), proj: M4.persp(fov, aspect, 0.01, 20), world, aspect };
  }
  // screen point (0..1, 0..1) -> table plane hit
  function raycast(sx, sy) {
    const cv = Viewer.canvas, w = cv ? cv.width : innerWidth, h = cv ? cv.height : innerHeight;
    const c = camera(w, h), t = Math.tan(cam.fov / 2);
    const dirCam = [(sx * 2 - 1) * t * c.aspect, (1 - sy * 2) * t, -1];
    const R = c.world;
    let d = V.norm([R[0] * dirCam[0] + R[4] * dirCam[1] + R[8] * dirCam[2], R[1] * dirCam[0] + R[5] * dirCam[1] + R[9] * dirCam[2], R[2] * dirCam[0] + R[6] * dirCam[1] + R[10] * dirCam[2]]);
    if (d[1] > -0.12) d = V.norm([d[0], -0.12, d[2]]);
    const k = -cam.h / d[1];
    const p = [d[0] * k, 0, d[2] * k];
    const dist = Math.hypot(p[0], p[2]);
    if (dist > 1.4) { p[0] *= 1.4 / dist; p[2] *= 1.4 / dist; }
    return p;
  }

  /* ---------- light estimation from the camera / photo ---------- */
  const probe = document.createElement('canvas'); probe.width = probe.height = 24;
  function estimate(src) {
    try {
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4; r /= n * 255; g /= n * 255; b /= n * 255;
      const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lin = E3.toLin([r, g, b]), mx = Math.max(...lin, 1e-3), tint = lin.map((v) => 0.55 + 0.45 * (v / mx));
      const base = E3.LIGHTS.studio;
      light.exposure = Math.max(0.62, Math.min(1.2, 0.6 + Y * 0.95));
      light.sky = base.sky.map((v, i) => v * (0.6 + 0.4 * tint[i]));
      light.ground = base.ground.map((v, i) => v * 0.6 + lin[i] * 0.55);
      light.color = base.color.map((v, i) => v * (0.75 + 0.25 * tint[i]));
    } catch (e) { /* tainted or not ready */ }
  }

  /* ---------- controller for Viewer ---------- */
  function makeCtrl() {
    const pointers = new Map();
    let down = null, el = null, kick = null, last = 0, pinch = null;
    const onDown = (e) => {
      if (e.target.closest('button,input,.ar-card,.ar-top,.ar-cats,.ar-start,.ar-tilt')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      if (pointers.size === 2) { const p = [...pointers.values()]; pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), scale: st.scale, yaw: st.yaw }; down = null; }
      try { root.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    };
    const onMove = (e) => {
      const p = pointers.get(e.pointerId); if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2 && pinch) {
        const q = [...pointers.values()], d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y), a = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x);
        st.scale = Math.max(0.45, Math.min(2.8, pinch.scale * (d / pinch.d)));
        st.yaw = pinch.yaw - (a - pinch.a);
        kick && kick();
      }
    };
    const onUp = (e) => {
      const had = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!had || !down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t;
      down = null;
      if (Math.abs(dx) > Math.abs(dy) * 1.3 && (Math.abs(dx) > 70 || (Math.abs(dx) > 40 && dt < 400))) { step(dx > 0 ? 1 : -1); return; }
      if (Math.hypot(dx, dy) < 12 && dt < 500 && !xr) {
        const r = root.getBoundingClientRect();
        const p = raycast((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        moveAnim = { from: [st.x, st.z], to: [p[0], p[2]], t0: performance.now() };
        hideHint(); kick && kick();
      }
    };
    return {
      dpr: Math.min(window.devicePixelRatio || 1, 1.75),
      attach(elx, k) { el = elx; kick = k; root.addEventListener('pointerdown', onDown); root.addEventListener('pointermove', onMove); root.addEventListener('pointerup', onUp); root.addEventListener('pointercancel', onUp); },
      detach() { if (!root) return; root.removeEventListener('pointerdown', onDown); root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerup', onUp); root.removeEventListener('pointercancel', onUp); },
      animating: () => true,
      frame(t, w, h) {
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
        if (autoSpin && !pinch) st.yaw += dt * 0.35;
        if (moveAnim) { const k = Math.min(1, (performance.now() - moveAnim.t0) / 380), e = 1 - Math.pow(1 - k, 3); st.x = moveAnim.from[0] + (moveAnim.to[0] - moveAnim.from[0]) * e; st.z = moveAnim.from[1] + (moveAnim.to[1] - moveAnim.from[1]) * e; if (k >= 1) moveAnim = null; }
        if (gyro.on && gyro.target) gyro.q = gyro.q ? qslerp(gyro.q, gyro.target, 0.35) : gyro.target;
        const c = camera(w, h);
        return { scene: buildScene(0), cam: c };
      },
    };
  }
  function buildScene(y) {
    const { items, blobs } = Viewer.dishItems(st, performance.now());
    if (y) for (const it of items) it.matrix = M4.mul(M4.T(0, y, 0), it.matrix);
    const m = Viewer.model(st.cur.key);
    const sc = {
      items, blobs: blobs.map((b) => b), light,
      shadowBox: { center: [st.x, y + m.radius * 0.5 * st.scale, st.z], radius: Math.max(0.15, m.radius * 2 * st.scale) },
      ground: { mode: 'catcher', y, radius: Math.max(0.35, m.radius * 3.2 * st.scale), shadow: bg === 'virtual' ? 0.42 : 0.5, center: [st.x, y, st.z] },
    };
    if (bg === 'virtual') {
      const tr = 0.75;
      const tm = Viewer.table();
      tm.parts[0].mat.fadeR = tr; tm.parts[0].mat.fadeC = [st.x * 0.4, 0, st.z * 0.6 - 0.1];
      sc.under = [{ model: tm, matrix: M4.mul(M4.T(st.x * 0.4, y - 0.0006, st.z * 0.6 - 0.1), M4.S(tr / 1.2)) }];
    }
    return sc;
  }

  /* ---------- deck ---------- */
  const dish = () => o.dishes[o.index] || null;
  function step(dir) {
    if (!o.dishes.length) return;
    o.index = (o.index + dir + o.dishes.length) % o.dishes.length;
    const d = dish();
    st.prev = { key: st.cur.key, t0: performance.now(), dir: dir > 0 ? 1 : -1 };
    st.cur = { key: d.model, t0: performance.now() };
    if (xr) xr.dirty = true;
    hideHint();
    renderCard();
    Viewer.kick();
  }
  function setDeck(dishes, startId) {
    o.dishes = dishes;
    let i = startId ? dishes.findIndex((d) => d.id === startId) : -1;
    if (i < 0) i = Math.min(o.index || 0, Math.max(0, dishes.length - 1));
    o.index = Math.max(0, i);
    const d = dish();
    if (d && d.model !== st.cur.key) {
      st.prev = root && root.isConnected ? { key: st.cur.key, t0: performance.now(), dir: 1 } : null;
      st.cur = { key: d.model, t0: performance.now() };
    }
  }

  /* ---------- DOM ---------- */
  function shell() {
    root = document.createElement('div');
    root.className = 'ar'; root.id = 'ar';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Dishes on your table');
    root.innerHTML = `
      <video playsinline muted autoplay hidden></video>
      <img class="photo" alt="Photo of your table" hidden>
      <div class="virtual-bg"></div>
      <div class="stage"></div>
      <div class="ar-top">
        <button class="ar-btn" data-a="close" aria-label="Close table view">${icon('x')}</button>
        <button class="ar-btn" data-a="mode"></button>
        <span class="grow"></span>
        <button class="ar-btn" data-a="cart" aria-label="View order"></button>
      </div>
      <div class="ar-cats" role="toolbar" aria-label="Categories"></div>
      <button class="ar-nav l glass" data-a="prev" aria-label="Previous dish">${icon('chevL')}</button>
      <button class="ar-nav r glass" data-a="next" aria-label="Next dish">${icon('chevR')}</button>
      <div class="ar-tilt glass" hidden><label class="sr" for="ar-tilt">Table angle</label><input id="ar-tilt" type="range" min="35" max="78" value="54" aria-label="Table angle"></div>
      <div class="ar-card glass" aria-live="polite"></div>
      <div class="ar-hint glass" hidden></div>
      <div class="ar-start" hidden></div>
      <input type="file" accept="image/*" capture="environment" hidden data-photo>`;
    root.addEventListener('click', onClick);
    $('[data-photo]', root).addEventListener('change', onPhoto);
    $('#ar-tilt', root).addEventListener('input', (e) => { cam.pitch = -(+e.target.value) * Math.PI / 180; Viewer.kick(); });
    root.addEventListener('beforexrselect', (e) => { if (e.target.closest && e.target.closest('button,input,.ar-card,.ar-top,.ar-cats')) e.preventDefault(); });
    return root;
  }
  function modeLabel() {
    return { live: [icon('camera'), 'Live camera'], photo: [icon('image'), 'Your photo'], virtual: [icon('table'), 'Marble table'], xr: [icon('ar'), 'AR'] }[bg] || [icon('camera'), 'Choose view'];
  }
  function renderTop() {
    if (!root) return;
    const [ic, lb] = modeLabel();
    $('[data-a=mode]', root).innerHTML = `${ic}<span>${lb}</span>${icon('chevD', 'sm')}`;
    const n = o.cartCount(), tot = o.cartTotal();
    $('[data-a=cart]', root).innerHTML = `${icon('bag')}${n ? `<span class="badge">${n}</span><span>${Data.money(tot)}</span>` : ''}`;
    const cats = ['All', ...o.categories];
    $('.ar-cats', root).innerHTML = cats.map((c) => `<button data-cat="${esc(c)}" aria-pressed="${(o.category || 'All') === c}">${esc(c)}</button>`).join('');
    $('.ar-tilt', root).hidden = !(bg === 'photo' || bg === 'virtual');
  }
  function renderCard() {
    if (!root) return;
    const card = $('.ar-card', root), d = dish();
    if (!d) { card.innerHTML = `<p style="margin:0">Nothing in this category is available right now. Pick another category.</p>`; return; }
    const q = o.getQty(d.id), st2 = o.status(d);
    const act = !st2.ok ? `<span class="chip bad">${esc(st2.short || st2.label)}</span>`
      : q ? `<div class="stepper lg" style="margin-left:auto;background:var(--caramel);color:var(--deeper)"><button data-a="dec" aria-label="Remove one">${icon('minus')}</button><span>${q}</span><button data-a="inc" aria-label="Add one more">${icon('plus')}</button></div>`
        : `<button class="btn saffron" data-a="add">${icon('plus')}Add ${Data.rupees(d.price)}</button>`;
    card.innerHTML = `<div class="nm">${vmark(d.veg)}<span>${esc(d.name)}</span></div>
      <p>${esc(d.desc || '')}</p>
      <div class="bottom"><div><div class="price">${Data.rupees(d.price)}</div><div class="count">${o.index + 1} of ${o.dishes.length}${st2.ok && st2.portions != null && st2.portions <= 5 ? `, ${st2.portions} left` : ''}</div></div>${act}</div>`;
    renderTop();
  }
  function showHint(html, ms = 5200) {
    const h = $('.ar-hint', root); if (!h) return;
    h.innerHTML = html; h.hidden = false; h.style.opacity = '1';
    clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, ms);
  }
  function hideHint() { const h = root && $('.ar-hint', root); if (h && !h.hidden) { h.style.opacity = '0'; setTimeout(() => { h.hidden = true; }, 400); } }

  async function startSheet(msg) {
    const s = $('.ar-start', root);
    if (xrSupported === null) { xrSupported = false; try { xrSupported = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))); } catch (e) { xrSupported = false; } }
    const framed = UI.inClaude();
    const opts = [];
    if (xrSupported) opts.push(['xr', 'ar', 'Place on your table', 'Finds your table surface and pins the dish to it', true]);
    if (!framed) opts.push(['live', 'camera', 'Open live camera', 'Point your phone at the table', !xrSupported]);
    opts.push(['photo', 'image', 'Take a photo of your table', 'Dishes appear on your photo', framed && !xrSupported]);
    if (framed) opts.push(['live', 'camera', 'Try the live camera', 'Works when the menu runs on your own website', false]);
    opts.push(['virtual', 'table', 'Use a marble table', 'No camera needed', false]);
    s.innerHTML = `<h2>See dishes on your table</h2>
      <p>Swipe right for the next dish, pinch to resize, tap the table to move it.</p>
      ${msg ? `<div class="ar-msg">${esc(msg)}</div>` : ''}
      <div class="opts">${opts.map(([k, ic, t, sub, pri]) => `<button class="ar-opt${pri ? ' primary' : ''}" data-start="${k}"><span class="ico">${icon(ic)}</span><span><b>${t}</b><small>${sub}</small></span></button>`).join('')}</div>`;
    s.hidden = false;
    root.classList.add('starting');
  }
  const hideStart = () => { const s = $('.ar-start', root); if (s) s.hidden = true; root.classList.remove('starting'); };

  /* ---------- backgrounds ---------- */
  function stopStream() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } const v = root && $('video', root); if (v) { v.srcObject = null; v.hidden = true; } }
  function stopGyro() { if (gyro.on) { window.removeEventListener('deviceorientation', onOri); gyro = { on: false, q: null, target: null, events: 0 }; } }
  function onOri(e) {
    if (e.alpha == null && e.beta == null) return;
    gyro.events++;
    const d2r = Math.PI / 180, orient = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * d2r;
    let q = quatEulerYXZ((e.beta || 0) * d2r, (e.alpha || 0) * d2r, -(e.gamma || 0) * d2r);
    q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    q = qmul(q, [0, 0, -Math.sin(orient / 2), Math.cos(orient / 2)]);
    if (!gyro.on) return;
    const first = !gyro.target;
    gyro.target = q;
    if (first) { gyro.q = q; const p = raycast(0.5, 0.62); st.x = p[0]; st.z = p[2]; }
  }
  function setBg(kind) {
    bg = kind;
    const v = $('video', root), ph = $('.photo', root), vb = $('.virtual-bg', root);
    v.hidden = kind !== 'live'; ph.hidden = kind !== 'photo'; vb.hidden = kind !== 'virtual';
    if (kind !== 'live') { stopStream(); stopGyro(); }
    clearInterval(lightTimer);
    if (kind === 'live') lightTimer = setInterval(() => { if (v.readyState >= 2) estimate(v); }, 700);
    if (kind === 'virtual') light = JSON.parse(JSON.stringify(E3.LIGHTS.studio));
    if (kind !== 'live' && !gyro.on) { const p = raycast(0.5, 0.6); st.x = p[0]; st.z = p[2]; }
    renderTop(); Viewer.kick();
  }
  async function startLive() {
    // iOS needs motion permission from the tap itself, before any await
    let motionAsk = null;
    try { if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') motionAsk = DeviceOrientationEvent.requestPermission().catch(() => 'denied'); } catch (e) { motionAsk = null; }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('nocam'), { name: 'NotSupportedError' });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $('video', root);
      v.srcObject = stream; v.muted = true; v.setAttribute('playsinline', ''); v.hidden = false;
      await v.play().catch(() => {});
      setBg('live');
      hideStart();
      const perm = motionAsk ? await motionAsk : 'granted';
      if (perm === 'granted' && 'DeviceOrientationEvent' in window) {
        gyro = { on: true, q: null, target: null, events: 0 };
        window.addEventListener('deviceorientation', onOri);
        setTimeout(() => { if (gyro.on && !gyro.events) stopGyro(); }, 1500);
      }
      showHint(`<b>Point at your table</b>Swipe right for the next dish. Pinch to resize. Tap the table to move the dish.`);
      return true;
    } catch (e) {
      stopStream();
      const why = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? (UI.inClaude() ? 'The live camera is blocked inside this preview. It opens on your café’s own website. For now, take a photo of your table instead.' : 'Camera permission was blocked. Allow camera access in your browser settings, or take a photo of your table instead.')
        : 'No camera was found on this device. Take a photo of your table or use the marble table.';
      startSheet(why);
      return false;
    }
  }
  function onPhoto(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(f);
    const ph = $('.photo', root);
    ph.onload = () => { estimate(ph); Viewer.kick(); };
    ph.src = photoUrl;
    setBg('photo'); hideStart();
    showHint(`<b>Your table, your dishes</b>Swipe right for the next dish. Tap the table to move it. Use the slider to match the table angle.`);
  }

  /* ---------- WebXR (Android Chrome with ARCore) ---------- */
  let reticle = null;
  function reticleModel() {
    if (reticle) return reticle;
    const g = E3.torus(0.05, 0.004, 48, 8).apply(M4.S(1, 0.2, 1));
    reticle = E3.bake(Viewer.R, { parts: [{ geo: g, mat: { color: '#FFFFFF', rough: 1, glow: 2.2, recv: false, ao: false, noShadow: true } }] });
    return reticle;
  }
  async function startXR() {
    try {
      const R = Viewer.R, gl = R.gl;
      const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root } });
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { alpha: true, antialias: true }) });
      const ref = await session.requestReferenceSpace('local');
      const viewer = await session.requestReferenceSpace('viewer');
      const hitSource = await session.requestHitTestSource({ space: viewer });
      xr = { session, ref, hitSource, placed: false, hit: null };
      Viewer.setCtrlXR(true);
      setBg('xr'); hideStart();
      $('.virtual-bg', root).hidden = true;
      st.scale = 1;
      showHint(`<b>Move your phone slowly</b>When the ring sits on your table, tap to place the dish. Then swipe right for the next one.`, 7000);
      session.addEventListener('select', () => { if (xr && xr.hit) { st.x = xr.hit[0]; st.y = xr.hit[1]; st.z = xr.hit[2]; xr.placed = true; hideHint(); } });
      session.addEventListener('end', () => { xr = null; Viewer.setCtrlXR(false); if (root) { setBg('virtual'); startSheet(); } });
      session.requestAnimationFrame(xrFrame);
      return true;
    } catch (e) {
      console.warn(e); xr = null; Viewer.setCtrlXR(false);
      startSheet('AR could not start on this device. Try the camera or a photo instead.');
      return false;
    }
  }
  function xrFrame(t, frame) {
    if (!xr) return;
    const { session, ref, hitSource } = xr;
    session.requestAnimationFrame(xrFrame);
    const pose = frame.getViewerPose(ref);
    if (!pose) return;
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) { const p = hits[0].getPose(ref); if (p) { const m = p.transform.position; xr.hit = [m.x, m.y, m.z]; } }
    if (autoSpin) st.yaw += 0.006;
    const layer = session.renderState.baseLayer;
    const R = Viewer.R;
    let first = true;
    for (const view of pose.views) {
      const vp = layer.getViewport(view), pp = view.transform.position;
      const scene = xr.placed ? buildScene(st.y) : { items: [], light, ground: { mode: 'none' } };
      if (!xr.placed && xr.hit) scene.items.push({ model: reticleModel(), matrix: M4.T(xr.hit[0], xr.hit[1] + 0.002, xr.hit[2]) });
      R.render(scene, { view: view.transform.inverse.matrix, proj: view.projectionMatrix, pos: [pp.x, pp.y, pp.z] }, { fbo: layer.framebuffer, x: vp.x, y: vp.y, w: vp.width, h: vp.height, clear: first ? [0, 0, 0, 0] : false });
      first = false;
    }
  }

  /* ---------- events ---------- */
  async function onClick(e) {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    const a = b.dataset.a, s = b.dataset.start, cat = b.dataset.cat;
    if (s) {
      if (s === 'live') return startLive();
      if (s === 'photo') return $('[data-photo]', root).click();
      if (s === 'virtual') { setBg('virtual'); hideStart(); showHint(`<b>Swipe right for the next dish</b>Pinch to resize. Tap the table to move it.`); return; }
      if (s === 'xr') return startXR();
    }
    if (cat != null) { o.onCategory(cat); return; }
    if (a === 'close') return o.onClose();
    if (a === 'cart') return o.onCart();
    if (a === 'mode') { if (xr) { xr.session.end(); return; } return startSheet(); }
    if (a === 'next') return step(1);
    if (a === 'prev') return step(-1);
    const d = dish(); if (!d) return;
    if (a === 'add' || a === 'inc') { o.onAdd(d, 1); renderCard(); }
    if (a === 'dec') { o.onAdd(d, -1); renderCard(); }
  }

  /* ---------- public ---------- */
  function open(opts) {
    o = Object.assign({ index: 0 }, opts);
    if (!Viewer.ok()) { toast('3D needs WebGL, which this browser has turned off.', 'bad', 4000); o.onClose(); return; }
    if (!root) shell();
    document.body.appendChild(root);
    document.documentElement.style.overflow = 'hidden';
    setDeck(o.dishes, o.startId);
    st.cur.t0 = performance.now();
    ctrl = makeCtrl();
    Viewer.mount($('.stage', root), ctrl);
    if (!bg || bg === 'xr') { setBg('virtual'); startSheet(); } else if (bg === 'live' && !stream) { setBg('virtual'); startSheet(); } else setBg(bg);
    renderCard();
  }
  function update(opts) { if (!root || !root.isConnected) return; Object.assign(o, opts); if (opts.dishes) setDeck(opts.dishes, opts.startId); renderCard(); }
  function close() {
    if (xr) { try { xr.session.end(); } catch (e) { /* ignore */ } xr = null; }
    stopStream(); stopGyro(); clearInterval(lightTimer);
    if (bg === 'live') bg = null;
    if (root) { Viewer.unmount($('.stage', root)); root.remove(); }
    document.documentElement.style.overflow = '';
  }
  const isOpen = () => !!(root && root.isConnected);
  return { open, update, close, isOpen, refresh: renderCard };
})();
