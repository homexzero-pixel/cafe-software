'use strict';
/* UI helpers: DOM, icons, toasts, dialogs, downloads, audio */
const UI = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const P = {
    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/>',
    bag: '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2.2 1.2-3 3.6-3 7v3h3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevL: '<path d="m15 5-7 7 7 7"/>', chevR: '<path d="m9 5 7 7-7 7"/>', chevD: '<path d="m6 9 6 6 6-6"/>', back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    flame: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6.3 0-3.4-2.2-5.4-3.5-7.2-.4 1.6-1.2 2.7-2.2 3.2.2-3-1.3-5.9-3.6-7.7.3 3.2-2.7 5.4-3.6 7.8-.6 1.4-.9 2.7-.9 3.9C4.7 18.4 8.1 21 12 21z"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19 13 11"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    home: '<path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    register: '<rect x="3" y="11" width="18" height="9" rx="2"/><path d="M6 11V5h8v6M14 7h4v4"/><path d="M7 15.5h2M11 15.5h2M15 15.5h2"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    upi: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M10 9.5h4l-1.5-1.5M14 13.5h-4l1.5 1.5"/>',
    cash: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
    store: '<path d="M4 10h16l-1.5-5h-13z"/><path d="M5 10v10h14V10M10 20v-5h4v5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
    table: '<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M12 11v9M8 20h8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17h.01"/>',
    ext: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    sound: '<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="m17 10 4 4m0-4-4 4"/>',
    swipe: '<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
    ar: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="m12 7 4 2.2v4.6L12 16l-4-2.2V9.2z"/>',
    logout: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    takeaway: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    dine: '<path d="M4 9h16M6 9v11M18 9v11M8 9V5h8v4"/>',
    spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
  const vmark = (veg) => `<span class="vmark${veg ? '' : ' nv'}" role="img" aria-label="${veg ? 'Vegetarian' : 'Non-vegetarian'}"></span>`;

  /* toasts */
  function toast(msg, kind = 'ok', ms = 2600) {
    let host = $('#toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = icon(kind === 'bad' || kind === 'warn' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
    host.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
  }

  /* dialogs */
  const stack = [];
  function modal(o) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="dialog ${o.wide ? 'wide' : ''} ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title || '')}">
      <div class="dialog-h"><h2>${esc(o.title || '')}</h2><button class="close-x" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="dialog-b"></div>${o.foot === false ? '' : '<div class="dialog-f"></div>'}</div>`;
    const dlg = $('.dialog', scrim), body = $('.dialog-b', scrim), foot = $('.dialog-f', scrim);
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    const prevFocus = document.activeElement;
    let closed = false;
    const close = (v) => {
      if (closed) return; closed = true;
      scrim.remove();
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      if (o.onClose) o.onClose(v);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    };
    const api = { el: dlg, body, foot, close, scrim };
    if (foot && Array.isArray(o.actions)) {
      for (const a of o.actions) {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.cls == null ? 'ghost' : a.cls);
        b.innerHTML = (a.icon ? icon(a.icon) : '') + esc(a.label);
        b.onclick = async () => { if (a.onClick) { const r = await a.onClick(api); if (r === false) return; } if (a.close !== false) close(a.value); };
        foot.appendChild(b);
      }
    } else if (foot && typeof o.foot === 'string') foot.innerHTML = o.foot;
    else if (foot && !o.foot) foot.remove();
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) scrim._down = true; });
    scrim.addEventListener('click', (e) => { if (e.target === scrim && scrim._down && o.dismiss !== false) close(); scrim._down = false; });
    $('[data-x]', scrim).onclick = () => close();
    document.body.appendChild(scrim);
    stack.push(api);
    setTimeout(() => { const f = $('[autofocus]', dlg) || $('.close-x', dlg); if (f) f.focus({ preventScroll: true }); }, 30);
    if (o.onOpen) o.onOpen(api);
    return api;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });
  const closeAll = () => { while (stack.length) stack[stack.length - 1].close(); };
  function confirmBox(text, o = {}) {
    return new Promise((res) => {
      modal({
        title: o.title || 'Are you sure?', body: `<p style="margin:0 0 4px;color:var(--ink-2)">${esc(text)}</p>`,
        actions: [{ label: o.cancel || 'Keep it', value: false, cls: 'ghost' }, { label: o.ok || 'Confirm', value: true, cls: o.danger ? 'danger' : '' }],
        onClose: (v) => res(!!v),
      });
    });
  }

  /* runtime capabilities (Claude artifact runtime, if present) */
  const inClaude = () => typeof window.claude === 'object' && !!window.claude && typeof window.claude.use === 'function';
  const capCache = {};
  const cap = (name) => { if (!inClaude()) return Promise.resolve(null); if (!capCache[name]) capCache[name] = window.claude.use(name).catch(() => null); return capCache[name]; };

  async function download(filename, data, mime = 'text/plain') {
    try {
      const dl = await cap('downloads');
      if (dl) { await dl.save({ filename, data }); toast('Saved ' + filename); return true; }
    } catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && e.code === 'rate_limited') { toast('A save is already waiting for your answer', 'warn'); return false; }
    }
    if (!inClaude()) {
      try {
        const blob = new Blob([data], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return true;
      } catch (e) { /* fall through */ }
    }
    modal({ title: 'Copy the file contents', wide: true, body: `<p class="muted" style="margin-top:0">Saving files isn't available in this view. Copy the text below and paste it into a file named <b>${esc(filename)}</b>.</p><textarea class="in" rows="12" readonly style="font-family:var(--f-mono);font-size:12px">${esc(typeof data === 'string' ? data : '')}</textarea>`, actions: [{ label: 'Copy', icon: 'copy', cls: '', onClick: () => { copy(typeof data === 'string' ? data : ''); return false; } }] });
    return false;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove(); toast(ok ? 'Copied' : 'Copy failed. Select the text and copy it manually.', ok ? 'ok' : 'warn'); return ok;
    }
  }
  const canPrint = () => !inClaude();

  /* audio */
  let actx = null;
  function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return true; } catch (e) { return false; } }
  function chime() {
    if (!actx) return;
    try {
      const t = actx.currentTime;
      [880, 1318.5].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
        o.connect(g); g.connect(actx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55);
      });
    } catch (e) { /* ignore */ }
  }

  const ago = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + ' min'; const h = Math.floor(m / 60); return h + ' h ' + (m % 60) + ' min'; };
  const mmss = (t) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); const m = Math.floor(s / 60); return m >= 100 ? Math.floor(m / 60) + 'h' : `${m}:${String(s % 60).padStart(2, '0')}`; };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return { $, $$, esc, icon, vmark, toast, modal, confirmBox, closeAll, inClaude, cap, download, copy, canPrint, unlockAudio, chime, ago, mmss, reduceMotion };
})();
