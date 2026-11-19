'use strict';
/* Staff software: overview, KOT board, billing (POS), bills, menu, stock, reports, tables & QR, setup */
const Staff = (() => {
  const { $, $$, esc, icon, vmark, toast, modal, confirmBox } = UI;
  const D = Data;
  const S = () => D.state, X = () => D.derived();
  const C = { upi: '#8B5A3C', card: '#D59A55', cash: '#4E8A5B', online: '#C0623A', bar: '#8B5A3C' };
  let root = null, page = 'overview', sideOpen = false, soundOn = false, ticker = 0, pinBuf = '';
  const seen = new Set(); let primed = false;
  const pos = { lines: [], type: 'dine-in', table: '', disc: '', discMode: 'pct', cat: 'All', q: '', ref: null, phone: '', redeem: false, channel: '', ext: '' };
  const bf = { range: 'today', status: 'all', q: '' }, mf = { q: '', cat: 'All' }, sf = { tab: 'items', q: '' }, rf = { range: '7d' }, kf = { type: 'all' };
  // who is signed in on this device: a team member id (PIN), or the Supabase account
  let meId = null, pinFails = 0, pinWaitUntil = 0;
  try { meId = sessionStorage.getItem('km.staff'); if (meId === '1') meId = null; } catch (e) { meId = null; }

  const PAGES = [
    ['overview', 'home', 'Overview'], ['orders', 'bell', 'Orders'], ['billing', 'register', 'Billing'], ['bills', 'receipt', 'Bills'],
    ['menu', 'utensils', 'Menu'], ['stock', 'box', 'Stock'], ['reports', 'chart', 'Reports'], ['board', 'tv', 'Pickup screen'], ['app', 'bag', 'Customer app'], ['team', 'user', 'Team'], ['printers', 'print', 'Printers'], ['tables', 'qr', 'Tables & QR'], ['setup', 'sliders', 'Setup'],
  ];
  const SPLIT = window.KM_APP === 'cafe';
  // in the standalone dashboard (cafe.html) routes are #overview, #orders...; in the combined demo they are #staff, #staff-orders...
  const href = (p) => (SPLIT ? '#' + p : '#staff' + (p === 'overview' ? '' : '-' + p));
  // links into the customer portal, which is a separate page (index.html) in the split build
  const custHref = (h) => (SPLIT ? 'index.html' + h : h);
  const custAttrs = SPLIT ? ' target="_blank" rel="noopener"' : '';
  const live = () => S().orders.filter((o) => o.status !== 'cancelled');
  const sales = (o) => o.status !== 'cancelled' && (!o.pay || o.pay.status !== 'refunded');
  const unpaidOrders = () => S().orders.filter((o) => o.status !== 'cancelled' && o.pay && (o.pay.status === 'unpaid' || o.pay.status === 'pending'));
  const stockIssues = () => Object.values(X().stockMap).filter((s) => s.state !== 'ok');
  const status = (d) => D.dishStatus(d, X().stockMap, S().settings, new Date());
  const fmtQty = (q, u) => { const a = Math.abs(q); if (u === 'g' && a >= 1000) return (q / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kg'; if (u === 'ml' && a >= 1000) return (q / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' L'; return D.NUM.format(Math.round(q * 100) / 100) + ' ' + u; };

  /* ---------------- lock ---------------- */
  const supa = () => S().backend === 'supabase';
  function me() {
    if (supa()) return S().staffUser ? { id: 'supa', name: S().staffName || S().staffUser, role: D.ROLES[S().staffRole] ? S().staffRole : 'staff' } : null;
    if (!meId) return null;
    return D.team(S().settings).find((m) => m.id === meId && m.active !== false) || null;
  }
  const who = () => (me() || {}).name || 'staff';
  const canDo = (perm) => { const m = me(); return !!m && D.can(m.role, perm); };
  const allowed = (p) => { const m = me(); return !!m && D.ROLES[m.role].pages.includes(p); };
  // an owner types their PIN to allow one restricted action (refund, cancelling a paid bill, a big discount)
  function ownerApprove(what) {
    const m0 = me(); if (m0 && m0.role === 'owner') return Promise.resolve(m0);
    return new Promise((res) => {
      let done = false;
      const m = modal({ title: 'Owner approval', body: `<p class="muted" style="margin-top:0">${esc(what)} needs an owner. Ask an owner to enter their PIN.</p>
        <label class="field"><span>Owner PIN</span><input class="in" type="password" inputmode="numeric" maxlength="4" autocomplete="off" data-opin autofocus style="font-size:22px;letter-spacing:.4em;max-width:160px"></label>`,
        actions: [{ label: 'Cancel' }, { label: 'Approve', cls: 'saffron', onClick: (mm) => {
          const pin = $('[data-opin]', mm.el).value.trim(), o = /^\d{4}$/.test(pin) ? D.findByPin(S().settings, pin) : null;
          if (!o || o.role !== 'owner') { toast('That is not an owner PIN', 'bad'); $('[data-opin]', mm.el).value = ''; return false; }
          done = true; res(o);
        } }], onClose: () => { if (!done) res(null); } });
      const i = $('[data-opin]', m.el); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.foot.lastChild.click(); } });
    });
  }
  // runs fn(approver) if the signed-in person may do perm, or after an owner approves
  async function guarded(perm, what, fn) {
    if (canDo(perm)) return fn(null);
    const o = await ownerApprove(what); if (o) return fn(o);
    return undefined;
  }
  function lockScreen() {
    if (supa()) {
      if (S().staffUser) return render();
      root.innerHTML = `<div class="lock"><div class="lock-in">
      <span class="plate lg">${esc(S().settings.name)}</span>
      <h1 style="font-size:22px;margin:10px 0 0;font-weight:600">Staff sign-in</h1>
      <p style="margin:0;color:#E6D6C6">Sign in with the staff account the owner created in Supabase.</p>
      <form id="supa-login" style="display:grid;gap:10px;width:100%;text-align:left">
        <input class="in" type="email" name="email" autocomplete="username" placeholder="Email" required>
        <input class="in" type="password" name="password" autocomplete="current-password" placeholder="Password" required>
        <button class="btn saffron lg block" type="submit">Sign in</button></form>
      ${SPLIT ? '' : '<a href="#welcome" style="color:#E6D6C6;font-size:14px">Back to start</a>'}</div></div>`;
      $('#supa-login', root).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        try { await D.api.adapter.signIn(f.email.value.trim(), f.password.value); UI.unlockAudio(); render(); } catch (err) { toast('Email or password is wrong', 'bad'); }
      };
      return;
    }
    const t = D.team(S().settings), def = t.length === 1 && t[0].legacy && String(S().settings.pin || '1234') === '1234';
    const wait = Math.ceil((pinWaitUntil - Date.now()) / 1000);
    root.innerHTML = `<div class="lock"><div class="lock-in">
      <span class="plate lg">${esc(S().settings.name)}</span>
      <h1 style="font-size:22px;margin:10px 0 0;font-weight:600">Staff sign-in</h1>
      <p style="margin:0;color:#E6D6C6">${wait > 0 ? `Too many wrong PINs. Try again in ${wait} seconds.` : `Enter your 4-digit PIN${def ? '. The owner’s starting PIN is 1234; add your team and change it on the Team page.' : '.'}`}</p>
      <div class="pin-dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pinpad" role="group" aria-label="PIN keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-pin="${n}">${n}</button>`).join('')}<button data-pin="clr" aria-label="Clear">${icon('x')}</button><button data-pin="0">0</button><button data-pin="del" aria-label="Delete">${icon('back')}</button></div>
      ${SPLIT ? '' : '<a href="#welcome" style="color:#E6D6C6;font-size:14px">Back to start</a>'}</div></div>`;
  }
  function pinPress(k) {
    if (k === 'clr') pinBuf = ''; else if (k === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
    if (pinBuf.length === 4) {
      if (Date.now() < pinWaitUntil) { pinBuf = ''; return lockScreen(); }
      const m = D.findByPin(S().settings, pinBuf);
      if (m) { meId = m.id; pinBuf = ''; pinFails = 0; try { sessionStorage.setItem('km.staff', m.id); } catch (e) { /* ignore */ } UI.unlockAudio(); toast(`Hello ${m.name}`, 'ok', 1500); render(); return; }
      if (++pinFails >= 5) { pinFails = 0; pinWaitUntil = Date.now() + 30000; setTimeout(() => { if (!me()) lockScreen(); }, 30500); }
      lockScreen(); const p = $('.pin-dots', root); p.classList.add('shake'); setTimeout(() => { pinBuf = ''; lockScreen(); }, 420); return;
    }
    lockScreen();
  }

  /* ---------------- shell ---------------- */
  function side() {
    const nNew = S().orders.filter((o) => o.status === 'new').length, nLow = stockIssues().length;
    const mode = S().mode;
    const sync = mode === 'cloud' ? (S().error ? ['err', 'Sync problem, retrying'] : S().synced ? ['', 'Synced across devices'] : ['local', 'Connecting…']) : ['local', 'Saved on this device'];
    return `<nav class="side${sideOpen ? ' open' : ''}" aria-label="Staff">
      <span class="plate">${esc(S().settings.name)}</span>
      ${PAGES.filter(([k]) => allowed(k)).map(([k, ic, l]) => `<a href="${href(k)}" ${page === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span>${k === 'orders' && nNew ? `<span class="badge">${nNew}</span>` : ''}${k === 'stock' && nLow ? `<span class="badge" style="background:#FFD9D2;color:#7A1E10">${nLow}</span>` : ''}</a>`).join('')}
      <div class="foot"><div class="sync ${sync[0]}"><span class="dot"></span>${sync[1]}</div>
      <a class="btn quiet sm" href="${custHref('#menu')}"${custAttrs}>${icon('utensils', 'sm')}Customer view</a>
      <div class="whoami">${icon('user', 'sm')}<span><b>${esc(who())}</b><br>${esc(D.ROLES[(me() || {}).role] ? D.ROLES[me().role].label : '')}</span></div>
      <button class="btn quiet sm" data-a="lock">${icon('lock', 'sm')}${supa() ? 'Sign out' : 'Lock or switch user'}</button></div></nav>`;
  }
  function render() {
    if (!root) return;
    clearInterval(ticker);
    if (!me()) return lockScreen();
    if (!allowed(page)) { page = D.ROLES[me().role].pages[0]; try { history.replaceState(null, '', href(page)); } catch (e) { /* ignore */ } }
    const y = window.scrollY;
    if (page === 'board') { root.innerHTML = board(); return; }
    const body = { printers: printersPage, team: teamPage, app: appControls, overview: overview, orders: orders, billing: billing, bills: bills, menu: menuPage, stock: stockPage, reports: reports, tables: tables, setup: setup }[page] || overview;
    root.innerHTML = `<div class="staff">
      <div class="mtop"><button class="btn icon sm quiet" data-a="side" aria-label="Open navigation" style="background:rgba(255,255,255,.1);color:#fff">${icon('menu')}</button><span class="plate">${esc(S().settings.name)}</span></div>
      ${side()}<main class="main" id="smain">${S().ready ? body() : `<div class="empty">${icon('clock')}<h2>Loading café data</h2></div>`}</main></div>`;
    after();
    window.scrollTo(0, y);
  }
  function after() {
    if (page === 'orders') ticker = setInterval(() => { for (const el of $$('[data-age]', root)) { const t = +el.dataset.age; el.textContent = UI.mmss(t); el.classList.toggle('late', Date.now() - t > 15 * 60000); } }, 1000);
    bindCharts();
  }
  const head = (title, sub, acts = '') => `<div class="s-head"><h1>${title}</h1><div class="acts">${acts}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  function modeBanner() {
    const m = S().mode;
    if (m === 'cloud' && !S().menu.length && S().synced) return `<div class="banner info">${icon('info')}<span>Your shared café database is empty. Load the starter menu and stock to begin. You can edit everything afterwards.</span><button class="btn sm" data-a="seed">Load starter menu</button></div>`;
    if (m === 'local-preview') return `<div class="banner">${icon('info')}<span>Sign in to Claude to sync orders between devices. Until then, changes stay in this browser.</span></div>`;
    if (S().error === 'slow') return `<div class="banner">${icon('alert')}<span>The shared database is slow to answer. Data may be out of date.</span></div>`;
    return '';
  }

  /* ---------------- charts (SVG, single series) ---------------- */
  function columns(data, o = {}) {
    const W = 640, H = o.h || 190, pl = 46, pr = 8, pt = 14, pb = 26;
    const max = Math.max(1, ...data.map((d) => d.v));
    const nice = (() => { const raw = max / 3, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; })();
    const top = Math.ceil(max / nice) * nice;
    const iw = W - pl - pr, ih = H - pt - pb, n = data.length, slot = iw / n, bw = Math.min(24, slot * 0.62);
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += nice) { const y = pt + ih - (v / top) * ih; g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#F0E9E1" stroke-width="1"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8E7D6F">${o.fmtAxis ? o.fmtAxis(v) : v}</text>`; }
    const every = Math.ceil(n / (o.maxLabels || 12));
    data.forEach((d, i) => {
      const x = pl + i * slot + (slot - bw) / 2, h = (d.v / top) * ih, y = pt + ih - h, r = Math.min(4, h / 2, bw / 2);
      const path = h > 0.5 ? `M${x},${pt + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${pt + ih} Z` : '';
      g += `<g data-tip="${esc(d.tip || '')}"><rect x="${pl + i * slot}" y="${pt}" width="${slot}" height="${ih}" fill="transparent"/>${path ? `<path d="${path}" fill="${d.hl === false ? '#E3CFB9' : C.bar}"/>` : ''}</g>`;
      if (i % every === 0 || i === n - 1) g += `<text x="${pl + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8E7D6F">${esc(d.l)}</text>`;
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}" stroke="#D9CDC0" stroke-width="1"/>`;
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Chart')}">${g}</svg></div>`;
  }
  function hbars(rows, fmt) {
    const max = Math.max(1, ...rows.map((r) => r.v));
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r.l)}</span><span class="track"><span class="fill" style="width:${(r.v / max) * 100}%"></span></span><span class="val">${fmt(r)}</span></div>`).join('')}</div>`;
  }
  function split(parts) {
    const tot = parts.reduce((s, p) => s + p.v, 0) || 1;
    return `<div class="split" role="img" aria-label="${esc(parts.map((p) => `${p.l} ${Math.round((p.v / tot) * 100)}%`).join(', '))}">${parts.filter((p) => p.v > 0).map((p) => `<div style="width:${(p.v / tot) * 100}%;background:${p.c}" title="${esc(p.l)}"></div>`).join('')}</div>
      <div class="legend">${parts.map((p) => `<span><i style="background:${p.c}"></i>${esc(p.l)} <b class="money">${D.money(p.v)}</b> <span class="faint">${Math.round((p.v / tot) * 100)}%</span></span>`).join('')}</div>`;
  }
  function bindCharts() {
    let tip = null;
    for (const ch of $$('.chart', root)) {
      ch.onpointermove = (e) => {
        const g = e.target.closest('[data-tip]');
        if (!g || !g.dataset.tip) { if (tip) tip.hidden = true; return; }
        if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
        tip.hidden = false; tip.innerHTML = g.dataset.tip; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY - 8 + 'px';
      };
      ch.onpointerleave = () => { if (tip) tip.hidden = true; };
    }
  }
  const sumBy = (list, f) => list.reduce((s, o) => s + f(o), 0);
  function rangeOf(r) {
    const now = Date.now(), sod = D.startOfDay(now);
    if (r === 'today') return [sod, now + 1];
    if (r === 'yesterday') return [sod - 864e5, sod];
    if (r === '7d') return [sod - 6 * 864e5, now + 1];
    if (r === '30d') return [sod - 29 * 864e5, now + 1];
    if (r === 'month') { const d = new Date(now); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now + 1]; }
    return [0, now + 1];
  }
  const inRange = (o, [a, b]) => o.createdAt >= a && o.createdAt < b;

  /* ---------------- overview ---------------- */
  function overview() {
    const all = S().orders, sod = D.startOfDay(), now = Date.now();
    const today = all.filter((o) => o.createdAt >= sod && sales(o));
    const yday = all.filter((o) => o.createdAt >= sod - 864e5 && o.createdAt < now - 864e5 && sales(o));
    const tSales = sumBy(today, (o) => o.total), ySales = sumBy(yday, (o) => o.total);
    const delta = ySales ? Math.round(((tSales - ySales) / ySales) * 100) : null;
    const up = unpaidOrders();
    // average kitchen time: placed to ready, for today's orders that reached ready
    const kts = today.map((o) => { const r = (o.log || []).find((x) => x.s === 'ready'); return r ? (r.at - o.createdAt) / 60000 : null; }).filter((x) => x != null && x >= 0 && x < 180);
    const kt = kts.length ? Math.round(kts.reduce((a, b) => a + b, 0) / kts.length) : 0;
    const kpis = `<div class="kpis">
      <div class="kpi"><div class="l">Sales today</div><div class="v money">${D.money(tSales)}</div><div class="d ${delta == null ? '' : delta >= 0 ? 'up' : 'down'}">${delta == null ? 'No sales yesterday by this time' : `${delta >= 0 ? '+' : ''}${delta}% vs this time yesterday`}</div></div>
      <div class="kpi"><div class="l">Orders today</div><div class="v num">${today.length}</div><div class="d">${today.filter((o) => o.source === 'portal').length} from the portal${kt ? `, kitchen ${kt} min avg` : ''}</div></div>
      <div class="kpi"><div class="l">Average order</div><div class="v money">${D.money(today.length ? Math.round(tSales / today.length / 100) * 100 : 0)}</div><div class="d">GST included</div></div>
      <div class="kpi"><div class="l">Waiting for payment</div><div class="v money">${D.money(sumBy(up, (o) => o.total))}</div><div class="d">${up.length} bill${up.length === 1 ? '' : 's'}</div></div></div>`;
    if (!all.length) {
      return head('Today', D.dateLong(now), `<a class="btn" href="${href('billing')}">${icon('plus')}New bill</a>`) + modeBanner() + kpis +
        `<div class="box"><div class="empty" style="padding:28px 10px">${icon('chart')}<h2>No sales yet</h2><p>Place a test order from the customer portal, or add two weeks of sample sales to explore the dashboard and reports. Sample sales are marked and can be removed in Setup.</p>
        <div class="row" style="justify-content:center;margin-top:14px;flex-wrap:wrap"><a class="btn" href="${custHref('#menu')}"${custAttrs}>Open the customer portal</a><button class="btn ghost" data-a="sample">Add sample sales</button></div></div></div>`;
    }
    const hours = []; for (let h = 7; h <= 23; h++) hours.push(h);
    const byHour = hours.map((h) => { const v = sumBy(today.filter((o) => new Date(o.createdAt).getHours() === h), (o) => o.total); return { l: h % 12 === 0 ? '12' + (h < 12 ? 'a' : 'p') : (h % 12) + (h < 12 ? 'a' : 'p'), v, tip: `<b>${D.money(v)}</b> between ${D.hm(D.pad2(h) + ':00')} and ${D.hm(D.pad2((h + 1) % 24) + ':00')}` }; });
    const days = []; for (let k = 13; k >= 0; k--) { const a = sod - k * 864e5, b = a + 864e5; const list = all.filter((o) => o.createdAt >= a && o.createdAt < b && sales(o)); const v = sumBy(list, (o) => o.total); days.push({ l: k === 0 ? 'Today' : new Date(a).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), v, tip: `<b>${D.money(v)}</b> on ${D.dateShort(a)}, ${list.length} orders` }); }
    const top = {}; for (const o of today) for (const l of o.items || []) top[l.name] = (top[l.name] || 0) + l.qty;
    const topRows = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }));
    const paid = today.filter((o) => o.pay && o.pay.status === 'paid');
    const pay = ['upi', 'card', 'cash', 'online'].map((k) => ({ l: { upi: 'UPI', card: 'Card', cash: 'Cash', online: 'Apps' }[k], c: C[k], v: paid.reduce((a, o) => a + D.payParts(o).filter((p) => p.m === k).reduce((x, p) => x + p.a, 0), 0) }));
    const attn = [];
    for (const o of up.slice(0, 5)) attn.push(`<button data-bill="${esc(o.id)}"><span class="ico ${o.pay.status === 'pending' ? 'warn' : 'info'}">${icon(o.pay.status === 'pending' ? 'upi' : 'receipt')}</span><span><span class="t">${esc(o.id)} ${o.pay.status === 'pending' ? 'UPI to confirm' : 'not paid'}</span><br><span class="s">${o.table ? 'Table ' + o.table : 'Takeaway'}, ${D.money(o.total)}, ${UI.ago(o.createdAt)} ago</span></span></button>`);
    for (const s of stockIssues().slice(0, 6)) attn.push(`<a href="${href('stock')}"><span class="ico ${s.state === 'out' ? 'bad' : 'warn'}">${icon('box')}</span><span><span class="t">${esc(s.name)} ${s.state === 'out' ? 'out of stock' : 'running low'}</span><br><span class="s">${fmtQty(Math.max(0, s.qty), s.unit)} left, reorder at ${fmtQty(s.reorder, s.unit)}</span></span></a>`);
    const soldOut = S().menu.filter((d) => status(d).reason === 'stock');
    if (soldOut.length) attn.push(`<a href="${href('menu')}"><span class="ico bad">${icon('utensils')}</span><span><span class="t">${soldOut.length} dish${soldOut.length > 1 ? 'es' : ''} sold out</span><br><span class="s">${esc(soldOut.map((d) => d.name).join(', '))}</span></span></a>`);
    return head('Today', D.dateLong(now), `<a class="btn ghost" href="${href('orders')}">${icon('bell')}Kitchen board</a><a class="btn" href="${href('billing')}">${icon('plus')}New bill</a>`) + modeBanner() + kpis +
      `<div class="dash"><div class="col">
        <div class="box"><h2>Sales by hour <span class="faint">Today, GST included</span></h2>${columns(byHour, { label: 'Sales by hour today', fmtAxis: (v) => D.compact(v) })}</div>
        <div class="box"><h2>Last 14 days <span class="faint">Daily sales</span></h2>${columns(days, { label: 'Daily sales, last 14 days', fmtAxis: (v) => D.compact(v), maxLabels: 7 })}</div>
      </div><div class="col">
        <div class="box"><h2>Needs attention</h2>${attn.length ? `<div class="attn">${attn.join('')}</div>` : `<p class="muted" style="margin:0">Nothing needs you right now.</p>`}</div>
        <div class="box"><h2>Top dishes today</h2>${topRows.length ? hbars(topRows, (r) => `${r.v} sold`) : '<p class="muted" style="margin:0">No dishes sold yet today.</p>'}</div>
        <div class="box"><h2>Payments today <span class="faint">Paid bills</span></h2>${sumBy(pay, (p) => p.v) ? split(pay) : '<p class="muted" style="margin:0">No paid bills yet today.</p>'}</div>
      </div></div>`;
  }

  /* ---------------- orders (KOT board) ---------------- */
  function kotCard(o) {
    const p = o.pay || {};
    const payc = p.status === 'paid' ? '<span class="chip ok">Paid</span>' : p.status === 'pending' ? '<span class="chip warn">UPI to confirm</span>' : '<span class="chip bad">Unpaid</span>';
    const next = { new: ['preparing', 'Start preparing'], preparing: ['ready', 'Mark ready'], ready: ['served', 'Served'] }[o.status];
    const fresh = o.status === 'new' && Date.now() - o.createdAt < 120000;
    return `<article class="kot${fresh ? ' fresh' : ''}" aria-label="Order ${esc(o.id)}">
      <div class="hd"><span class="id">${esc(o.id)}</span><span class="where">${esc(D.whereLabel(o))}</span>${o.pickupAt ? `<span class="pick">Pickup ${D.time12(o.pickupAt)}</span>` : ''}<span class="age" data-age="${o.createdAt}">${UI.mmss(o.createdAt)}</span></div>
      <ul>${(o.items || []).map((l) => `<li><b>${l.qty}×</b><span>${esc(l.name)}${(l.opts || []).length ? `<span class="n opts">${esc(l.opts.join(', '))}</span>` : ''}${l.note ? `<span class="n">${esc(l.note)}</span>` : ''}</span></li>`).join('')}</ul>
      <div class="ft">${payc}${o.channel ? `<span class="chip app ${esc(o.channel)}">${esc(D.CHANNELS[o.channel].label)}${o.extId ? ' ' + esc(String(o.extId).slice(-6)) : ''}</span>` : `<span class="chip">${o.source === 'portal' ? 'Portal' : 'Counter'}</span>`}
        <button class="btn xs ghost" data-kot="${esc(o.id)}" aria-label="Print kitchen ticket">${icon(Printer.ready(Printer.kotSlot()) || UI.canPrint() ? 'print' : 'download', 'sm')}KOT${o.kotAt ? ' again' : ''}</button>
        ${canDo('cancel') ? `<button class="btn xs danger ghost" data-cancel="${esc(o.id)}">Cancel</button>` : ''}
        ${next ? `<button class="btn sm ${o.status === 'new' ? 'saffron' : ''}" data-next="${esc(o.id)}" data-to="${next[0]}">${next[1]}</button>` : ''}</div></article>`;
  }
  function orders() {
    const list = S().orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status) && (kf.type === 'all' || (kf.type === 'apps' ? !!o.channel : o.type === kf.type))).sort((a, b) => a.createdAt - b.createdAt);
    const lane = (k, t) => { const l = list.filter((o) => o.status === k); return `<section class="lane" aria-label="${t}"><h2>${t}<span class="count">${l.length}</span></h2>${l.length ? l.map(kotCard).join('') : `<div class="none">${k === 'new' ? 'New orders appear here the moment they are placed.' : 'Nothing here.'}</div>`}</section>`; };
    const served = S().orders.filter((o) => o.status === 'served' && o.createdAt >= D.startOfDay()).slice(0, 8);
    return head('Orders', 'Kitchen order tickets from the customer app, the counter and Zomato or Swiggy, live.',
      `<div class="seg" role="group" aria-label="Order type">${[['all', 'All'], ['dine-in', 'Dine-in'], ['takeaway', 'Takeaway'], ['apps', 'Apps']].map(([k, l]) => `<button data-kf="${k}" aria-pressed="${kf.type === k}">${l}</button>`).join('')}</div>
       <button class="btn ghost sm" data-a="sound" aria-pressed="${soundOn}">${icon(soundOn ? 'sound' : 'mute', 'sm')}${soundOn ? 'Sound on' : 'Sound off'}</button>`) +
      `<div class="board">${lane('new', 'New')}${lane('preparing', 'Preparing')}${lane('ready', 'Ready to serve')}</div>
      ${served.length ? `<div class="box" style="margin-top:14px"><h2>Served today <span class="faint">Latest ${served.length}</span></h2><div class="row wrap">${served.map((o) => `<button class="chip" data-bill="${esc(o.id)}">${esc(o.id)}, ${o.table ? 'T' + o.table : 'TA'}, ${D.time12(o.createdAt)}</button>`).join('')}</div></div>` : ''}`;
  }
  async function advance(id, to) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    try { await D.api.patchOrder(id, { status: to, log: [...(o.log || []), { s: to, at: Date.now(), by: who() }] }); toast(`${id} ${to === 'preparing' ? 'started' : to === 'ready' ? 'is ready' : 'served'}`); }
    catch (e) { /* handled globally */ }
  }
  async function cancelOrder(id) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    const paid = o.pay && o.pay.status === 'paid';
    const ok = await confirmBox(`Cancel order ${id}? Its ingredients go back into stock.${paid ? ' It was already paid, so it will be marked for refund.' : ''}`, { title: 'Cancel this order?', ok: 'Cancel order', cancel: 'Keep order', danger: true });
    if (!ok) return;
    await guarded(paid ? 'cancelPaid' : 'cancel', `Cancelling ${paid ? 'a paid' : 'an'} order`, async (ap) => {
      const by = who(), extra = ap ? { approvedBy: ap.name } : {};
      await D.api.patchOrder(id, { status: 'cancelled', log: [...(o.log || []), Object.assign({ s: 'cancelled', at: Date.now(), by }, extra)], pay: Object.assign({}, o.pay, paid ? Object.assign({ status: 'refunded', refundAt: Date.now(), refundBy: by }, extra) : {}) });
      toast(`${id} cancelled${ap && ap.id !== (me() || {}).id ? `, approved by ${ap.name}` : ''}`);
    });
  }
  function kotText(o) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>KOT ${esc(o.id)}</title><style>body{font-family:ui-monospace,Menlo,monospace;font-size:14px;max-width:300px;margin:10px auto}h1{font-size:20px;margin:0}hr{border:0;border-top:1px dashed #000}li{margin:4px 0}small{display:block;color:#444}</style></head><body>
      <h1>KOT ${esc(o.id)}</h1><div>${esc(D.whereLabel(o))}, ${new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div><hr><ul style="padding-left:18px">${(o.items || []).map((l) => `<li><b>${l.qty} x ${esc(l.name)}</b>${(l.opts || []).length ? `<br><small>${esc(l.opts.join(', '))}</small>` : ''}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</li>`).join('')}</ul><hr></body></html>`;
  }
  // print a KOT or bill on this device's thermal printer; without one, use the browser's print dialog or a download
  async function printKotFor(o, reprint) {
    try { if (await Printer.printKot(o, reprint)) { toast(`KOT ${o.id} printed`, 'ok', 1500); return true; } } catch (e) { toast(`Kitchen printer: ${e.message || 'could not print'}`, 'bad', 4000); return false; }
    if (UI.canPrint()) printHtml(null, kotText(o).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '')); else UI.download(`KOT-${o.id}.html`, kotText(o), 'text/html');
    return true;
  }
  async function printBillFor(list, extra = {}) {
    list = Array.isArray(list) ? list : [list];
    try { let any = false; for (const o of list) any = (await Printer.printBill(o, S().settings, extra)) || any; if (any) { toast(list.length > 1 ? 'Bills printed' : `Bill ${list[0].id} printed`, 'ok', 1500); return true; } }
    catch (e) { toast(`Bill printer: ${e.message || 'could not print'}`, 'bad', 4000); return false; }
    if (extra.auto) return false;
    if (UI.canPrint()) printHtml(null, list.map((o) => Invoice.lines(o, S().settings)).join('')); else UI.download(`${list[0].id}-bill.html`, Invoice.html(list[0], S().settings), 'text/html');
    return true;
  }
  function printHtml(html, inner) {
    let area = $('#print-area'); if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    area.innerHTML = inner;
    try { window.print(); } catch (e) { /* ignore */ }
    setTimeout(() => { area.innerHTML = ''; }, 1000);
  }

  /* ---------------- billing (POS) ---------------- */
  const PM = { cash: 'Cash', upi: 'UPI', card: 'Card', split: 'Split', counter: 'Counter', online: 'Paid on app' };
  const posTiles = () => { const ql = pos.q.trim().toLowerCase(); return S().menu.filter((d) => (pos.cat === 'All' || d.category === pos.cat) && (!ql || d.name.toLowerCase().includes(ql))); };
  // unpaid dine-in bills from today, grouped by table: the running tab
  const openTabs = () => {
    const sod = D.startOfDay(), tabs = {};
    for (const o of unpaidOrders()) { if (o.type !== 'dine-in' || !o.table || o.createdAt < sod) continue; (tabs[o.table] = tabs[o.table] || []).push(o); }
    return tabs;
  };
  function billing() {
    const cats = ['All', ...new Set(S().menu.map((d) => d.category))];
    const waiting = unpaidOrders(), tabs = openTabs();
    const multi = Object.entries(tabs).filter(([, l]) => l.length > 1);
    const inTab = new Set(multi.flatMap(([, l]) => l.map((o) => o.id)));
    return head('Billing', 'Tap a dish to add it, or type and press Enter. Press / to search.', (Printer.ready('bill') && Printer.cfg.bill.drawer ? `<button class="btn ghost" data-a="drawer">${icon('cash')}Open drawer</button>` : '') + (canDo('dayClose') ? `<button class="btn ghost" data-a="zreport">${icon('receipt')}Close the day</button>` : '')) +
      (waiting.length ? `<div class="box" style="margin-bottom:14px"><h2>${icon('receipt')}Waiting for payment <span class="faint">${waiting.length} bill${waiting.length > 1 ? 's' : ''}, ${D.money(sumBy(waiting, (o) => o.total))}</span></h2>
        <div class="row wrap">${multi.map(([t, l]) => `<button class="btn saffron sm" data-psettle="${t}">${icon('dine', 'sm')}Table ${t}: ${l.length} bills, ${D.money(sumBy(l, (o) => o.total))}. Settle</button>`).join('')}
        ${waiting.filter((o) => !inTab.has(o.id)).map((o) => `<button class="btn ${o.pay.status === 'pending' ? 'saffron' : 'ghost'} sm" data-collect="${esc(o.id)}">${esc(o.id)}, ${o.table ? 'T' + o.table : 'TA'}, ${D.money(o.total)}${o.pay.status === 'pending' ? ', UPI sent' : ''}</button>`).join('')}</div></div>` : '') +
      `<div class="pos"><div>
        <div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Search dishes, Enter to add" value="${esc(pos.q)}" data-pq aria-label="Search dishes" aria-keyshortcuts="/"></label>
        <div class="pills">${cats.map((c) => `<button class="pill" data-pc="${esc(c)}" aria-pressed="${pos.cat === c}">${esc(c)}</button>`).join('')}</div></div>
        <div class="tiles" data-tiles>${tilesHtml(posTiles())}</div></div>
        <aside class="box ticket" aria-label="Current bill" data-ticket>${ticketHtml()}</aside></div>`;
  }
  function tilesHtml(tiles) {
    return tiles.map((d) => {
      const s = status(d), q = pos.lines.filter((l) => l.id === d.id).reduce((a, l) => a + l.qty, 0);
      return `<button class="tile${s.ok ? '' : ' off'}" data-padd="${d.id}" ${s.ok ? '' : 'aria-disabled="true"'}>${Viewer.img(d.model, '')}${q ? `<span class="badge q">${q}</span>` : ''}
        <span class="nm">${vmark(d.veg)}<span>${esc(d.name)}</span></span><span class="pr">${D.rupees(d.price)}</span>${s.ok ? (s.low ? `<span class="why" style="color:var(--warn)">${s.portions} left</span>` : '') : `<span class="why">${esc(s.short || s.label)}</span>`}</button>`;
    }).join('') || '<p class="muted">No dishes match.</p>';
  }
  const posLines = () => pos.lines.map((l) => { const d = X().menuById[l.id]; return d ? Object.assign({}, l, { name: d.name, price: d.price + (Number(l.add) || 0), veg: d.veg, model: d.model }) : null; }).filter(Boolean);
  const posRewards = () => { const st = S().settings, ph = D.cleanPhone(pos.phone); if (st.loyalty === false || !ph) return null; return Object.assign({ phone: ph }, D.beans(ph, S().orders, st)); };
  const posRedeem = () => {
    const st = S().settings, rw = posRewards(); if (!rw || !pos.redeem) return 0;
    const need = Number(st.redeemBeans) || 100, val = Math.round((Number(st.redeemValue) || 50) * 100);
    const sub = posLines().reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0);
    return rw.balance >= need && sub > val ? val : 0;
  };
  const posBill = () => {
    const extra = pos.discMode === 'amt' ? Math.round((+pos.disc || 0) * 100) : 0, sub = posLines().reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0);
    const pct = pos.discMode === 'pct' ? Math.min(100, Math.max(0, +pos.disc || 0)) : 0;
    return D.bill(posLines(), { rate: S().settings.gstRate, incl: S().settings.taxInclusive, disc: Math.round((sub * pct) / 100) + extra + posRedeem() });
  };
  function ticketHtml() {
    const lines = posLines(), b = posBill(), n = S().settings.tables || 12, st = S().settings;
    const tab = pos.type === 'dine-in' && pos.table ? openTabs()[+pos.table] || [] : [];
    const rw = posRewards(), need = Number(st.redeemBeans) || 100;
    const chSeg = `<div class="seg chseg" role="group" aria-label="Order from" style="margin-bottom:10px">${[['', 'Counter'], ...Object.entries(D.CHANNELS).filter(([k]) => k !== 'ondc').map(([k, c]) => [k, c.label])].map(([k, l]) => `<button data-pch="${k}" aria-pressed="${pos.channel === k}">${l}</button>`).join('')}</div>`;
    if (pos.channel) {
      const ch = D.CHANNELS[pos.channel], ab = D.bill(lines, { rate: 0 });
      return `<div class="row" style="margin-bottom:10px"><h2 style="margin:0">${esc(ch.label)} order</h2><span class="grow"></span>${lines.length ? `<button class="btn xs ghost" data-a="pclear">Clear</button>` : ''}</div>${chSeg}
        <label class="field"><span>${esc(ch.label)} order number</span><input class="in" data-pext value="${esc(pos.ext)}" placeholder="As shown on the ${esc(ch.label)} tablet" maxlength="24"></label>
        <div class="lines" style="margin-top:8px">${lines.length ? lines.map((l, i) => `<div class="tline"><div><div class="nm">${esc(l.name)}</div>${(l.opts || []).length ? `<div class="sm opts">${esc(l.opts.join(', '))}</div>` : ''}${l.note ? `<div class="sm" style="color:var(--warn)">${esc(l.note)}</div>` : ''}<div class="sm money">${D.rupees(l.price)} <button class="linkbtn" data-pedit="${i}">${D.optionGroups(X().menuById[l.id]).length ? 'Customise' : 'Note'}</button></div></div>
          <div class="mini-step"><button data-pdec="${i}" aria-label="One less">${icon('minus', 'sm')}</button><span>${l.qty}</span><button data-pinc="${i}" aria-label="One more">${icon('plus', 'sm')}</button></div><span class="amt">${D.money(Math.round(l.price * 100) * l.qty)}</span></div>`).join('') : '<p class="muted" style="margin:14px 0">Tap the dishes in the app order.</p>'}</div>
        <table class="sumtbl" style="margin-top:10px"><tbody><tr class="total"><td>Order value</td><td>${D.money(ab.total)}</td></tr></tbody></table>
        <div class="note-line">${icon('info', 'sm')}<span>Paid on ${esc(ch.label)}. ${esc(ch.label)} charges the guest GST and pays it (section 9(5)), so this order carries no café GST and no invoice number.</span></div>
        <button class="btn saffron block lg" data-a="papp" ${lines.length ? '' : 'disabled'}>${icon('bell')}Accept and send to kitchen</button>`;
    }
    return `<div class="row" style="margin-bottom:10px"><h2 style="margin:0">Current bill</h2><span class="grow"></span>${lines.length ? `<button class="btn xs ghost" data-a="pclear">Clear</button>` : ''}</div>${chSeg}
      <div class="row wrap" style="margin-bottom:8px"><div class="seg">${[['dine-in', 'Dine-in'], ['takeaway', 'Takeaway']].map(([k, l]) => `<button data-pt="${k}" aria-pressed="${pos.type === k}">${l}</button>`).join('')}</div>
      ${pos.type === 'dine-in' ? `<select class="in" data-ptable style="width:auto;min-height:36px" aria-label="Table"><option value="">Table</option>${Array.from({ length: n }, (_, i) => `<option ${+pos.table === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>` : ''}</div>
      ${tab.length ? `<div class="tabnote">${icon('receipt', 'sm')}<span class="grow">Table ${esc(pos.table)} has ${tab.length} unpaid bill${tab.length > 1 ? 's' : ''}, ${D.money(sumBy(tab, (o) => o.total))}</span><button class="btn xs" data-psettle="${esc(pos.table)}">Settle table</button></div>` : ''}
      <div class="lines">${lines.length ? lines.map((l, i) => `<div class="tline"><div><div class="nm">${esc(l.name)}</div>${(l.opts || []).length ? `<div class="sm opts">${esc(l.opts.join(', '))}</div>` : ''}${l.note ? `<div class="sm" style="color:var(--warn)">${esc(l.note)}</div>` : ''}
        <div class="sm money">${D.rupees(l.price)} <button class="linkbtn" data-pedit="${i}">${D.optionGroups(X().menuById[l.id]).length ? 'Customise' : 'Note'}</button></div></div>
        <div class="mini-step"><button data-pdec="${i}" aria-label="One less">${icon('minus', 'sm')}</button><span>${l.qty}</span><button data-pinc="${i}" aria-label="One more">${icon('plus', 'sm')}</button></div><span class="amt">${D.money(Math.round(l.price * 100) * l.qty)}</span></div>`).join('') : '<p class="muted" style="margin:14px 0">Tap a dish to start a bill.</p>'}</div>
      <div class="row" style="margin:12px 0 8px;align-items:flex-end"><label class="field grow"><span>Discount${canDo('discountAny') ? '' : ` <small class="faint">up to ${esc(S().settings.cashierMaxDisc ?? 10)}%</small>`}</span><input class="in" inputmode="decimal" placeholder="0" value="${esc(pos.disc)}" data-pdisc></label>
        <div class="seg" style="margin-bottom:3px"><button data-pdm="pct" aria-pressed="${pos.discMode === 'pct'}">%</button><button data-pdm="amt" aria-pressed="${pos.discMode === 'amt'}">₹</button></div>
        ${st.loyalty !== false ? `<label class="field" style="width:46%"><span>Rewards phone</span><input class="in" inputmode="tel" maxlength="14" placeholder="Optional" value="${esc(pos.phone)}" data-pphone></label>` : ''}</div>
      <div data-prw>${rewardsLine(rw, need)}</div>
      <table class="sumtbl" data-ptot>${totRows(b)}</table>
      <div class="paybtns four" style="margin-top:12px">
        <button class="btn" data-pay="cash" ${lines.length ? '' : 'disabled'} title="Cash">${icon('cash')}Cash</button>
        <button class="btn" data-pay="upi" ${lines.length ? '' : 'disabled'}>${icon('upi')}UPI</button>
        <button class="btn" data-pay="card" ${lines.length ? '' : 'disabled'}>${icon('card')}Card</button>
        <button class="btn" data-pay="split" ${lines.length ? '' : 'disabled'}>${icon('sliders')}Split</button></div>
      ${pos.type === 'dine-in' ? `<button class="btn ghost block" style="margin-top:8px" data-a="pkot" ${lines.length ? '' : 'disabled'}>${icon('bell')}Send to kitchen, pay later</button>` : ''}`;
  }
  const rewardsLine = (rw, need) => (!rw ? '' : `<div class="row" style="gap:8px;font-size:13.5px;margin-bottom:6px">${icon('star', 'sm')}<span class="grow">${rw.balance} bean${rw.balance === 1 ? '' : 's'}${rw.pending ? `, ${rw.pending} pending` : ''}</span>${rw.balance >= need ? `<label class="row" style="gap:6px"><span class="switch"><input type="checkbox" data-predeem ${pos.redeem ? 'checked' : ''}></span>Use ${need} for ₹${S().settings.redeemValue || 50} off</label>` : ''}</div>`);
  const totRows = (b) => `<tbody><tr class="sub"><td>Item total</td><td>${D.money(b.sub, true)}</td></tr>${b.disc ? `<tr class="sub"><td>Discount${posRedeem() ? ' and rewards' : ''}</td><td>−${D.money(b.disc, true)}</td></tr>` : ''}
    <tr class="sub"><td>CGST ${b.rate / 2}%</td><td>${D.money(b.cgst, true)}</td></tr><tr class="sub"><td>SGST ${b.rate / 2}%</td><td>${D.money(b.sgst, true)}</td></tr>${b.round ? `<tr class="sub"><td>Round off</td><td>${b.round > 0 ? '+' : '−'}${D.money(Math.abs(b.round), true)}</td></tr>` : ''}
    <tr class="total"><td>Total</td><td>${D.money(b.total)}</td></tr></tbody>`;
  function refreshTicket() { const t = $('[data-ticket]', root); if (t) t.innerHTML = ticketHtml(); refreshTiles(); }
  function refreshTotals() { const tb = $('[data-ptot]', root); if (tb) tb.innerHTML = totRows(posBill()); const r = $('[data-prw]', root); if (r) r.innerHTML = rewardsLine(posRewards(), Number(S().settings.redeemBeans) || 100); }
  function refreshTiles() { const t = $('[data-tiles]', root); if (t) t.innerHTML = tilesHtml(posTiles()); }
  function posReserve(skip) { const r = {}; pos.lines.forEach((l, i) => { if (i === skip) return; const dd = X().menuById[l.id]; for (const x of (dd && dd.recipe) || []) r[x.ing] = (r[x.ing] || 0) + x.qty * l.qty; for (const k in l.xr || {}) r[k] = (r[k] || 0) + l.xr[k] * l.qty; }); return r; }
  // tap adds the standard version; "+" on a line repeats that line with its choices
  function posAdd(id, line) {
    const d = X().menuById[id]; if (!d) return false;
    const s = status(d); if (!s.ok) { toast(`${d.name}: ${s.label}`, 'warn'); return false; }
    if (!D.dishStatus(d, X().stockMap, S().settings, new Date(), posReserve()).ok) { toast(`Not enough stock for another ${d.name}`, 'warn'); return false; }
    const l = line || pos.lines.find((x) => x.id === id && !(x.opts || []).length && !x.note);
    if (l) l.qty++; else pos.lines.push({ id, qty: 1, note: '', opts: [], add: 0, xr: {} });
    refreshTicket(); return true;
  }
  function lineEditor(i) {
    const l = pos.lines[i]; const d = l && X().menuById[l.id]; if (!d) return;
    const groups = D.optionGroups(d), picks = {};
    groups.forEach((g, gi) => { const idx = g.choices.map((c, ci) => ((l.opts || []).includes(c.n) ? ci : -1)).filter((x) => x >= 0); picks[gi] = g.many ? idx : [idx[0] || 0]; });
    const m = modal({ title: d.name, body: '<div data-le></div>', actions: [{ label: 'Cancel' }, { label: 'Save', cls: 'saffron', onClick: (mm) => {
      const sel = D.resolveOpts(d, picks), note = $('[data-lenote]', mm.el).value.trim();
      const before = { opts: l.opts, add: l.add, xr: l.xr, note: l.note };
      Object.assign(l, { opts: sel.opts, add: sel.add, xr: sel.r, note });
      if (!D.dishStatus(d, X().stockMap, S().settings, new Date(), posReserve(i)).ok && Object.keys(sel.r).length) { Object.assign(l, before); toast('Not enough stock for those add-ons', 'warn'); return false; }
      refreshTicket();
    } }] });
    const draw = () => {
      const sel = D.resolveOpts(d, picks), note = ($('[data-lenote]', m.el) || {}).value;
      $('[data-le]', m.el).innerHTML = `${groups.map((g, gi) => `<div class="optgroup"><div class="og-h"><b>${esc(g.name)}</b><span class="faint">${g.many ? 'Choose any' : 'Choose one'}</span></div>
        <div class="og-c">${g.choices.map((c, ci) => `<button class="optc" data-og="${gi}" data-oc="${ci}" role="${g.many ? 'checkbox' : 'radio'}" aria-checked="${picks[gi].includes(ci)}">${esc(c.n)}${c.p ? `<span>+${D.rupees(c.p)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
        <label class="field"><span>Note for the kitchen</span><input class="in" maxlength="80" data-lenote value="${esc(note == null ? l.note || '' : note)}" placeholder="Less sugar, no onion"></label>
        <p class="muted" style="margin:10px 0 0">${D.rupees(d.price + sel.add)} each</p>`;
    };
    draw();
    m.el.addEventListener('click', (e) => { const oc = e.target.closest('[data-oc]'); if (!oc) return; const gi = +oc.dataset.og, ci = +oc.dataset.oc; if (groups[gi].many) picks[gi] = picks[gi].includes(ci) ? picks[gi].filter((x) => x !== ci) : picks[gi].concat(ci); else picks[gi] = [ci]; draw(); });
  }

  // payment dialog for new POS bills, for collecting portal orders and for settling a table
  function payDialog(method, amount, ref, onDone) {
    const s = S().settings;
    let body = '';
    const upiBox = (amt) => { const link = `upi://pay?pa=${encodeURIComponent((s.upiId || '').toLowerCase()).replace('%40', '@')}&pn=${encodeURIComponent(s.upiName || s.name)}&am=${(amt / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + ref)}&tr=${encodeURIComponent(ref)}`; return `<div class="upi-box"><div class="qr">${QR.svg(link, { margin: 1, dark: '#3E2A1E' })}</div><b>Customer scans to pay ${D.money(amt)}</b><span class="muted">UPI ID ${esc(s.upiId)}, reference ${esc(ref)}</span></div>`; };
    if (method === 'cash') {
      const sugg = [amount, Math.ceil(amount / 10000) * 10000, Math.ceil(amount / 50000) * 50000, 200000].filter((v, i, a) => v >= amount && a.indexOf(v) === i).slice(0, 4);
      body = `<div style="font-size:30px;font-weight:700" class="money">${D.money(amount)}</div>
        <label class="field" style="margin-top:12px"><span>Cash received</span><input class="in" inputmode="decimal" value="${(amount / 100).toFixed(0)}" data-recv autofocus></label>
        <div class="row wrap" style="margin-top:8px">${sugg.map((v) => `<button class="btn quiet sm" data-quick="${v}">${D.money(v)}</button>`).join('')}</div>
        <div style="margin-top:12px;font-size:16px">Change to return <b class="money" data-change>₹0</b></div>`;
    } else if (method === 'upi') {
      body = `${upiBox(amount)}<div class="testnote" style="margin-top:10px">${icon('info', 'sm')}<span>Confirm only after the payment shows in your UPI app or soundbox.</span></div>
        <label class="field" style="margin-top:10px"><span>UPI reference (optional)</span><input class="in" data-uref placeholder="12-digit UTR"></label>`;
    } else if (method === 'split') {
      body = `<div style="font-size:30px;font-weight:700" class="money">${D.money(amount)}</div><p class="muted" style="margin:4px 0 12px">Enter what the guest pays each way. The last box fills itself.</p>
        <div class="grid3">${['cash', 'upi', 'card'].map((k) => `<label class="field"><span>${PM[k]}</span><input class="in" inputmode="decimal" data-sp="${k}" value="${k === 'upi' ? (amount / 100).toFixed(0) : ''}" placeholder="0"></label>`).join('')}</div>
        <div style="margin-top:10px;font-size:15px" data-spleft></div>
        <label class="field" style="margin-top:10px"><span>UPI reference or card last 4 (optional)</span><input class="in" data-uref></label>`;
    } else {
      body = `<div style="font-size:30px;font-weight:700" class="money">${D.money(amount)}</div><p class="muted">Take the payment on your card terminal, then record it here.</p>
        <label class="field"><span>Last 4 digits of the card (optional)</span><input class="in" inputmode="numeric" maxlength="4" data-l4></label>`;
    }
    const spVals = (el) => Object.fromEntries(['cash', 'upi', 'card'].map((k) => [k, Math.round((parseFloat($(`[data-sp=${k}]`, el).value) || 0) * 100)]));
    const m = modal({
      title: { cash: 'Cash payment', upi: 'UPI payment', card: 'Card payment', split: 'Split payment' }[method], body,
      actions: [{ label: 'Back' }, {
        label: method === 'cash' ? 'Complete sale' : 'Payment received', cls: 'saffron', onClick: (mm) => {
          const pay = { method, status: 'paid', at: Date.now(), by: who() };
          if (method === 'cash') { const recv = Math.round((parseFloat($('[data-recv]', mm.el).value) || 0) * 100); if (recv < amount) { toast('Cash received is less than the total', 'warn'); return false; } pay.received = recv; pay.change = recv - amount; }
          if (method === 'upi') pay.ref = ($('[data-uref]', mm.el).value || '').trim() || ref;
          if (method === 'card') { pay.last4 = ($('[data-l4]', mm.el).value || '').replace(/\D/g, '').slice(-4); pay.ref = 'POS'; }
          if (method === 'split') {
            const v = spVals(mm.el), sum = v.cash + v.upi + v.card;
            if (sum !== amount) { toast(`The parts add up to ${D.money(sum, true)}, not ${D.money(amount, true)}`, 'warn'); return false; }
            pay.parts = Object.entries(v).filter(([, a]) => a > 0).map(([k, a]) => ({ m: k, a }));
            if (pay.parts.length === 1) { pay.method = pay.parts[0].m; delete pay.parts; }
            pay.ref = ($('[data-uref]', mm.el).value || '').trim() || ref;
          }
          onDone(pay);
        },
      }],
    });
    if (method === 'cash') {
      const inp = $('[data-recv]', m.el), ch = $('[data-change]', m.el);
      const upd = () => { const r = Math.round((parseFloat(inp.value) || 0) * 100); ch.textContent = D.money(Math.max(0, r - amount)); };
      inp.oninput = upd; upd();
      m.el.addEventListener('click', (e) => { const q = e.target.closest('[data-quick]'); if (q) { inp.value = (+q.dataset.quick / 100).toFixed(0); upd(); } });
    }
    if (method === 'split') {
      const order = [];
      const upd = (src) => {
        if (src) { const k = src.dataset.sp; order.splice(order.indexOf(k) >>> 0, order.includes(k) ? 1 : 0); order.push(k); }
        // the box typed in longest ago takes up the difference
        const v = spVals(m.el), auto = ['cash', 'upi', 'card'].find((k) => !order.includes(k)) || order[0];
        if (src && auto !== src.dataset.sp) { const rest = amount - Object.entries(v).filter(([k]) => k !== auto).reduce((a, [, x]) => a + x, 0); $(`[data-sp=${auto}]`, m.el).value = rest > 0 ? (rest / 100).toFixed(rest % 100 ? 2 : 0) : ''; }
        const w = spVals(m.el), left = amount - (w.cash + w.upi + w.card);
        $('[data-spleft]', m.el).innerHTML = left === 0 ? `${icon('check', 'sm')} Adds up to ${D.money(amount)}` : left > 0 ? `Still to pay <b class="money">${D.money(left, true)}</b>` : `<span style="color:var(--danger)">Over by ${D.money(-left, true)}</span>`;
      };
      m.el.addEventListener('input', (e) => { if (e.target.dataset.sp) upd(e.target); });
      upd();
    }
  }
  function newOrderFromTicket(pay) {
    const lines = posLines(), b = posBill();
    return D.api.nextNo().then(async (no) => {
      const now = Date.now(), ids = D.orderIds(no, S().settings.prefix || 'KM', now);
      const order = Object.assign({ id: ids.id, no, inv: ids.inv, createdAt: now, table: pos.type === 'dine-in' ? +pos.table : null, type: pos.type, source: 'pos', customer: null,
        items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, note: l.note || '', veg: l.veg, model: l.model, opts: l.opts || [] })), status: 'new', log: [{ s: 'new', at: now }],
        use: D.consumption(lines, X().menuById), pay, note: '', by: who() }, b);
      if (pos.approvedBy) order.approvedBy = pos.approvedBy;
      order.log[0].by = who();
      const ph = D.cleanPhone(pos.phone); if (ph && S().settings.loyalty !== false) { order.phone = ph; if (posRedeem()) order.beans = Number(S().settings.redeemBeans) || 100; }
      await D.api.putOrder(order);
      Object.assign(pos, { lines: [], disc: '', phone: '', redeem: false });
      if (pos.type === 'takeaway') pos.table = '';
      return order;
    });
  }
  // a cashier may give up to settings.cashierMaxDisc % off; more needs an owner's PIN (recorded on the bill)
  async function posReady() {
    if (!posLines().length) return false;
    const sub = posLines().reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0), manual = posBill().disc - posRedeem();
    const lim = Number(S().settings.cashierMaxDisc); pos.approvedBy = null;
    if (manual > 0 && sub > 0 && !canDo('discountAny') && (manual / sub) * 100 > (isNaN(lim) ? 10 : lim) + 1e-9) {
      const ap = await ownerApprove(`A discount over ${isNaN(lim) ? 10 : lim}%`); if (!ap) return false; pos.approvedBy = ap.name;
    }
    if (pos.type === 'dine-in' && !pos.table) { toast('Choose the table first', 'warn'); const sel = $('[data-ptable]', root); if (sel) sel.focus(); return false; }
    if (pos.phone && !D.cleanPhone(pos.phone)) { toast('Check the rewards phone number, or clear it', 'warn'); return false; }
    return true;
  }
  async function posCharge(method) {
    if (!(await posReady())) return;
    const b = posBill(), tmpRef = (S().settings.prefix || 'KM') + 'P' + Date.now().toString(36).toUpperCase().slice(-5);
    payDialog(method, b.total, tmpRef, async (pay) => {
      try { const order = await newOrderFromTicket(pay); pos.table = ''; refreshTicket(); receiptDialog([order], pay.change, { sale: true }); }
      catch (e) { toast('Could not save the bill. Try again.', 'bad'); }
    });
  }
  // dine-in: the kitchen gets the ticket now, the table pays at the end (Settle table)
  // an order from Zomato or Swiggy typed in from the app's tablet (or received by the webhook): paid on the app, GST paid by the app
  async function posAppOrder() {
    const lines = posLines(); if (!lines.length) return;
    const ch = pos.channel, ext = pos.ext.trim();
    if (!ext) { toast(`Enter the ${D.CHANNELS[ch].label} order number`, 'warn'); const i = $('[data-pext]', root); if (i) i.focus(); return; }
    if (S().orders.some((o) => o.channel === ch && String(o.extId) === ext)) { toast(`${D.CHANNELS[ch].label} order ${ext} is already in`, 'warn'); return; }
    const now = Date.now(), b = D.bill(lines, { rate: 0 });
    const order = Object.assign({ id: D.appOrderId(ch, ext, S().orders), no: null, inv: null, createdAt: now, table: null, type: 'delivery', source: ch, channel: ch, extId: ext, eco: true, customer: null,
      items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, note: l.note || '', veg: l.veg, model: l.model, opts: l.opts || [] })), status: 'new', log: [{ s: 'new', at: now, by: who() }],
      use: D.consumption(lines, X().menuById), pay: { method: 'online', status: 'paid', channel: ch, at: now, by: who() }, note: '', by: who() }, b, { ecoRate: S().settings.gstRate });
    try { await D.api.putOrder(order); Object.assign(pos, { lines: [], ext: '' }); refreshTicket(); toast(`${order.id} sent to the kitchen`); }
    catch (e) { toast('Could not save the order. Try again.', 'bad'); }
  }
  async function posSendKot() {
    if (!(await posReady())) return;
    try { const o = await newOrderFromTicket({ method: 'counter', status: 'unpaid' }); refreshTicket(); toast(`${o.id} sent to the kitchen for Table ${o.table}`); render(); }
    catch (e) { toast('Could not send the order. Try again.', 'bad'); }
  }
  function settleTable(t) {
    const list = (openTabs()[+t] || []).sort((a, b) => a.createdAt - b.createdAt); if (!list.length) return toast('Nothing to settle for this table', 'warn');
    const total = sumBy(list, (o) => o.total), ref = (S().settings.prefix || 'KM') + 'T' + t + '-' + Date.now().toString(36).toUpperCase().slice(-4);
    const m = modal({ title: `Settle Table ${t}`, body: `<div class="panel" style="padding:4px 14px">${list.map((o) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)"><b>${esc(o.id)}</b><span class="faint grow">${D.time12(o.createdAt)}, ${(o.items || []).reduce((a, l) => a + l.qty, 0)} items${o.pay.status === 'pending' ? ', UPI claimed' : ''}</span><b class="money">${D.money(o.total)}</b></div>`).join('')}
        <div class="row" style="padding:10px 0;font-size:18px;font-weight:750"><span class="grow">Total</span><span class="money">${D.money(total)}</span></div></div>
        <div class="paybtns four" style="margin-top:14px">${['cash', 'upi', 'card', 'split'].map((k) => `<button class="btn" data-cm="${k}">${icon(k === 'split' ? 'sliders' : k)}${PM[k]}</button>`).join('')}</div>`, foot: false });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cm]'); if (!b) return; m.close();
      payDialog(b.dataset.cm, total, ref, async (pay) => {
        const parts = pay.method === 'split' ? pay.parts : [{ m: pay.method, a: total }], shares = D.allocate(parts, list.map((o) => o.total));
        try {
          const done = [];
          for (let i = 0; i < list.length; i++) {
            const sh = shares[i], p = Object.assign({}, pay, { group: ref, groupTotal: total });
            if (sh.length > 1) Object.assign(p, { method: 'split', parts: sh }); else { p.method = sh[0].m; delete p.parts; }
            if (i !== list.length - 1) { delete p.change; delete p.received; }
            await D.api.patchOrder(list[i].id, { pay: p }); done.push(Object.assign({}, list[i], { pay: p }));
          }
          toast(`Table ${t} settled`); receiptDialog(done, pay.change, { sale: true });
        } catch (er) { toast('Could not save every payment. Check Bills and try again.', 'bad'); }
      });
    });
  }
  function collect(id) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    if (o.pay && o.pay.status === 'pending') {
      return modal({ title: `Confirm UPI for ${o.id}`, body: `<p class="muted" style="margin-top:0">The customer says they paid <b class="money">${D.money(o.total)}</b> by UPI${o.pay.ref ? ` with reference <b>${esc(o.pay.ref)}</b>` : ''}. Check your UPI app or soundbox before confirming.</p>`,
        actions: [{ label: 'Not received', cls: 'ghost', onClick: async () => { await D.api.patchOrder(o.id, { pay: Object.assign({}, o.pay, { status: 'unpaid', claimed: false }) }); toast('Marked as not paid'); } },
          { label: 'Collect another way', cls: 'ghost', onClick: () => { setTimeout(() => chooseCollect(o), 50); } },
          { label: 'Payment received', cls: 'saffron', onClick: async () => { await D.api.patchOrder(o.id, { pay: Object.assign({}, o.pay, { status: 'paid', at: Date.now(), by: who() }) }); toast(`${o.id} paid`); } }] });
    }
    chooseCollect(o);
  }
  function chooseCollect(o) {
    const m = modal({ title: `Collect ${D.money(o.total)} for ${o.id}`, body: `<div class="paybtns four">${['cash', 'upi', 'card', 'split'].map((k) => `<button class="btn" data-cm="${k}">${icon(k === 'split' ? 'sliders' : k)}${PM[k]}</button>`).join('')}</div>`, foot: false });
    m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-cm]'); if (!b) return; m.close(); payDialog(b.dataset.cm, o.total, o.id, async (pay) => { await D.api.patchOrder(o.id, { pay }); toast(`${o.id} paid`); receiptDialog([Object.assign({}, o, { pay })], pay.change, { sale: true }); }); });
  }
  function receiptDialog(list, change, opts) {
    list = Array.isArray(list) ? list : [list];
    const s = S().settings, inner = list.map((o) => Invoice.lines(o, s)).join('<div style="height:14px"></div>');
    const phone0 = (list.find((o) => o.phone) || {}).phone || '';
    const m = modal({
      title: list.length > 1 ? `Bills for Table ${list[0].table}` : `Bill ${list[0].id}`, body: `${change ? `<div class="banner info" style="margin-bottom:12px">${icon('cash')}<span>Return change of <b class="money">${D.money(change)}</b></span></div>` : ''}
        ${sendBox(phone0)}${inner}`,
      actions: [...(Printer.ready('bill') || UI.canPrint() ? [{ label: 'Print', icon: 'print', cls: 'ghost', close: false, onClick: () => printBillFor(list) }] : []),
        { label: 'Download', icon: 'download', cls: 'ghost', close: false, onClick: () => { UI.download(`${list[0].id}${list.length > 1 ? '-table' : ''}-bill.html`, list.length > 1 ? Invoice.html(list[0], s).replace(Invoice.lines(list[0], s), inner) : Invoice.html(list[0], s), 'text/html'); } },
        { label: 'Done', cls: '' }],
    });
    bindSend(m.el, list);
    if (opts && opts.sale && Printer.cfg.autoBill) printBillFor(list, { sale: true, auto: true });
    return m;
  }
  // digital bill: opens WhatsApp (to the guest's number) or the email app with the full GST bill as text
  const sendBox = (phone) => `<div class="sendbox"><b>Send a digital bill</b>
      <div class="row"><input class="in" inputmode="tel" maxlength="14" placeholder="Guest's WhatsApp number" value="${esc(phone)}" data-sph aria-label="WhatsApp number"><a class="btn wa sm" data-swa target="_blank" rel="noopener">${icon('send', 'sm')}WhatsApp</a></div>
      <div class="row"><input class="in" type="email" placeholder="Guest's email" data-sem aria-label="Email"><a class="btn quiet sm" data-smail target="_blank" rel="noopener">${icon('mail', 'sm')}Email</a></div></div>`;
  function bindSend(el, list) {
    const s = S().settings, multi = list.length > 1;
    const one = multi ? Object.assign({}, list[0], { items: list.flatMap((o) => o.items || []), sub: sumBy(list, (o) => o.sub), disc: sumBy(list, (o) => o.disc || 0), taxable: sumBy(list, (o) => o.taxable), cgst: sumBy(list, (o) => o.cgst), sgst: sumBy(list, (o) => o.sgst), round: sumBy(list, (o) => o.round || 0), total: sumBy(list, (o) => o.total), inv: list.map((o) => o.inv || o.id).join(', '), id: list.map((o) => o.id).join(', '), beans: 0, pay: Object.assign({}, list[0].pay, { method: list[0].pay.group ? 'split' : list[0].pay.method, parts: [].concat(...list.map((o) => D.payParts(o))).reduce((a, p) => { const f = a.find((x) => x.m === p.m); if (f) f.a += p.a; else a.push({ m: p.m, a: p.a }); return a; }, []) }) }) : list[0];
    const ph = $('[data-sph]', el), em = $('[data-sem]', el), wa = $('[data-swa]', el), ml = $('[data-smail]', el);
    if (!ph) return;
    const upd = () => {
      const okP = !!D.cleanPhone(ph.value), okE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim());
      wa.href = Invoice.waLink(one, s, ph.value); wa.classList.toggle('dim', !okP);
      ml.href = Invoice.mailLink(one, s, em.value.trim()); ml.classList.toggle('dim', !okE);
    };
    ph.oninput = upd; em.oninput = upd; upd();
    const note = (via) => list.forEach((o) => { D.api.patchOrder(o.id, { sent: (o.sent || []).concat({ via, at: Date.now() }) }).catch(() => {}); });
    wa.addEventListener('click', (e) => { if (!D.cleanPhone(ph.value)) { e.preventDefault(); toast('Enter a 10-digit WhatsApp number', 'warn'); ph.focus(); return; } note('whatsapp'); });
    ml.addEventListener('click', (e) => { if (ml.classList.contains('dim')) { e.preventDefault(); toast('Enter the guest’s email', 'warn'); em.focus(); return; } note('email'); });
  }

  /* day close: sales, GST and the cash drawer for one day; saved as a 'close' entry in the ledger */
  function dayClose() {
    const sod = D.startOfDay(), eod = sod + 864e5, s = S().settings;
    const inDay = (t) => t >= sod && t < eod;
    const made = S().orders.filter((o) => inDay(o.createdAt) && o.status !== 'cancelled' && !(o.pay && o.pay.status === 'refunded'));
    const paidToday = S().orders.filter((o) => o.pay && (o.pay.status === 'paid' || o.pay.status === 'refunded') && inDay(o.pay.at || o.createdAt));
    const by = { cash: 0, upi: 0, card: 0, online: 0 };
    for (const o of paidToday) for (const p of D.payParts(o)) if (by[p.m] != null) by[p.m] += p.a;
    const refunds = S().orders.filter((o) => o.pay && o.pay.status === 'refunded' && inDay(o.pay.refundAt || 0));
    const cashRefund = sumBy(refunds, (o) => D.payParts(o).filter((p) => p.m === 'cash').reduce((a, p) => a + p.a, 0));
    const unpaid = made.filter((o) => o.pay && o.pay.status !== 'paid');
    const cancelled = S().orders.filter((o) => inDay(o.createdAt) && o.status === 'cancelled');
    const last = S().ledger.filter((e) => e.type === 'close').sort((a, b) => b.at - a.at)[0];
    const ownMade = made.filter((o) => !D.isEco(o));
    const sum = { apps: sumBy(made.filter(D.isEco), (o) => o.total), bills: made.length, gross: sumBy(made, (o) => o.sub), disc: sumBy(made, (o) => o.disc || 0), taxable: sumBy(ownMade, (o) => o.taxable), cgst: sumBy(ownMade, (o) => o.cgst), sgst: sumBy(ownMade, (o) => o.sgst), round: sumBy(made, (o) => o.round || 0), total: sumBy(made, (o) => o.total) };
    const float0 = last && last.close && last.close.nextFloat != null ? last.close.nextFloat : 0;
    const row = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td>${v}</td></tr>`;
    const m = modal({
      title: `Close the day, ${D.dateShort(sod)}`, wide: true,
      body: `<div class="grid2" style="gap:18px;align-items:start" data-zgrid>
        <div><h3 class="zh">Sales</h3><table class="sumtbl"><tbody>
          ${row('Bills', D.NUM.format(sum.bills))}${row('Item total', D.money(sum.gross, true))}${sum.disc ? row('Discounts', '−' + D.money(sum.disc, true)) : ''}${row('Taxable value', D.money(sum.taxable, true))}
          ${row(`CGST`, D.money(sum.cgst, true), 'sub')}${row(`SGST`, D.money(sum.sgst, true), 'sub')}${sum.round ? row('Round off', D.money(sum.round, true), 'sub') : ''}${row('Total sales', D.money(sum.total, true), 'total')}</tbody></table>
          ${sum.apps ? `<p class="faint" style="font-size:13px;margin:-8px 0 12px">Includes ${D.money(sum.apps, true)} through ordering apps; their GST is paid by the app and left out of CGST and SGST here.</p>` : ''}<h3 class="zh">Payments taken today</h3><table class="sumtbl"><tbody>${['cash', 'upi', 'card', 'online'].map((k) => row(PM[k], D.money(by[k], true))).join('')}
          ${row('Not paid yet', `${D.money(sumBy(unpaid, (o) => o.total), true)} <span class="faint">(${unpaid.length})</span>`, 'sub')}${row('Cancelled', `${cancelled.length}`, 'sub')}${refunds.length ? row('Refunds', '−' + D.money(sumBy(refunds, (o) => o.total), true), 'sub') : ''}</tbody></table></div>
        <div><h3 class="zh">Cash drawer</h3>
          <label class="field"><span>Opening cash (float)</span><input class="in" inputmode="decimal" data-zf value="${(float0 / 100).toFixed(0)}"></label>
          <table class="sumtbl" style="margin-top:8px"><tbody>${row('Cash sales', '+' + D.money(by.cash, true), 'sub')}${cashRefund ? row('Cash refunds', '−' + D.money(cashRefund, true), 'sub') : ''}<tr class="total"><td>Expected in drawer</td><td data-zexp></td></tr></tbody></table>
          <label class="field" style="margin-top:12px"><span>Cash counted</span><input class="in" inputmode="decimal" data-zc placeholder="Count the drawer"></label>
          <div data-zdiff style="margin-top:8px;font-size:15px"></div>
          <label class="field" style="margin-top:12px"><span>Leave in the drawer for tomorrow</span><input class="in" inputmode="decimal" data-znext value="${(float0 / 100).toFixed(0)}"></label>
          <label class="field" style="margin-top:12px"><span>Note</span><input class="in" data-znote maxlength="120" placeholder="Who closed, anything unusual"></label>
          ${last ? `<p class="faint" style="font-size:13px;margin:10px 0 0">Last closed ${D.dateShort(last.at)}, ${D.time12(last.at)}${last.close && last.close.diff ? `, ${last.close.diff > 0 ? 'over' : 'short'} by ${D.money(Math.abs(last.close.diff), true)}` : ''}.</p>` : ''}</div></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Download report', cls: 'ghost', icon: 'download', close: false, onClick: (mm) => UI.download(`day-close-${D.dayKey(sod)}.html`, zHtml(read(mm)), 'text/html') },
        { label: 'Save and close the day', cls: 'saffron', onClick: async (mm) => {
          const z = read(mm); if (z.counted == null) { toast('Enter the cash counted', 'warn'); $('[data-zc]', mm.el).focus(); return false; }
          try { await D.api.addLedger({ id: D.rid('z_'), at: Date.now(), type: 'close', ing: '', qty: 0, note: z.note, close: Object.assign(z, { by: who() }) }); toast(z.diff ? `Day closed, cash ${z.diff > 0 ? 'over' : 'short'} by ${D.money(Math.abs(z.diff), true)}` : 'Day closed, cash matches'); } catch (e) { return false; }
        } }],
    });
    const style = document.createElement('style'); style.textContent = '@media (max-width:760px){[data-zgrid]{grid-template-columns:1fr!important}}'; m.el.appendChild(style);
    const num = (sel, el = m.el) => { const v = ($(sel, el).value || '').trim(); return v === '' ? null : Math.round((parseFloat(v) || 0) * 100); };
    function read(el) {
      const fl = num('[data-zf]', el.el || el) || 0, counted = num('[data-zc]', el.el || el), expected = fl + by.cash - cashRefund;
      return Object.assign({ day: D.dayKey(sod), float: fl, expected, counted, diff: counted == null ? 0 : counted - expected, nextFloat: num('[data-znext]', el.el || el) || 0, note: ($('[data-znote]', el.el || el).value || '').trim(), by, cashRefund, unpaid: sumBy(unpaid, (o) => o.total), unpaidCount: unpaid.length, cancelled: cancelled.length }, sum);
    }
    const upd = () => {
      const z = read(m.el); $('[data-zexp]', m.el).textContent = D.money(z.expected, true);
      $('[data-zdiff]', m.el).innerHTML = z.counted == null ? '' : z.diff === 0 ? `<span style="color:var(--leaf)">${icon('check', 'sm')} Cash matches</span>` : `<span style="color:var(--danger);font-weight:650">${z.diff > 0 ? 'Over' : 'Short'} by ${D.money(Math.abs(z.diff), true)}</span>`;
    };
    m.el.addEventListener('input', upd); upd();
    function zHtml(z) {
      const r = (l, v) => `<tr><td>${l}</td><td class="r">${v}</td></tr>`;
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Day close ${z.day}</title><style>body{font-family:ui-monospace,Menlo,monospace;font-size:13px;max-width:320px;margin:16px auto}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse}td{padding:2px 0}.r{text-align:right}hr{border:0;border-top:1px dashed #000}</style></head><body>
        <h1>${esc(s.name)}</h1><div>Day close ${esc(z.day)}<br>Printed ${new Date().toLocaleString('en-IN')}</div><hr>
        <table>${r('Bills', z.bills)}${r('Item total', (z.gross / 100).toFixed(2))}${r('Discounts', (z.disc / 100).toFixed(2))}${r('Taxable value', (z.taxable / 100).toFixed(2))}${r('CGST', (z.cgst / 100).toFixed(2))}${r('SGST', (z.sgst / 100).toFixed(2))}${r('Round off', (z.round / 100).toFixed(2))}${r('<b>Total sales</b>', '<b>' + (z.total / 100).toFixed(2) + '</b>')}</table><hr>
        <table>${r('Cash', (z.by.cash / 100).toFixed(2))}${r('UPI', (z.by.upi / 100).toFixed(2))}${r('Card', (z.by.card / 100).toFixed(2))}${r('Paid on apps', ((z.by.online || 0) / 100).toFixed(2))}${r('Not paid yet', (z.unpaid / 100).toFixed(2) + ' (' + z.unpaidCount + ')')}${r('Cancelled bills', z.cancelled)}</table><hr>
        <table>${r('Opening cash', (z.float / 100).toFixed(2))}${r('Cash sales', (z.by.cash / 100).toFixed(2))}${r('Cash refunds', (-z.cashRefund / 100).toFixed(2))}${r('<b>Expected</b>', '<b>' + (z.expected / 100).toFixed(2) + '</b>')}${r('Counted', z.counted == null ? '-' : (z.counted / 100).toFixed(2))}${r('Over / short', (z.diff / 100).toFixed(2))}${r('Float for tomorrow', (z.nextFloat / 100).toFixed(2))}</table>
        ${z.note ? `<hr><div>${esc(z.note)}</div>` : ''}<hr><div>GSTIN ${esc(s.gstin)}</div></body></html>`;
    }
  }

  /* ---------------- bills ---------------- */
  function billsFiltered() {
    const r = rangeOf(bf.range), ql = bf.q.trim().toLowerCase();
    return S().orders.filter((o) => inRange(o, r) && (bf.status === 'all' || (bf.status === 'unpaid' ? o.status !== 'cancelled' && o.pay && o.pay.status !== 'paid' && o.pay.status !== 'refunded' : bf.status === 'paid' ? o.pay && o.pay.status === 'paid' && o.status !== 'cancelled' : o.status === 'cancelled' || (o.pay && o.pay.status === 'refunded')))
      && (!ql || o.id.toLowerCase().includes(ql) || String(o.table || '').includes(ql) || (o.phone && ql.replace(/\D/g, '').length >= 4 && o.phone.includes(ql.replace(/\D/g, ''))) || (o.items || []).some((l) => l.name.toLowerCase().includes(ql))));
  }
  function payCell(o) {
    const p = o.pay || {};
    const m = p.method === 'split' ? D.payParts(o).map((x) => PM[x.m] || x.m).join(' + ') : PM[p.method] || '';
    if (o.status === 'cancelled') return `<span class="chip">${p.status === 'refunded' ? 'Refunded' : 'Cancelled'}</span>`;
    return p.status === 'paid' ? `<span class="chip ok">${m}</span>` : p.status === 'pending' ? '<span class="chip warn">UPI to confirm</span>' : p.status === 'refunded' ? '<span class="chip">Refunded</span>' : '<span class="chip bad">Unpaid</span>';
  }
  function stChip(o) { const m = { new: ['new', 'New'], preparing: ['info', 'Preparing'], ready: ['ok', 'Ready'], served: ['', 'Served'], cancelled: ['bad', 'Cancelled'] }[o.status] || ['', o.status]; return `<span class="chip ${m[0]}">${m[1]}</span>`; }
  function bills() {
    const list = billsFiltered(), tot = sumBy(list.filter(sales), (o) => o.total);
    return head('Bills', `${list.length} bill${list.length === 1 ? '' : 's'}, ${D.money(tot)} in sales for this view.`, `<button class="btn ghost sm" data-a="bcsv">${icon('download', 'sm')}Export CSV</button>`) +
      `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Order ID, table, dish or phone" value="${esc(bf.q)}" data-bq aria-label="Search bills"></label>
        <div class="pills">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All']].map(([k, l]) => `<button class="pill" data-br="${k}" aria-pressed="${bf.range === k}">${l}</button>`).join('')}</div>
        <div class="pills">${[['all', 'Any status'], ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['void', 'Cancelled']].map(([k, l]) => `<button class="pill" data-bs="${k}" aria-pressed="${bf.status === k}">${l}</button>`).join('')}</div></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Order</th><th>Time</th><th>Table</th><th>Items</th><th class="r">Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${list.slice(0, 300).map((o) => `<tr class="click" data-bill="${esc(o.id)}" tabindex="0"><td><b>${esc(o.id)}</b>${o.demo ? ' <span class="faint" style="font-size:12px">sample</span>' : ''}</td><td>${D.dateShort(o.createdAt)}, ${D.time12(o.createdAt)}</td><td>${o.table || 'Takeaway'}</td>
        <td>${esc((o.items || []).map((l) => `${l.qty}× ${l.name}`).join(', ')).slice(0, 80)}</td><td class="r money">${D.money(o.total)}</td><td>${payCell(o)}</td><td>${stChip(o)}</td></tr>`).join('') || `<tr><td colspan="7"><div class="empty" style="padding:24px">No bills in this view.</div></td></tr>`}
      </tbody></table></div>${list.length > 300 ? `<p class="faint">Showing the latest 300. Export CSV for all ${list.length}.</p>` : ''}`;
  }
  function billDialog(id) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    const p = o.pay || {}, canCollect = o.status !== 'cancelled' && p.status !== 'paid' && p.status !== 'refunded';
    const acts = [];
    if (canCollect && canDo('collect')) acts.push({ label: p.status === 'pending' ? 'Confirm UPI' : 'Collect payment', cls: 'saffron', onClick: () => { setTimeout(() => collect(o.id), 30); } });
    if (o.status !== 'cancelled' && canDo('cancel')) acts.push({ label: 'Cancel order', cls: 'danger ghost', onClick: () => { setTimeout(() => cancelOrder(o.id), 30); } });
    if (p.status === 'paid' && o.status !== 'cancelled' && canDo('collect')) acts.push({ label: canDo('refund') ? 'Refund' : 'Refund (owner)', cls: 'ghost', onClick: async () => { const ok = await confirmBox(`Refund ${D.money(o.total)} for ${o.id}? Return the money the same way it was paid.`, { title: 'Refund this bill?', ok: 'Mark refunded', danger: true }); if (ok) await guarded('refund', 'A refund', async (ap) => { await D.api.patchOrder(o.id, { pay: Object.assign({}, p, { status: 'refunded', refundAt: Date.now(), refundBy: who() }, ap ? { approvedBy: ap.name } : {}) }); toast(`${o.id} refunded`); }); } });
    acts.push({ label: 'Download', icon: 'download', cls: 'ghost', close: false, onClick: () => { UI.download(`${o.id}-bill.html`, Invoice.html(o, S().settings), 'text/html'); } });
    if (Printer.ready('bill') || UI.canPrint()) acts.push({ label: 'Print', icon: 'print', cls: 'ghost', close: false, onClick: () => printBillFor(o) });
    const m = modal({ title: `Bill ${o.id}`, body: `<div class="row wrap" style="margin-bottom:12px">${stChip(o)}${payCell(o)}<span class="chip">${o.source === 'portal' ? 'Customer portal' : 'Counter'}</span>${(o.log || []).map((l) => `<span class="faint" style="font-size:12.5px">${l.s} ${D.time12(l.at)}</span>`).join('')}${(o.sent || []).length ? `<span class="chip ok">Sent by ${esc([...new Set(o.sent.map((x) => (x.via === 'whatsapp' ? 'WhatsApp' : 'email')))].join(' and '))}</span>` : ''}</div>${sendBox(o.phone || '')}${Invoice.lines(o, S().settings)}`, actions: acts });
    bindSend(m.el, [o]);
  }
  function csv(rows) { return rows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'); }
  function exportBills() {
    const list = billsFiltered();
    const rows = [['Invoice', 'Order', 'Date', 'Time', 'Table', 'Type', 'Items', 'Sub total', 'Discount', 'Taxable', 'CGST', 'SGST', 'Round off', 'Total', 'Payment', 'Payment status', 'Order status', 'Source', 'App order ID', 'GST paid by app (9(5))']];
    for (const o of list) rows.push([o.inv, o.id, D.dayKey(o.createdAt), D.time12(o.createdAt), o.table || '', o.type, (o.items || []).map((l) => `${l.qty} x ${l.name}`).join('; '), (o.sub / 100).toFixed(2), ((o.disc || 0) / 100).toFixed(2), (o.taxable / 100).toFixed(2), (o.cgst / 100).toFixed(2), (o.sgst / 100).toFixed(2), ((o.round || 0) / 100).toFixed(2), (o.total / 100).toFixed(2), (o.pay || {}).method === 'split' ? D.payParts(o).map((x) => `${x.m} ${(x.a / 100).toFixed(2)}`).join(' + ') : (o.pay || {}).method || '', (o.pay || {}).status || '', o.status, o.source, o.extId || '', D.isEco(o) ? 'yes' : '']);
    UI.download(`bills-${bf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }

  /* ---------------- menu ---------------- */
  function menuPage() {
    const cats = ['All', ...new Set(S().menu.map((d) => d.category))];
    const ql = mf.q.trim().toLowerCase();
    const list = S().menu.filter((d) => (mf.cat === 'All' || d.category === mf.cat) && (!ql || d.name.toLowerCase().includes(ql)));
    return head('Menu', 'Dishes, prices, 3D models and recipes. Recipes drive stock and sold-out status automatically.', canDo('dishEdit') ? `<button class="btn" data-a="dnew">${icon('plus')}Add dish</button>` : '') + modeBanner() +
      `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Search menu" value="${esc(mf.q)}" data-mq aria-label="Search menu"></label>
        <div class="pills">${cats.map((c) => `<button class="pill" data-mc="${esc(c)}" aria-pressed="${mf.cat === c}">${esc(c)}</button>`).join('')}</div></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>Dish</th><th>Category</th><th class="r">Price</th><th class="r">Food cost</th><th class="r">Margin</th><th>Available now</th><th>On menu</th><th></th></tr></thead><tbody>
      ${list.map((d) => {
        const s = status(d), fc = D.foodCost(d, X().stockById), price = Math.round(d.price * 100), mg = price ? Math.round(((price - fc) / price) * 100) : 0;
        const av = s.ok ? `<span class="chip ok">${s.portions != null ? `${s.portions} left` : 'Yes'}</span>` : `<span class="chip ${s.reason === 'time' ? 'warn' : 'bad'}">${esc(s.short || s.label)}</span>`;
        return `<tr><td style="width:56px">${Viewer.img(d.model, '').replace('<img', '<img style="width:48px;height:48px;object-fit:contain"')}</td><td><div class="row" style="gap:7px">${vmark(d.veg)}<b>${esc(d.name)}</b></div>${d.from ? `<span class="faint" style="font-size:12.5px">${D.hm(d.from)} to ${D.hm(d.to)}</span>` : ''}</td>
          <td>${esc(d.category)}</td><td class="r money">${D.rupees(d.price)}</td><td class="r money">${D.money(fc, true)}</td><td class="r ${mg < 60 ? '' : ''}">${mg}%</td><td>${av}</td>
          <td><label class="switch"><input type="checkbox" ${d.active !== false ? 'checked' : ''} data-dact="${d.id}" ${canDo('dishToggle') ? '' : 'disabled'} aria-label="Show ${esc(d.name)} on the menu"></label></td>
          <td>${canDo('dishEdit') ? `<button class="btn xs ghost" data-dedit="${d.id}">${icon('edit', 'sm')}Edit</button>` : ''}</td></tr>`;
      }).join('') || `<tr><td colspan="9"><div class="empty" style="padding:24px">No dishes yet. Add your first dish.</div></td></tr>`}</tbody></table></div>`;
  }
  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'dish';
  function dishEditor(id) {
    const orig = id ? X().menuById[id] : null;
    const d = orig ? JSON.parse(JSON.stringify(orig)) : { id: '', name: '', category: S().menu[0] ? S().menu[0].category : 'Coffee', price: 150, veg: true, model: 'cappuccino', kcal: 0, prep: 5, from: '', to: '', desc: '', tags: [], active: true, recipe: [], sort: S().menu.length };
    const cats = [...new Set([...S().menu.map((x) => x.category), ...D.CATEGORIES])];
    const stock = S().stock.slice().sort((a, b) => a.name.localeCompare(b.name));
    let ctrl = null;
    const m = modal({
      title: orig ? `Edit ${orig.name}` : 'Add a dish', wide: true,
      body: `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:18px" class="editor-grid">
        <div style="display:grid;gap:10px;align-content:start"><div class="editor-stage"><div class="stage" data-stage="edit"></div></div>
          <div class="field"><span>3D model</span><div class="thumbpick" role="radiogroup" aria-label="3D model">${Dishes.LIST.map(([k, l]) => `<button type="button" data-model="${k}" aria-pressed="${d.model === k}" title="${esc(l)}" aria-label="${esc(l)}">${Viewer.img(k, l)}</button>`).join('')}</div></div></div>
        <form style="display:grid;gap:12px;align-content:start" novalidate data-form>
          <label class="field"><span>Name</span><input class="in" name="name" value="${esc(d.name)}" required maxlength="60"></label>
          <div class="grid2"><label class="field"><span>Category</span><input class="in" name="category" list="catlist" value="${esc(d.category)}"><datalist id="catlist">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
          <label class="field"><span>Price (₹, before GST)</span><input class="in" name="price" inputmode="decimal" value="${d.price}"></label></div>
          <div class="grid3"><label class="field"><span>Type</span><select class="in" name="veg"><option value="1" ${d.veg ? 'selected' : ''}>Vegetarian</option><option value="0" ${d.veg ? '' : 'selected'}>Non-vegetarian</option></select></label>
          <label class="field"><span>Calories</span><input class="in" name="kcal" inputmode="numeric" value="${d.kcal || ''}"></label>
          <label class="field"><span>Prep (min)</span><input class="in" name="prep" inputmode="numeric" value="${d.prep || ''}"></label></div>
          <label class="field"><span>Description</span><textarea class="in" name="desc" maxlength="160">${esc(d.desc)}</textarea></label>
          <div class="grid3"><label class="field"><span>Served from</span><input class="in" type="time" name="from" value="${esc(d.from)}"></label><label class="field"><span>Until</span><input class="in" type="time" name="to" value="${esc(d.to)}"></label>
          <label class="field"><span>Labels</span><input class="in" name="tags" value="${esc((d.tags || []).join(', '))}" placeholder="Bestseller, Spicy"></label></div>
          <small class="faint" style="margin-top:-6px">Leave the times empty to serve all day.</small>
          <label class="field"><span>Customisation</span><textarea class="in" name="options" rows="4" style="font-family:var(--f-mono);font-size:13px" placeholder="Size: Regular, Large +40 [milk 60]">${esc(D.optionsToText(D.optionGroups(d)))}</textarea>
            <small>One group per line. Prices are extra ₹; ingredients in brackets come off stock. Add * after the group name to allow several, for example <code>Add-ons*: Extra shot +45 [beans 9]</code>. The first choice of a one-choice group is the default. Leave empty for none.</small></label>
          <div class="field"><span>Recipe, per serving</span><div data-recipe style="display:grid;gap:8px"></div><button type="button" class="btn quiet sm" data-radd style="justify-self:start">${icon('plus', 'sm')}Add ingredient</button></div>
          <div class="banner info" data-cost style="margin:0"></div>
        </form></div>`,
      actions: [...(orig ? [{ label: 'Delete', cls: 'danger ghost', onClick: async () => { if (await confirmBox(`Delete ${orig.name}? Past bills keep their copy.`, { title: 'Delete this dish?', ok: 'Delete', danger: true })) { await D.api.delDish(orig.id); toast(`${orig.name} deleted`); } } }] : []),
        { label: 'Cancel' }, { label: 'Save dish', cls: '', onClick: () => save() }],
      onClose: () => Viewer.unmount($('[data-stage=edit]', m.el)),
    });
    const style = document.createElement('style'); style.textContent = '@media (max-width:760px){.editor-grid{grid-template-columns:1fr!important}}'; m.el.appendChild(style);
    const recipeEl = $('[data-recipe]', m.el);
    const drawRecipe = () => {
      recipeEl.innerHTML = d.recipe.map((r, i) => { const s = X().stockById[r.ing]; return `<div class="recipe-row"><select class="in" data-ring="${i}">${stock.map((x) => `<option value="${x.id}" ${x.id === r.ing ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <div class="row" style="gap:6px"><input class="in" inputmode="decimal" value="${r.qty}" data-rqty="${i}" aria-label="Quantity"><span class="faint" style="font-size:13px;min-width:28px">${esc(s ? s.unit : '')}</span></div><button type="button" class="btn icon sm ghost" data-rdel="${i}" aria-label="Remove">${icon('trash', 'sm')}</button></div>`; }).join('') || '<span class="faint" style="font-size:13px">No ingredients yet. Without a recipe the dish never sells out.</span>';
      drawCost();
    };
    const drawCost = () => {
      const price = Math.round((parseFloat($('[name=price]', m.el).value) || 0) * 100), fc = D.foodCost(d, X().stockById);
      $('[data-cost]', m.el).innerHTML = `${icon('chart')}<span>Food cost <b class="money">${D.money(fc, true)}</b> per serving${price ? `, margin <b>${Math.round(((price - fc) / price) * 100)}%</b>` : ''}. Most cafés aim to keep food cost under 30% of the price.</span>`;
    };
    drawRecipe();
    m.el.addEventListener('input', (e) => { const t = e.target; if (t.dataset.rqty != null) { d.recipe[+t.dataset.rqty].qty = parseFloat(t.value) || 0; drawCost(); } if (t.name === 'price') drawCost(); });
    m.el.addEventListener('change', (e) => { const t = e.target; if (t.dataset.ring != null) { d.recipe[+t.dataset.ring].ing = t.value; drawRecipe(); } });
    m.el.addEventListener('click', (e) => {
      const mo = e.target.closest('[data-model]'); if (mo) { d.model = mo.dataset.model; $$('[data-model]', m.el).forEach((b) => b.setAttribute('aria-pressed', b === mo)); if (ctrl) ctrl.show(d.model, 1); }
      if (e.target.closest('[data-radd]')) { const used = new Set(d.recipe.map((r) => r.ing)); const first = stock.find((s) => !used.has(s.id)); if (first) { d.recipe.push({ ing: first.id, qty: 1 }); drawRecipe(); } }
      const rd = e.target.closest('[data-rdel]'); if (rd) { d.recipe.splice(+rd.dataset.rdel, 1); drawRecipe(); }
    });
    setTimeout(() => { ctrl = Viewer.mount($('[data-stage=edit]', m.el), Viewer.studio({ key: d.model, fit: 0.85, el: 0.55 })); }, 40);
    async function save() {
      const f = $('[data-form]', m.el), val = (n) => f.elements[n].value.trim();
      const name = val('name'), price = parseFloat(val('price'));
      if (!name) { toast('Give the dish a name', 'warn'); f.elements.name.focus(); return false; }
      if (!(price > 0)) { toast('Enter a price above zero', 'warn'); f.elements.price.focus(); return false; }
      if ((val('from') && !val('to')) || (!val('from') && val('to'))) { toast('Set both serving times, or leave both empty', 'warn'); return false; }
      Object.assign(d, { name, category: val('category') || 'Other', price: Math.round(price * 100) / 100, veg: val('veg') === '1', kcal: parseInt(val('kcal'), 10) || 0, prep: parseInt(val('prep'), 10) || 0, desc: val('desc'), from: val('from'), to: val('to'), tags: val('tags') ? val('tags').split(',').map((t) => t.trim()).filter(Boolean) : [] });
      d.recipe = d.recipe.filter((r) => r.qty > 0);
      const optText = val('options'), parsed = D.optionsFromText(optText);
      if (optText && !parsed.length) { toast('Check the customisation lines, for example Size: Regular, Large +40', 'warn'); return false; }
      if (D.optionsToText(parsed) !== D.optionsToText(D.CATEGORY_OPTIONS[d.category] || []) || Array.isArray(d.options)) d.options = parsed;
      if (!d.id) { let base = slug(name), idn = base, k = 2; while (X().menuById[idn]) idn = base + '-' + k++; d.id = idn; }
      try { await D.api.putDish(d); toast(`${name} saved`); } catch (e) { return false; }
    }
  }

  /* ---------------- printers (this device) ---------------- */
  let printerPreview = 'bill';
  const PTYPES = [['none', 'No printer'], ['usb', 'USB'], ['bluetooth', 'Bluetooth'], ['serial', 'Serial or USB-serial'], ['network', 'Network (LAN or Wi-Fi)'], ['browser', 'Browser print dialog']];
  function printersPage() {
    const c = Printer.cfg, sup = Printer.support();
    const slotBox = (slot) => {
      const p = c[slot], kot = slot === 'kot', types = kot ? [['same', 'Same as the bill printer'], ...PTYPES] : PTYPES;
      const needsConnect = ['usb', 'bluetooth', 'serial'].includes(p.type), unsupported = needsConnect && !sup[p.type];
      const status = p.type === 'none' ? 'Off' : p.type === 'same' ? 'Uses the bill printer' : p.type === 'browser' ? 'Prints through the browser dialog' : p.type === 'network' ? (p.host ? `Sends to ${esc(p.host)}:${esc(p.port)} through the print bridge` : 'Enter the printer’s IP address') : unsupported ? 'This browser can’t reach this kind of printer. Use Chrome or Edge on a computer or Android.' : Printer.isConnected(slot) ? `Connected: ${esc(p.label)}` : p.label ? `${esc(p.label)}, reconnects when you print` : 'Not connected yet';
      return `<div class="box"><h2>${icon(kot ? 'bell' : 'receipt')}${kot ? 'Kitchen printer (KOT)' : 'Bill printer'}</h2>
        <div class="grid2"><label class="field"><span>Connection</span><select class="in" data-prn="${slot}.type">${types.map(([k, l]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${p.type !== 'same' ? `<label class="field"><span>Paper</span><select class="in" data-prn="${slot}.width"><option value="48" ${+p.width === 48 ? 'selected' : ''}>80 mm (48 characters)</option><option value="32" ${+p.width === 32 ? 'selected' : ''}>58 mm (32 characters)</option></select></label>` : '<span></span>'}</div>
        ${p.type === 'network' ? `<div class="grid3"><label class="field"><span>Printer IP</span><input class="in" data-prn="${slot}.host" value="${esc(p.host)}" placeholder="192.168.1.50"></label><label class="field"><span>Port</span><input class="in" data-prn="${slot}.port" value="${esc(p.port)}" inputmode="numeric"></label><label class="field"><span>Print bridge</span><input class="in" data-prn="${slot}.bridge" value="${esc(p.bridge)}"></label></div>
          <small class="faint">Browsers can’t open a printer’s network port directly. Run <code>node tools/print-bridge.mjs</code> on a computer in the café and leave it running; it passes jobs to the printer.</small>` : ''}
        ${p.type === 'serial' ? `<label class="field"><span>Baud rate</span><select class="in" data-prn="${slot}.baud">${[9600, 19200, 38400, 115200].map((b) => `<option ${+p.baud === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>` : ''}
        ${!kot && p.type !== 'none' ? `<div class="ctl"><label><span class="t">Open the cash drawer on cash sales<small>For a drawer plugged into the printer (RJ11).</small></span><span class="switch"><input type="checkbox" data-prn="bill.drawer" ${p.drawer ? 'checked' : ''}></span></label>
          <label><span class="t">QR code on bills<small>A UPI pay code on unpaid bills, the order ID on paid ones. Skipped by printers without QR support.</small></span><span class="switch"><input type="checkbox" data-prn="bill.qr" ${p.qr ? 'checked' : ''}></span></label></div>` : ''}
        ${p.type !== 'none' && p.type !== 'same' ? `<label class="field" style="max-width:160px"><span>Copies</span><select class="in" data-prn="${slot}.copies">${[1, 2, 3].map((n) => `<option ${+p.copies === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
        <div class="row wrap"><span class="prstatus ${Printer.isConnected(slot) ? 'on' : ''}">${status}</span><span class="grow"></span>
          ${needsConnect && !unsupported ? `<button class="btn sm ghost" data-a="prconnect" data-slot="${slot}">${icon('refresh', 'sm')}${p.label ? 'Change printer' : 'Connect'}</button>` : ''}
          ${p.type !== 'none' && p.type !== 'same' && !unsupported ? `<button class="btn sm" data-a="prtest" data-slot="${slot}">${icon('print', 'sm')}Test print</button>` : ''}</div></div>`;
    };
    const sample = S().orders.find((o) => o.status !== 'cancelled') || Object.assign({ id: (S().settings.prefix || 'KM') + '-1001', inv: `${S().settings.prefix || 'KM'}/${D.fy()}/1001`, createdAt: Date.now(), table: 3, type: 'dine-in', rate: S().settings.gstRate, items: [{ name: 'Cappuccino', price: 220, qty: 2, opts: ['Large'] }, { name: 'Butter Croissant', price: 140, qty: 1 }], pay: { method: 'cash', status: 'paid', change: 2000 } }, D.bill([{ price: 220, qty: 2 }, { price: 140, qty: 1 }], { rate: S().settings.gstRate }));
    const w = +(c[printerPreview === 'kot' ? Printer.kotSlot() : 'bill'].width || 48);
    const text = Printer.preview(printerPreview === 'kot' ? Printer.kot(sample, w) : Printer.bill(sample, S().settings, w, { qr: c.bill.qr }));
    return head('Printers', 'Thermal printers on this device for kitchen tickets (KOT) and bills. Each device keeps its own printers.') +
      `<div class="setup">${slotBox('bill')}${slotBox('kot')}
        <div class="box"><h2>${icon('spark')}Automatic printing on this device</h2><div class="ctl">
          <label><span class="t">Print a KOT for every new order<small>Orders from the customer app, the counter and Zomato or Swiggy. Turn this on for one device only, usually the kitchen or counter tablet; each order is marked once its KOT prints, so another device won’t print it again.</small></span><span class="switch"><input type="checkbox" data-prn="autoKot" ${c.autoKot ? 'checked' : ''}></span></label>
          <label><span class="t">Print the bill after every payment<small>On the counter device, after billing, collecting or settling a table.</small></span><span class="switch"><input type="checkbox" data-prn="autoBill" ${c.autoBill ? 'checked' : ''}></span></label></div>
          <label class="field"><span>Name of this device</span><input class="in" data-prn="device" value="${esc(c.device)}" placeholder="Kitchen tablet" maxlength="30"></label>
          ${c.autoKot && Printer.cfg[Printer.kotSlot()].type === 'browser' ? `<div class="banner">${icon('alert')}<span>Automatic KOTs need a USB, Bluetooth, serial or network printer. The browser dialog needs a tap for each print.</span></div>` : ''}</div>
        <div class="box"><h2>${icon('receipt')}What prints <span class="faint">${w} characters a line</span></h2><div class="seg" style="margin-bottom:10px"><button data-a="prsample" data-which="bill" aria-pressed="${printerPreview === 'bill'}">Bill</button><button data-a="prsample" data-which="kot" aria-pressed="${printerPreview === 'kot'}">KOT</button></div>
          <pre class="thermal" style="width:${w + 2}ch">${esc(text)}</pre></div>
        <div class="box"><h2>${icon('info')}Which printers work</h2><ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px">
          <li>Any ESC/POS thermal printer, 58 mm or 80 mm (Epson TM, TVS RP, Everycom, Rugtek, Xprinter and most others).</li>
          <li><b>USB</b>: Chrome or Edge on Android, Mac, Linux or ChromeOS. On Windows the printer driver usually holds the printer: use Network, or the browser print dialog.</li>
          <li><b>Bluetooth</b>: Chrome on Android, Mac or Windows with Bluetooth LE printers. Not on iPhone or iPad.</li>
          <li><b>Network</b>: any device in the café, through the small print bridge (<code>tools/print-bridge.mjs</code>).</li>
          <li>The page must be on HTTPS or localhost. Inside the Claude preview, devices are blocked: use your own hosting.</li>
          <li>${sup.usb ? '✓' : '✗'} USB, ${sup.bluetooth ? '✓' : '✗'} Bluetooth, ${sup.serial ? '✓' : '✗'} serial available in this browser.</li></ul></div>
      </div>`;
  }

  /* ---------------- team: people, roles and PINs (owner only) ---------------- */
  const PERM_ROWS = [['Take orders, kitchen board, pickup screen', ['owner', 'cashier', 'staff']], ['Mark dishes sold out, record wastage', ['owner', 'cashier', 'staff']],
    ['Billing, collect payments, cancel unpaid orders', ['owner', 'cashier']], ['Close the day (cash drawer)', ['owner', 'cashier']],
    ['Discounts above the cashier limit', ['owner']], ['Refunds and cancelling paid bills', ['owner']], ['Edit dishes, prices and recipes', ['owner']],
    ['Purchases, stock counts, ingredients', ['owner']], ['Reports and GST', ['owner']], ['Customer app, team and setup', ['owner']]];
  function teamPage() {
    const t = D.team(S().settings), s = S().settings, legacy = t.length === 1 && t[0].legacy;
    const today = D.startOfDay(), mine = (m) => S().orders.filter((o) => o.createdAt >= today && o.by === m.name).length;
    return head('Team', 'Everyone signs in with their own 4-digit PIN. What they can see and do depends on their role.', `<button class="btn" data-a="tadd">${icon('plus')}Add person</button>`) +
      (!legacy && t.some((m) => m.active !== false && m.pinHash === D.pinHash('1234', s.pinSalt)) ? `<div class="banner">${icon('alert')}<span>${esc(t.find((m) => m.pinHash === D.pinHash('1234', s.pinSalt)).name)} still uses the starting PIN 1234, which anyone could guess. Change it or remove that person.</span></div>` : '') +
      (legacy ? `<div class="banner">${icon('alert')}<span>Only the starting owner exists, with PIN ${String(s.pin || '1234') === '1234' ? '1234' : 'from Setup'}. Add yourself and your staff, then remove or change the starting owner.</span></div>` : '') +
      (supa() ? `<div class="banner info">${icon('info')}<span>With Supabase, staff sign in with their email accounts and the role comes from the staff table. These PINs are used for owner approvals.</span></div>` : '') +
      `<div class="dash"><div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="r">Bills today</th><th></th></tr></thead><tbody>
        ${t.map((m) => `<tr><td><b>${esc(m.name)}</b>${m.id === (me() || {}).id ? ' <span class="chip info">You</span>' : ''}</td><td>${esc(D.ROLES[m.role] ? D.ROLES[m.role].label : m.role)}</td><td>${m.active === false ? '<span class="chip">Off</span>' : '<span class="chip ok">Active</span>'}</td><td class="r num">${mine(m)}</td>
          <td class="r"><button class="btn xs ghost" data-tedit="${esc(m.id)}">${icon('edit', 'sm')}Edit</button></td></tr>`).join('')}</tbody></table></div>
        <div class="col"><div class="box"><h2>Cashier discount limit</h2><label class="field"><span>Cashiers can give up to this % off without an owner’s PIN</span><input class="in" inputmode="numeric" data-tlim value="${esc(s.cashierMaxDisc ?? 10)}" style="max-width:120px"></label></div>
        <div class="box"><h2>What each role can do</h2><table class="tbl perm"><thead><tr><th></th><th>Owner</th><th>Cashier</th><th>Staff</th></tr></thead><tbody>
          ${PERM_ROWS.map(([l, r]) => `<tr><td>${l}</td>${['owner', 'cashier', 'staff'].map((k) => `<td>${r.includes(k) ? icon('check', 'sm') : '<span class="faint">–</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table>
          <small class="faint">Anything a role can’t do can still be done once if an owner enters their PIN; the bill records who approved it.</small></div></div></div>`;
  }
  function memberEditor(id) {
    if (!canDo('settings')) return;
    const s = S().settings, t = D.team(s), orig = id ? t.find((m) => m.id === id) : null;
    const m = modal({ title: orig ? `Edit ${orig.name}` : 'Add a person', body: `<form style="display:grid;gap:12px" data-tform novalidate>
        <label class="field"><span>Name</span><input class="in" name="name" maxlength="30" value="${esc(orig ? orig.name : '')}" autofocus></label>
        <label class="field"><span>Role</span><select class="in" name="role">${Object.entries(D.ROLES).map(([k, r]) => `<option value="${k}" ${(orig ? orig.role : 'cashier') === k ? 'selected' : ''}>${r.label}</option>`).join('')}</select></label>
        <div class="grid2"><label class="field"><span>${orig ? 'New PIN (leave empty to keep)' : 'PIN, 4 digits'}</span><input class="in" name="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label>
        <label class="field"><span>Type the PIN again</span><input class="in" name="pin2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></label></div>
        ${orig ? `<label class="row" style="justify-content:space-between"><span>Can sign in</span><span class="switch"><input type="checkbox" name="active" ${orig.active !== false ? 'checked' : ''}></span></label>` : ''}</form>`,
      actions: [...(orig ? [{ label: 'Remove', cls: 'danger ghost', onClick: async () => { if (await confirmBox(`Remove ${orig.name}? Their past bills keep their name.`, { title: 'Remove this person?', ok: 'Remove', danger: true })) return saveTeam(t.filter((x) => x.id !== orig.id), `${orig.name} removed`); } }] : []),
        { label: 'Cancel' }, { label: orig ? 'Save' : 'Add person', cls: 'saffron', onClick: (mm) => {
          const f = $('[data-tform]', mm.el).elements, name = f.name.value.trim(), role = f.role.value, pin = f.pin.value.trim(), pin2 = f.pin2.value.trim();
          if (!name) { toast('Enter a name', 'warn'); return false; }
          if ((pin || !orig) && !/^\d{4}$/.test(pin)) { toast('The PIN needs 4 digits', 'warn'); return false; }
          if (pin !== pin2) { toast('The two PINs don’t match', 'warn'); return false; }
          const h = pin ? D.pinHash(pin, s.pinSalt) : orig.pinHash;
          if (pin && t.some((x) => x.id !== (orig && orig.id) && x.pinHash === h)) { toast('Someone else already uses that PIN. Choose another.', 'warn'); return false; }
          const rec = Object.assign({}, orig || { id: D.rid('u_') }, { name, role, pinHash: h, active: orig ? f.active.checked : true }); delete rec.legacy;
          const next = orig ? t.map((x) => (x.id === orig.id ? rec : x)) : t.map((x) => Object.assign({}, x)).concat(rec);
          next.forEach((x) => delete x.legacy);
          saveTeam(next, orig ? `${name} saved` : `${name} added as ${D.ROLES[role].label.toLowerCase()}`);
        } }] });
    return m;
  }
  async function saveTeam(list, msg) {
    if (!list.some((x) => x.role === 'owner' && x.active !== false)) { toast('Keep at least one active owner', 'warn'); return false; }
    try { await D.api.setSettings({ staff: list, pin: null }); toast(msg); if (meId && !list.some((x) => x.id === meId && x.active !== false)) { meId = null; try { sessionStorage.removeItem('km.staff'); } catch (e) { /* ignore */ } } render(); } catch (e) { return false; }
  }

  /* ---------------- customer app controls: every switch saves at once and reaches guests' phones live ---------------- */
  const SWITCHES = [
    ['Ordering', [['orderingOpen', 'Take orders in the app', 'Off: guests can still browse the menu but can’t place orders. Use it when the kitchen is full or closing.'],
      ['dineIn', 'Dine-in orders', 'Guests at a table order from their phone.'], ['takeaway', 'Takeaway orders', 'Guests order to pick up at the counter.'],
      ['pickupAhead', 'Order ahead for a pickup time', 'Takeaway guests choose 15 to 60 minutes ahead.']]],
    ['Payments in the app', [['payUpi', 'UPI', 'QR and “Open UPI app”; staff confirm the payment.'], ['payCard', 'Card', 'Test mode until Razorpay is connected.'], ['payCounter', 'Pay at the counter', 'Cash, UPI or card at the counter. If every option is off, this one stays on.']]],
    ['Menu experience', [['customise', 'Customisation', 'Size, milk, add-ons and spice with their prices.'], ['pairings', '“Goes well with” suggestions', 'Three dishes from other categories on each dish.'], ['arView', 'Table view (3D camera)', 'The camera button and “See it on my table”.']]],
  ];
  function appControls() {
    const s = S().settings, on = (k) => s[k] !== false;
    const members = new Set(S().orders.filter((o) => o.phone).map((o) => o.phone)).size;
    const redeemed = S().orders.filter((o) => o.beans && o.status !== 'cancelled');
    return head('Customer app', 'What guests see and can do on their phones. Changes apply straight away, no app update needed.', `<a class="btn ghost" href="${custHref('#menu')}"${custAttrs}>${icon('ext')}Open the customer app</a>`) +
      `<div class="setup">
        ${SWITCHES.map(([title, list]) => `<div class="box"><h2>${title}</h2><div class="ctl">${list.map(([k, t, sub]) => `<label><span class="t">${t}<small>${sub}</small></span><span class="switch"><input type="checkbox" data-ctl="${k}" ${on(k) ? 'checked' : ''}></span></label>`).join('')}</div></div>`).join('')}
        <div class="box"><h2>${icon('star')}Rewards</h2><div class="ctl"><label><span class="t">Café rewards (beans)<small>Guests add a phone number and earn on paid bills, in the app and at the counter. Turning it off hides rewards everywhere; balances are kept.</small></span><span class="switch"><input type="checkbox" data-ctl="loyalty" ${on('loyalty') ? 'checked' : ''}></span></label></div>
          <div class="grid3" ${on('loyalty') ? '' : 'style="opacity:.5"'}><label class="field"><span>₹ spent per bean</span><input class="in" inputmode="numeric" data-num="beanPer" value="${esc(s.beanPer || 10)}"></label>
          <label class="field"><span>Beans to redeem</span><input class="in" inputmode="numeric" data-num="redeemBeans" value="${esc(s.redeemBeans || 100)}"></label>
          <label class="field"><span>₹ off when redeemed</span><input class="in" inputmode="numeric" data-num="redeemValue" value="${esc(s.redeemValue || 50)}"></label></div>
          <small class="faint">Now: 1 bean per ₹${s.beanPer || 10}, ${s.redeemBeans || 100} beans give ₹${s.redeemValue || 50} off (about ${(((s.redeemValue || 50) / ((s.redeemBeans || 100) * (s.beanPer || 10))) * 100).toFixed(1)}% back). ${members} member${members === 1 ? '' : 's'} so far, ${redeemed.length} redemption${redeemed.length === 1 ? '' : 's'}.</small></div>
        <div class="box"><h2>${icon('info')}Message on the menu</h2><label class="field"><span>Shown at the top of the customer app</span><textarea class="in" data-notice maxlength="140" placeholder="Today only: 20% off cold coffee after 4 pm">${esc(s.notice || '')}</textarea></label>
          <div class="row"><button class="btn sm" data-a="noticesave">Show message</button>${s.notice ? '<button class="btn ghost sm" data-a="noticeclear">Remove</button>' : ''}</div></div>
      </div>`;
  }
  async function setCtl(k, val) {
    const patch = { [k]: val };
    if (['payUpi', 'payCard', 'payCounter'].includes(k) && !val) { const s = Object.assign({}, S().settings, patch); if (s.payUpi === false && s.payCard === false && s.payCounter === false) { patch.payCounter = true; toast('Pay at the counter stays on so guests can still order', 'warn'); } }
    if (['dineIn', 'takeaway'].includes(k) && !val) { const s = Object.assign({}, S().settings, patch); if (s.dineIn === false && s.takeaway === false) { patch.orderingOpen = false; toast('Both order types are off, so app ordering is paused', 'warn'); } }
    try { await D.api.setSettings(patch); toast('Saved. Guests see it now.', 'ok', 1500); } catch (e) { /* handled */ }
  }

  /* ---------------- pickup screen (order status board for a TV at the counter) ---------------- */
  const boardSeen = new Set(); let boardPrimed = false, boardClock = 0;
  function board() {
    const s = S().settings, today = D.startOfDay();
    const live = S().orders.filter((o) => o.createdAt >= today && ['new', 'preparing', 'ready'].includes(o.status)).sort((a, b) => a.createdAt - b.createdAt);
    const prep = live.filter((o) => o.status !== 'ready'), ready = live.filter((o) => o.status === 'ready');
    const fresh = [];
    for (const o of ready) { if (!boardSeen.has(o.id)) { if (boardPrimed) fresh.push(o.id); boardSeen.add(o.id); } }
    if (fresh.length && soundOn) UI.chime();
    boardPrimed = true;
    const num = (o, flash) => `<div class="tv-n${flash ? ' flash' : ''}">${esc(String(o.no || o.id))}<small>${o.table ? 'Table ' + o.table : o.channel ? esc(D.CHANNELS[o.channel].label) : o.pickupAt ? 'Pickup ' + D.time12(o.pickupAt) : 'Takeaway'}</small></div>`;
    clearInterval(boardClock);
    boardClock = setInterval(() => { const c = $('.tv-h .clock', root); if (c) c.textContent = D.time12(Date.now()); else clearInterval(boardClock); }, 15000);
    return `<div class="tvboard" role="region" aria-label="Order status">
      <div class="tv-h"><span class="plate">${esc(s.name)}</span><span class="clock">${D.time12(Date.now())}</span></div>
      <div class="tv-cols"><section class="tv-col"><h2>${icon('clock', 'lg')}Preparing</h2><div class="tv-nums">${prep.map((o) => num(o)).join('') || '<p style="color:#CDB9A5;font-size:20px">No orders in the kitchen.</p>'}</div></section>
        <section class="tv-col ready" aria-live="polite"><h2>${icon('check', 'lg')}Ready to collect</h2><div class="tv-nums">${ready.map((o) => num(o, fresh.includes(o.id))).join('') || '<p style="color:#CDB9A5;font-size:20px">Ready orders show here.</p>'}</div></section></div>
      <div class="tv-f"><span>Your order number is on your bill and in the app, for example ${esc(s.prefix || 'KM')}-${ready[0] ? ready[0].no : prep[0] ? prep[0].no : 1001} shows as ${ready[0] ? ready[0].no : prep[0] ? prep[0].no : 1001}.</span>
        <button class="btn quiet sm" data-a="sound" style="background:rgba(255,255,255,.08);color:#fff">${icon(soundOn ? 'sound' : 'mute', 'sm')}${soundOn ? 'Chime on' : 'Chime off'}</button>
        <a class="btn quiet sm" href="${href('overview')}" style="background:rgba(255,255,255,.08);color:#fff">Back to dashboard</a></div></div>`;
  }

  /* ---------------- stock ---------------- */
  function stockPage() {
    const sm = X().stockMap, items = Object.values(sm).sort((a, b) => ({ out: 0, low: 1, ok: 2 }[a.state] - { out: 0, low: 1, ok: 2 }[b.state]) || a.name.localeCompare(b.name));
    const value = sumBy(items, (s) => Math.max(0, s.qty) * (Number(s.cost) || 0) * 100);
    const low = items.filter((s) => s.state === 'low').length, out = items.filter((s) => s.state === 'out').length;
    const usedIn = {}; for (const d of S().menu) for (const r of d.recipe || []) (usedIn[r.ing] = usedIn[r.ing] || []).push(d.name);
    const ql = sf.q.trim().toLowerCase();
    const tabs = `<div class="seg" role="tablist">${[['items', 'Ingredients'], ['buy', `Purchase list${low + out ? ` (${low + out})` : ''}`], ['moves', 'Movements']].map(([k, l]) => `<button role="tab" data-st="${k}" aria-pressed="${sf.tab === k}" aria-selected="${sf.tab === k}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (sf.tab === 'items') {
      body = `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Search ingredients" value="${esc(sf.q)}" data-sq aria-label="Search ingredients"></label></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Ingredient</th><th>In stock</th><th class="r">Reorder at</th><th>Status</th><th class="r">Value</th><th>Used in</th><th></th></tr></thead><tbody>
      ${items.filter((s) => !ql || s.name.toLowerCase().includes(ql)).map((s) => {
        const pct = Math.max(0, Math.min(100, (s.qty / Math.max(1, s.reorder * 2.5)) * 100));
        return `<tr><td><b>${esc(s.name)}</b><br><span class="faint" style="font-size:12.5px">${esc(s.supplier || '')}${s.cost ? `${s.supplier ? ', ' : ''}${D.money(Math.round(s.cost * 100 * (s.unit === 'g' || s.unit === 'ml' ? 1000 : 1)), true)} per ${s.unit === 'g' ? 'kg' : s.unit === 'ml' ? 'L' : s.unit}` : ''}</span></td>
          <td><span class="num">${fmtQty(Math.max(0, s.qty), s.unit)}</span><div class="stockbar ${s.state}"><i style="width:${pct}%"></i></div></td><td class="r num">${fmtQty(s.reorder, s.unit)}</td>
          <td>${s.state === 'out' ? '<span class="chip bad">Out</span>' : s.state === 'low' ? '<span class="chip warn">Low</span>' : '<span class="chip ok">OK</span>'}</td>
          <td class="r money">${D.money(Math.round(Math.max(0, s.qty) * (Number(s.cost) || 0) * 100))}</td><td style="max-width:220px;font-size:13px" class="muted">${esc((usedIn[s.id] || []).join(', ') || 'Not in any recipe')}</td>
          <td><div class="row" style="gap:6px;justify-content:flex-end">${canDo('stockBuy') ? `<button class="btn xs" data-sbuy="${s.id}">${icon('plus', 'sm')}Purchase</button>` : ''}${canDo('stockWaste') ? `<button class="btn xs ghost" data-swaste="${s.id}">Wastage</button>` : ''}${canDo('stockCount') ? `<button class="btn xs ghost" data-scount="${s.id}">Count</button>` : ''}${canDo('stockEdit') ? `<button class="btn xs ghost icon" data-sedit="${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit', 'sm')}</button>` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>`;
    } else if (sf.tab === 'buy') {
      const list = items.filter((s) => s.state !== 'ok').map((s) => { const sug = Math.max(s.reorder * 2 - Math.max(0, s.qty), s.reorder); const r = s.unit === 'g' || s.unit === 'ml' ? Math.ceil(sug / 500) * 500 : Math.ceil(sug); return Object.assign({}, s, { sug: r, est: Math.round(r * (Number(s.cost) || 0) * 100) }); });
      body = list.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Ingredient</th><th>Supplier</th><th>In stock</th><th class="r">Suggested order</th><th class="r">Estimated cost</th><th></th></tr></thead><tbody>
        ${list.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.supplier || '')}</td><td>${fmtQty(Math.max(0, s.qty), s.unit)}</td><td class="r num">${fmtQty(s.sug, s.unit)}</td><td class="r money">${D.money(s.est)}</td><td><button class="btn xs" data-sbuy="${s.id}" data-sugg="${s.sug}">Received</button></td></tr>`).join('')}
        <tr><td colspan="4"><b>Total</b></td><td class="r money"><b>${D.money(sumBy(list, (s) => s.est))}</b></td><td></td></tr></tbody></table></div>
        <div class="row" style="margin-top:12px"><button class="btn ghost sm" data-a="buycopy">${icon('copy', 'sm')}Copy list</button><button class="btn ghost sm" data-a="buycsv">${icon('download', 'sm')}Download CSV</button></div>`
        : `<div class="box"><div class="empty">${icon('check')}<h2>Nothing to reorder</h2><p>Every ingredient is above its reorder level.</p></div></div>`;
    } else {
      const sod = D.startOfDay(), used = {};
      for (const o of S().orders) if (o.createdAt >= sod && o.status !== 'cancelled') for (const k in o.use || {}) used[k] = (used[k] || 0) + o.use[k];
      const usedRows = Object.entries(used).map(([k, v]) => ({ s: X().stockById[k], v })).filter((r) => r.s).sort((a, b) => b.v * (b.s.cost || 0) - a.v * (a.s.cost || 0));
      body = `<div class="dash"><div class="box"><h2>Stock movements <span class="faint">Purchases, wastage and counts</span></h2>${S().ledger.some((e) => e.type !== 'close') ? `<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th class="r">Change</th><th>Note</th></tr></thead><tbody>
        ${S().ledger.filter((e) => e.type !== 'close').slice(0, 80).map((e) => { const s = X().stockById[e.ing]; return `<tr><td>${D.dateShort(e.at)}, ${D.time12(e.at)}</td><td>${esc(s ? s.name : e.ing)}</td><td>${{ purchase: '<span class="chip ok">Purchase</span>', waste: '<span class="chip bad">Wastage</span>', count: '<span class="chip info">Count</span>' }[e.type] || esc(e.type)}</td><td class="r num">${e.qty > 0 ? '+' : ''}${s ? fmtQty(e.qty, s.unit) : e.qty}</td><td class="muted">${esc(e.note || '')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No purchases, wastage or counts recorded yet.</p>'}</div>
        <div class="box"><h2>Used today <span class="faint">From today’s orders</span></h2>${usedRows.length ? hbars(usedRows.slice(0, 12).map((r) => ({ l: r.s.name, v: r.v * (r.s.cost || 0), q: r.v, u: r.s.unit })), (r) => fmtQty(r.q, r.u)) : '<p class="muted" style="margin:0">Nothing used yet today.</p>'}</div></div>`;
    }
    return head('Stock', 'Every order deducts its recipe from stock. Dishes sell out on their own when an ingredient runs out.', canDo('stockEdit') ? `<button class="btn" data-a="snew">${icon('plus')}Add ingredient</button>` : '') +
      `<div class="kpis"><div class="kpi"><div class="l">Ingredients</div><div class="v num">${items.length}</div></div><div class="kpi"><div class="l">Low</div><div class="v num" style="color:${low ? 'var(--warn)' : ''}">${low}</div></div>
       <div class="kpi"><div class="l">Out</div><div class="v num" style="color:${out ? 'var(--danger)' : ''}">${out}</div></div><div class="kpi"><div class="l">Stock value</div><div class="v money">${D.money(Math.round(value / 100) * 100)}</div></div></div>
      <div style="margin-bottom:12px">${tabs}</div>${body}`;
  }
  function stockDialog(kind, id, sugg) {
    const s = X().stockMap[id]; if (!s) return;
    const unitBig = s.unit === 'g' ? 'kg' : s.unit === 'ml' ? 'L' : s.unit, mult = s.unit === 'g' || s.unit === 'ml' ? 1000 : 1;
    const titles = { buy: `Purchase of ${s.name}`, waste: `Wastage of ${s.name}`, count: `Count ${s.name}` };
    const body = kind === 'buy' ? `<div class="grid2"><label class="field"><span>Quantity received (${unitBig})</span><input class="in" inputmode="decimal" data-q autofocus value="${sugg ? +(sugg / mult).toFixed(3) : ''}"></label>
        <label class="field"><span>Cost per ${unitBig} (₹)</span><input class="in" inputmode="decimal" data-c value="${+((s.cost || 0) * mult).toFixed(2)}"></label></div>
        <div class="grid2" style="margin-top:12px"><label class="field"><span>Supplier</span><input class="in" data-sup value="${esc(s.supplier || '')}"></label><label class="field"><span>Bill number</span><input class="in" data-ref></label></div>`
      : kind === 'waste' ? `<label class="field"><span>Quantity wasted (${unitBig})</span><input class="in" inputmode="decimal" data-q autofocus></label>
        <label class="field" style="margin-top:12px"><span>Reason</span><select class="in" data-reason><option>Spoiled</option><option>Spilled or dropped</option><option>Expired</option><option>Staff meal</option><option>Other</option></select></label>`
        : `<p class="muted" style="margin-top:0">The system expects <b>${fmtQty(Math.max(0, s.qty), s.unit)}</b>. Weigh or count what is on the shelf and enter it below. The difference is recorded.</p><label class="field"><span>Counted quantity (${unitBig})</span><input class="in" inputmode="decimal" data-q autofocus></label>`;
    modal({
      title: titles[kind], body, actions: [{ label: 'Cancel' }, {
        label: kind === 'buy' ? 'Add to stock' : kind === 'waste' ? 'Record wastage' : 'Save count', cls: '', onClick: async (mm) => {
          const q = parseFloat($('[data-q]', mm.el).value);
          if (!(q >= 0) || (kind !== 'count' && !(q > 0))) { toast('Enter a quantity', 'warn'); return false; }
          const qty = Math.round(q * mult * 1000) / 1000, now = Date.now();
          if (kind === 'buy') {
            const c = parseFloat($('[data-c]', mm.el).value), sup = $('[data-sup]', mm.el).value.trim();
            await D.api.addLedger({ id: D.rid('mv_'), at: now, ing: s.id, type: 'purchase', qty, cost: c >= 0 ? c / mult : s.cost, note: [sup, $('[data-ref]', mm.el).value.trim()].filter(Boolean).join(', ') });
            if ((c >= 0 && Math.abs(c / mult - (s.cost || 0)) > 1e-9) || sup !== (s.supplier || '')) await D.api.putStock(Object.assign(pickStock(s), { cost: c >= 0 ? c / mult : s.cost, supplier: sup }));
            toast(`Added ${fmtQty(qty, s.unit)} of ${s.name}`);
          } else if (kind === 'waste') {
            await D.api.addLedger({ id: D.rid('mv_'), at: now, ing: s.id, type: 'waste', qty: -qty, note: $('[data-reason]', mm.el).value });
            toast(`Recorded ${fmtQty(qty, s.unit)} wastage`);
          } else {
            await D.api.putStock(Object.assign(pickStock(s), { base: qty, baseAt: now }));
            await D.api.addLedger({ id: D.rid('mv_'), at: now, ing: s.id, type: 'count', qty: Math.round((qty - s.qty) * 1000) / 1000, note: `Counted ${fmtQty(qty, s.unit)}` });
            toast(`${s.name} set to ${fmtQty(qty, s.unit)}`);
          }
        },
      }],
    });
  }
  const pickStock = (s) => ({ id: s.id, name: s.name, unit: s.unit, base: s.base, baseAt: s.baseAt, reorder: s.reorder, cost: s.cost, supplier: s.supplier });
  function ingredientEditor(id) {
    const s = id ? X().stockMap[id] : null;
    const units = ['g', 'ml', 'pc', 'slice'];
    modal({
      title: s ? `Edit ${s.name}` : 'Add an ingredient', body: `<div style="display:grid;gap:12px">
        <label class="field"><span>Name</span><input class="in" data-n value="${esc(s ? s.name : '')}" autofocus></label>
        <div class="grid3"><label class="field"><span>Unit</span><select class="in" data-u>${units.map((u) => `<option ${s && s.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="field"><span>Reorder at</span><input class="in" inputmode="decimal" data-r value="${s ? s.reorder : ''}"></label>
        <label class="field"><span>Cost per unit (₹)</span><input class="in" inputmode="decimal" data-c value="${s ? s.cost : ''}"></label></div>
        <div class="grid2"><label class="field"><span>Supplier</span><input class="in" data-sup value="${esc(s ? s.supplier || '' : '')}"></label>
        ${s ? '' : '<label class="field"><span>Opening stock</span><input class="in" inputmode="decimal" data-o></label>'}</div>
        <small class="faint">Quantities use the unit you pick, for example grams for coffee beans.</small></div>`,
      actions: [...(s ? [{ label: 'Delete', cls: 'danger ghost', onClick: async () => { const used = S().menu.filter((d) => (d.recipe || []).some((r) => r.ing === s.id)); if (used.length) { toast(`Used in ${used.map((d) => d.name).join(', ')}. Remove it from those recipes first.`, 'warn', 4000); return false; } if (await confirmBox(`Delete ${s.name}?`, { ok: 'Delete', danger: true })) { await D.api.delStock(s.id); toast(`${s.name} deleted`); } } }] : []),
        { label: 'Cancel' }, { label: 'Save', cls: '', onClick: async (mm) => {
          const name = $('[data-n]', mm.el).value.trim(); if (!name) { toast('Enter a name', 'warn'); return false; }
          const rec = { name, unit: $('[data-u]', mm.el).value, reorder: parseFloat($('[data-r]', mm.el).value) || 0, cost: parseFloat($('[data-c]', mm.el).value) || 0, supplier: $('[data-sup]', mm.el).value.trim() };
          if (s) await D.api.putStock(Object.assign(pickStock(s), rec));
          else { let idn = slug(name), k = 2; while (X().stockById[idn]) idn = slug(name) + '-' + k++; await D.api.putStock(Object.assign({ id: idn, base: parseFloat($('[data-o]', mm.el).value) || 0, baseAt: Date.now() }, rec)); }
          toast(`${name} saved`);
        } }],
    });
  }

  /* ---------------- reports ---------------- */
  function reports() {
    const r = rangeOf(rf.range), list = S().orders.filter((o) => inRange(o, r)), good = list.filter(sales);
    const own = good.filter((o) => !D.isEco(o)), apps = good.filter(D.isEco);
    const gross = sumBy(good, (o) => o.total), taxable = sumBy(own, (o) => o.taxable), gst = sumBy(own, (o) => o.cgst + o.sgst), disc = sumBy(good, (o) => o.disc || 0);
    const refunds = list.filter((o) => o.pay && o.pay.status === 'refunded'), cancelled = list.filter((o) => o.status === 'cancelled');
    const days = []; for (let t = D.startOfDay(r[0] || (good.length ? good[good.length - 1].createdAt : Date.now())); t < r[1]; t += 864e5) days.push(t);
    const byDay = days.slice(-62).map((t) => { const l = good.filter((o) => o.createdAt >= t && o.createdAt < t + 864e5); return { t, l, v: sumBy(l, (o) => o.total) }; });
    const items = {}; for (const o of good) for (const l of o.items || []) { const k = l.id; items[k] = items[k] || { name: l.name, q: 0, v: 0, cat: (X().menuById[l.id] || {}).category || 'Other' }; items[k].q += l.qty; items[k].v += Math.round(l.price * 100) * l.qty; }
    const itemRows = Object.entries(items).sort((a, b) => b[1].v - a[1].v);
    const catSum = {}; for (const [, it] of itemRows) catSum[it.cat] = (catSum[it.cat] || 0) + it.v;
    const itemTot = sumBy(itemRows, ([, it]) => it.v) || 1;
    let cogs = 0; for (const [id, it] of itemRows) { const d = X().menuById[id]; if (d) cogs += D.foodCost(d, X().stockById) * it.q; }
    const paidL = good.filter((o) => o.pay && o.pay.status === 'paid');
    const pay = ['upi', 'card', 'cash', 'online'].map((k) => ({ l: { upi: 'UPI', card: 'Card', cash: 'Cash', online: 'Apps' }[k], c: C[k], v: paidL.reduce((a, o) => a + D.payParts(o).filter((p) => p.m === k).reduce((x, p) => x + p.a, 0), 0) }));
    const unpaid = sumBy(good.filter((o) => o.pay && o.pay.status !== 'paid'), (o) => o.total);
    return head('Reports', 'Sales, GST and food cost for the period. Cancelled and refunded bills are left out of sales.', `<button class="btn ghost sm" data-a="gstcsv">${icon('download', 'sm')}GST summary CSV</button><button class="btn ghost sm" data-a="itemcsv">${icon('download', 'sm')}Item sales CSV</button>`) +
      `<div class="toolbar"><div class="pills">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']].map(([k, l]) => `<button class="pill" data-rr="${k}" aria-pressed="${rf.range === k}">${l}</button>`).join('')}</div></div>
      <div class="kpis"><div class="kpi"><div class="l">Gross sales</div><div class="v money">${D.money(gross)}</div><div class="d">${good.length} bills</div></div>
        <div class="kpi"><div class="l">Net sales, before GST</div><div class="v money">${D.money(taxable + sumBy(apps, (o) => o.taxable))}</div><div class="d">${apps.length ? `${D.money(sumBy(apps, (o) => o.taxable))} through apps` : disc ? `${D.money(disc)} in discounts` : 'No discounts'}</div></div>
        <div class="kpi"><div class="l">GST collected</div><div class="v money">${D.money(gst)}</div><div class="d">CGST ${D.money(gst / 2)}, SGST ${D.money(gst / 2)}</div></div>
        <div class="kpi"><div class="l">Food cost estimate</div><div class="v money">${D.money(Math.round(cogs / 100) * 100)}</div><div class="d">${taxable ? Math.round((cogs / taxable) * 100) + '% of net sales, from recipes' : 'From recipes'}</div></div></div>
      ${good.length ? `<div class="dash"><div class="col">
        <div class="box"><h2>Daily sales <span class="faint">GST included</span></h2>${columns(byDay.map((d) => ({ l: new Date(d.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), v: d.v, tip: `<b>${D.money(d.v)}</b> on ${D.dateShort(d.t)}, ${d.l.length} bills` })), { label: 'Daily sales', fmtAxis: (v) => D.compact(v), maxLabels: 8 })}</div>
        <div class="box"><h2>Item sales</h2><div class="tblwrap" style="border:0;max-height:420px"><table class="tbl"><thead><tr><th>Dish</th><th class="r">Qty</th><th class="r">Sales</th><th class="r">Share</th></tr></thead><tbody>
          ${itemRows.map(([, it]) => `<tr><td>${esc(it.name)}</td><td class="r num">${it.q}</td><td class="r money">${D.money(it.v)}</td><td class="r num">${Math.round((it.v / itemTot) * 100)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="box"><h2>GST summary <span class="faint">For GSTR-1 and GSTR-3B, SAC ${esc(S().settings.sac || '996331')}</span></h2><div class="tblwrap" style="border:0;max-height:360px"><table class="tbl"><thead><tr><th>Date</th><th class="r">Bills</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">Total</th></tr></thead><tbody>
          ${byDay.map((d) => Object.assign({}, d, { l: d.l.filter((o) => !D.isEco(o)) })).filter((d) => d.l.length).reverse().map((d) => `<tr><td>${D.dateShort(d.t)}</td><td class="r num">${d.l.length}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.taxable), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.cgst), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.sgst), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.total), true)}</td></tr>`).join('')}
          <tr><td><b>Total</b></td><td class="r num"><b>${own.length}</b></td><td class="r money"><b>${D.money(taxable, true)}</b></td><td class="r money"><b>${D.money(sumBy(own, (o) => o.cgst), true)}</b></td><td class="r money"><b>${D.money(sumBy(own, (o) => o.sgst), true)}</b></td><td class="r money"><b>${D.money(sumBy(own, (o) => o.total), true)}</b></td></tr></tbody></table></div>
          ${apps.length ? `<p class="muted" style="margin:10px 0 0">Through ordering apps (section 9(5), the app pays the GST): ${Object.keys(D.CHANNELS).map((k) => { const l = apps.filter((o) => o.channel === k); return l.length ? `${D.CHANNELS[k].label} ${l.length} order${l.length === 1 ? '' : 's'}, ${D.money(sumBy(l, (o) => o.taxable), true)}` : ''; }).filter(Boolean).join('; ')}. Report these as supplies through e-commerce operators, not in your own taxable value.</p>` : ''}</div>
      </div><div class="col">
        <div class="box"><h2>By category</h2>${hbars(Object.entries(catSum).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v })), (r2) => D.money(r2.v))}</div>
        <div class="box"><h2>By payment <span class="faint">Paid bills</span></h2>${sumBy(pay, (p) => p.v) ? split(pay) : '<p class="muted" style="margin:0">No paid bills in this period.</p>'}${unpaid ? `<p class="muted" style="margin:10px 0 0">${D.money(unpaid)} not yet paid.</p>` : ''}</div>
        <div class="box"><h2>Adjustments</h2><div class="attn"><div style="display:flex;justify-content:space-between;padding:6px"><span>Cancelled orders</span><b class="num">${cancelled.length}</b></div><div style="display:flex;justify-content:space-between;padding:6px"><span>Refunds</span><b class="money">${D.money(sumBy(refunds, (o) => o.total))}</b></div><div style="display:flex;justify-content:space-between;padding:6px"><span>Discounts given</span><b class="money">${D.money(disc)}</b></div></div></div>
      </div></div>` : `<div class="box"><div class="empty">${icon('chart')}<h2>No sales in this period</h2><p>Pick a longer period, or add sample sales in Setup.</p></div></div>`}`;
  }
  function exportGST() {
    const r = rangeOf(rf.range), all = S().orders.filter((o) => inRange(o, r) && sales(o)), good = all.filter((o) => !D.isEco(o));
    const by = {}; for (const o of good) { const k = D.dayKey(o.createdAt); by[k] = by[k] || { n: 0, t: 0, c: 0, s: 0, g: 0 }; by[k].n++; by[k].t += o.taxable; by[k].c += o.cgst; by[k].s += o.sgst; by[k].g += o.total; }
    const rows = [['Date', 'Bills', 'Taxable value', 'CGST', 'SGST', 'Total', 'SAC', 'GST rate']];
    for (const k of Object.keys(by).sort()) rows.push([k, by[k].n, (by[k].t / 100).toFixed(2), (by[k].c / 100).toFixed(2), (by[k].s / 100).toFixed(2), (by[k].g / 100).toFixed(2), S().settings.sac || '996331', S().settings.gstRate + '%']);
    const appRows = {}; for (const o of all.filter(D.isEco)) { const k = D.dayKey(o.createdAt) + ' ' + o.channel; appRows[k] = appRows[k] || { n: 0, t: 0 }; appRows[k].n++; appRows[k].t += o.taxable; }
    if (Object.keys(appRows).length) { rows.push([]); rows.push(['Through ordering apps, section 9(5): GST paid by the app', 'Orders', 'Value']); for (const k of Object.keys(appRows).sort()) rows.push([k, appRows[k].n, (appRows[k].t / 100).toFixed(2)]); }
    UI.download(`gst-summary-${rf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }
  function exportItems() {
    const r = rangeOf(rf.range), good = S().orders.filter((o) => inRange(o, r) && sales(o)), items = {};
    for (const o of good) for (const l of o.items || []) { items[l.name] = items[l.name] || [0, 0]; items[l.name][0] += l.qty; items[l.name][1] += Math.round(l.price * 100) * l.qty; }
    const rows = [['Dish', 'Quantity', 'Sales before GST']]; for (const [k, v] of Object.entries(items).sort((a, b) => b[1][1] - a[1][1])) rows.push([k, v[0], (v[1] / 100).toFixed(2)]);
    UI.download(`item-sales-${rf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }

  /* ---------------- tables & QR ---------------- */
  function portalBase() { const s = S().settings; if (s.portalUrl) return s.portalUrl.replace(/#.*$/, ''); return location.href.replace(/#.*$/, '').replace(/cafe\.html$/, 'index.html'); }
  function tables() {
    const s = S().settings, n = s.tables || 12, base = portalBase();
    return head('Tables & QR', 'Print a QR card for each table. Guests scan it to open the menu with their table already set.', `<button class="btn" data-a="qrsheet">${icon('download')}Printable QR sheet</button>`) +
      `<div class="box" style="margin-bottom:14px;display:grid;gap:12px"><div class="grid2" style="grid-template-columns:160px 1fr"><label class="field"><span>Number of tables</span><input class="in" inputmode="numeric" value="${n}" data-tn></label>
        <label class="field"><span>Menu link the QR codes open</span><input class="in" value="${esc(s.portalUrl || '')}" placeholder="${esc(base)}" data-tu><small>Leave empty to use this page’s link. If you host the menu on your own website, paste its address here.</small></label></div>
        <div><button class="btn sm" data-a="tsave">Save</button></div></div>
      <div class="qrgrid">${Array.from({ length: n }, (_, i) => { const url = `${base}#table-${i + 1}`; return `<div class="qrcard"><b>Table ${i + 1}</b><div class="qr">${QR.svg(url, { margin: 1, dark: '#3E2A1E', label: `QR code for table ${i + 1}` })}</div><span class="faint" style="font-size:12.5px">Scan to see dishes on your table</span><a class="btn xs ghost" href="${custHref('#table-' + (i + 1))}"${custAttrs}>Open as Table ${i + 1}</a></div>`; }).join('')}
      <div class="qrcard"><b>Takeaway</b><div class="qr">${QR.svg(`${base}#menu`, { margin: 1, dark: '#3E2A1E' })}</div><span class="faint" style="font-size:12.5px">For the counter and the window</span><a class="btn xs ghost" href="${custHref('#menu')}"${custAttrs}>Open menu</a></div></div>`;
  }
  function qrSheet() {
    const s = S().settings, n = s.tables || 12, base = portalBase();
    const card = (title, url) => `<div class="c"><div class="t">${esc(s.name)}</div><div class="q">${QR.svg(url, { margin: 1, dark: '#3E2A1E' })}</div><div class="n">${esc(title)}</div><div class="s">Scan to see today’s dishes on your table in 3D and order</div></div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(s.name)} table QR codes</title><style>@page{size:A4;margin:12mm}body{font-family:system-ui,sans-serif;margin:0;color:#2B1F17}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}.c{border:1.5px solid #6F4A2F;border-radius:4mm;padding:6mm;text-align:center;break-inside:avoid}.t{font-weight:700;color:#6F4A2F;font-size:14pt}.q svg{width:42mm;height:42mm}.n{font-size:20pt;font-weight:700}.s{font-size:9pt;color:#62513F}</style></head><body><div class="g">
      ${Array.from({ length: n }, (_, i) => card(`Table ${i + 1}`, `${base}#table-${i + 1}`)).join('')}${card('Takeaway', `${base}#menu`)}</div></body></html>`;
    UI.download(`table-qr-codes.html`, html, 'text/html');
  }

  /* ---------------- setup ---------------- */
  function setup() {
    const s = S().settings;
    const warnG = !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.gstin || '') || /AAAAA0000A/.test(s.gstin || ''), warnF = !/^\d{14}$/.test(s.fssai || '') || /^0+$/.test(s.fssai || '');
    const demo = S().orders.filter((o) => o.demo).length;
    const f = (k, l, extra = '') => `<label class="field"><span>${l}</span><input class="in" name="${k}" value="${esc(s[k] == null ? '' : s[k])}" ${extra}></label>`;
    return head('Setup', 'Café details print on every bill. Changes apply to the customer portal straight away.', `<button class="btn" data-a="ssave">${icon('check')}Save changes</button>`) +
      (warnG || warnF ? `<div class="banner">${icon('alert')}<span>Add your real ${warnG ? 'GSTIN' : ''}${warnG && warnF ? ' and ' : ''}${warnF ? '14-digit FSSAI licence number' : ''}. ${warnF ? 'FSSAI requires the licence number on every bill. ' : ''}The current values are placeholders.</span></div>` : '') +
      `<form class="setup" data-sform novalidate>
        <div class="box"><h2>Café</h2>${f('name', 'Café name', 'maxlength="40"')}${f('tagline', 'Tagline')}${f('address', 'Address on bills')}${f('phone', 'Phone')}</div>
        <div class="box"><h2>Tax and licences</h2>${f('gstin', 'GSTIN', 'maxlength="15" style="text-transform:uppercase"')}${f('fssai', 'FSSAI licence number', 'inputmode="numeric" maxlength="14"')}
          <div class="grid2"><label class="field"><span>GST rate</span><select class="in" name="gstRate"><option value="5" ${+s.gstRate === 5 ? 'selected' : ''}>5%, standalone café</option><option value="18" ${+s.gstRate === 18 ? 'selected' : ''}>18%, inside a premium hotel</option></select></label>${f('sac', 'SAC code')}</div>
          <label class="row" style="justify-content:space-between"><span>Menu prices already include GST</span><span class="switch"><input type="checkbox" name="taxInclusive" ${s.taxInclusive ? 'checked' : ''}></span></label>
          <small class="faint">Standalone cafés charge 5% GST without input tax credit. Service charge can’t be added to bills automatically, so this software never adds one.</small></div>
        <div class="box"><h2>Payments</h2>${f('upiId', 'UPI ID for payments', 'placeholder="yourcafe@okaxis"')}${f('upiName', 'Name shown in UPI apps')}
          <small class="faint">Guests pay to this UPI ID from the QR on their bill. Card payments run in test mode until a payment gateway such as Razorpay is connected on your own website.</small></div>
        <div class="box"><h2>Orders</h2><div class="grid2">${f('prefix', 'Order ID prefix', 'maxlength="4" style="text-transform:uppercase"')}${f('tables', 'Tables', 'inputmode="numeric"')}</div>
          <label class="row" style="justify-content:space-between"><span>Serve dishes only in their set hours</span><span class="switch"><input type="checkbox" name="timeMenus" ${s.timeMenus !== false ? 'checked' : ''}></span></label>
          <small class="faint">Rewards, payment methods and other customer app options are on the <a href="${href('app')}">Customer app</a> page.</small>
          <small class="faint">Staff PINs and roles are on the <a href="${href('team')}">Team</a> page.</small></div>
        <div class="box"><h2>Data</h2><p class="muted" style="margin:0">${supa() ? 'Orders, menu and stock live in your Supabase project and sync to every phone and counter in real time.' : S().mode === 'cloud' ? 'Orders, menu and stock are shared live between every device that opens this page while signed in to Claude.' : 'Data is saved in this browser. To share orders between phones and the counter, connect a shared database or open this page inside Claude.'}</p>
          <div class="row wrap"><button type="button" class="btn ghost sm" data-a="sample">${icon('chart', 'sm')}Add sample sales</button>${demo ? `<button type="button" class="btn ghost sm" data-a="unsample">${icon('trash', 'sm')}Remove ${demo} sample sales</button>` : ''}
          <button type="button" class="btn ghost sm" data-a="seed">${icon('refresh', 'sm')}${S().menu.length ? 'Reset menu and stock' : 'Load starter menu'}</button><button type="button" class="btn ghost sm" data-a="export">${icon('download', 'sm')}Export all data</button></div></div>
      </form>`;
  }
  async function saveSetup() {
    const fm = $('[data-sform]', root); if (!fm) return;
    const v = (n) => (fm.elements[n].type === 'checkbox' ? fm.elements[n].checked : fm.elements[n].value.trim());
    const patch = { name: v('name'), tagline: v('tagline'), address: v('address'), phone: v('phone'), gstin: v('gstin').toUpperCase(), fssai: v('fssai'), gstRate: +v('gstRate'), sac: v('sac'), taxInclusive: v('taxInclusive'), upiId: v('upiId'), upiName: v('upiName'), prefix: v('prefix').toUpperCase().replace(/[^A-Z]/g, '') || 'KM', tables: Math.max(1, Math.min(99, parseInt(v('tables'), 10) || 12)), timeMenus: v('timeMenus') };
    if (!patch.name) return toast('Enter the café name', 'warn');
    if (patch.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(patch.upiId)) return toast('That UPI ID doesn’t look right, for example yourcafe@okaxis', 'warn');
    if (patch.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(patch.gstin)) return toast('A GSTIN has 15 characters, for example 29ABCDE1234F1Z5', 'warn');
    if (patch.fssai && !/^\d{14}$/.test(patch.fssai)) return toast('The FSSAI number has 14 digits', 'warn');
    try { await D.api.setSettings(patch); toast('Settings saved'); } catch (e) { /* handled */ }
  }

  /* ---------------- actions ---------------- */
  const OWNER_ACTS = { ssave: 'settings', sample: 'settings', unsample: 'settings', seed: 'settings', export: 'export', noticesave: 'settings', noticeclear: 'settings', tsave: 'settings', dnew: 'dishEdit', snew: 'stockEdit', zreport: 'dayClose', tadd: 'settings' };
  async function act(a, el) {
    if (OWNER_ACTS[a] && !canDo(OWNER_ACTS[a])) return toast('Your role can’t do that. Ask an owner.', 'warn');
    if (a === 'lock') { if (supa()) D.api.adapter.signOut().catch(() => {}); meId = null; try { sessionStorage.removeItem('km.staff'); } catch (e) { /* ignore */ } render(); }
    if (a === 'side') { sideOpen = !sideOpen; $('.side', root).classList.toggle('open', sideOpen); }
    if (a === 'sound') { soundOn = !soundOn; if (soundOn) { UI.unlockAudio(); UI.chime(); } render(); }
    if (a === 'pclear') { Object.assign(pos, { lines: [], disc: '', phone: '', redeem: false }); refreshTicket(); }
    if (a === 'pkot') posSendKot();
    if (a === 'tadd') memberEditor(null);
    if (a === 'drawer') { try { await Printer.openDrawer(); } catch (e) { toast(e.message || 'Could not open the drawer', 'bad'); } }
    if (a === 'papp') posAppOrder();
    if (a === 'prconnect') { const slot = el.dataset.slot; try { const h = await Printer.connect(slot); if (h) toast(`${h.name} connected`); } catch (e) { toast(e.name === 'NotFoundError' ? 'No printer chosen' : e.message || 'Could not connect', 'warn', 4000); } render(); }
    if (a === 'prtest') { const slot = el.dataset.slot; try { await Printer.printTest(slot); toast('Test page sent'); } catch (e) { toast(e.message || 'Could not print', 'bad', 4000); } }
    if (a === 'prsample') { printerPreview = el.dataset.which; render(); }
    if (a === 'noticesave') { const v = ($('[data-notice]', root).value || '').trim(); await D.api.setSettings({ notice: v }); toast(v ? 'Message is live on the menu' : 'Message removed'); }
    if (a === 'noticeclear') { await D.api.setSettings({ notice: '' }); toast('Message removed'); }
    if (a === 'zreport') dayClose();
    if (a === 'bcsv') exportBills();
    if (a === 'gstcsv') exportGST();
    if (a === 'itemcsv') exportItems();
    if (a === 'dnew') dishEditor(null);
    if (a === 'snew') ingredientEditor(null);
    if (a === 'qrsheet') qrSheet();
    if (a === 'tsave') { const n = parseInt($('[data-tn]', root).value, 10); const u = $('[data-tu]', root).value.trim(); await D.api.setSettings({ tables: Math.max(1, Math.min(99, n || 12)), portalUrl: u }); toast('Saved'); }
    if (a === 'ssave') saveSetup();
    if (a === 'buycopy' || a === 'buycsv') {
      const list = Object.values(X().stockMap).filter((s) => s.state !== 'ok').map((s) => { const sug = Math.max(s.reorder * 2 - Math.max(0, s.qty), s.reorder); const r = s.unit === 'g' || s.unit === 'ml' ? Math.ceil(sug / 500) * 500 : Math.ceil(sug); return [s.name, fmtQty(r, s.unit), s.supplier || '', (r * (s.cost || 0)).toFixed(2)]; });
      if (a === 'buycopy') UI.copy(`Purchase list, ${D.dateShort(Date.now())}\n` + list.map((r) => `${r[0]}: ${r[1]} (${r[2]})`).join('\n'));
      else UI.download(`purchase-list-${D.dayKey(Date.now())}.csv`, csv([['Ingredient', 'Quantity', 'Supplier', 'Estimated cost'], ...list]), 'text/csv');
    }
    if (a === 'sample') {
      const ok = await confirmBox('Add about two weeks of sample sales so the dashboard and reports have data? They are marked as samples, do not touch stock, and can be removed here later.', { title: 'Add sample sales?', ok: 'Add sample sales', cancel: 'Not now' });
      if (!ok) return;
      const start = Math.max(1000, ...S().orders.map((o) => o.no || 0));
      const list = D.sampleOrders(S().menu.length ? S().menu : D.defaultMenu(), S().settings, start, 14);
      toast(`Adding ${list.length} sample sales…`, 'ok', 2000);
      try { await D.api.putOrders(list, (i, n) => toast(`Added ${i} of ${n}…`, 'ok', 1200)); if (D.api.adapter.setCounter) await D.api.adapter.setCounter(start + list.length); else if (S().mode === 'cloud') await D.api.adapter.db.doc('meta/counter').set({ no: start + list.length, at: Date.now() }); toast(`${list.length} sample sales added`); } catch (e) { toast('Could not add all sample sales', 'bad'); }
    }
    if (a === 'unsample') {
      const ids = S().orders.filter((o) => o.demo).map((o) => o.id);
      if (await confirmBox(`Remove ${ids.length} sample sales? Real orders stay.`, { title: 'Remove sample sales?', ok: 'Remove', danger: true })) { toast('Removing…', 'ok', 1500); await D.api.delOrders(ids, (i, n) => toast(`Removed ${i} of ${n}…`, 'ok', 1200)); toast('Sample sales removed'); }
    }
    if (a === 'seed') {
      if (S().menu.length && !(await confirmBox('Replace the menu and stock with the starter set? Orders and bills stay.', { title: 'Reset menu and stock?', ok: 'Reset', danger: true }))) return;
      toast('Loading the starter menu…', 'ok', 1500);
      try { await D.api.seed(); toast('Starter menu and stock loaded'); } catch (e) { toast('Could not load the starter menu', 'bad'); }
    }
    if (a === 'export') UI.download(`cafe-data-${D.dayKey(Date.now())}.json`, JSON.stringify({ settings: S().settings, menu: S().menu, stock: S().stock, ledger: S().ledger, orders: S().orders }, null, 1), 'application/json');
  }
  function onClick(e) {
    const t = e.target;
    if (!me()) { const p = t.closest('[data-pin]'); if (p) pinPress(p.dataset.pin); return; }
    const g = (sel) => t.closest(sel);
    let el;
    if ((el = g('[data-a]'))) return act(el.dataset.a, el);
    if ((el = g('[data-next]'))) return advance(el.dataset.next, el.dataset.to);
    if ((el = g('[data-cancel]'))) return cancelOrder(el.dataset.cancel);
    if ((el = g('[data-kot]'))) { const o = S().orders.find((x) => x.id === el.dataset.kot); if (o) printKotFor(o, !!o.kotAt); return; }
    if ((el = g('[data-kf]'))) { kf.type = el.dataset.kf; return render(); }
    if ((el = g('[data-bill]'))) return billDialog(el.dataset.bill);
    if ((el = g('[data-collect]'))) return collect(el.dataset.collect);
    if ((el = g('[data-padd]'))) return posAdd(el.dataset.padd);
    if ((el = g('[data-pinc]'))) { const l = pos.lines[+el.dataset.pinc]; if (l) posAdd(l.id, l); return; }
    if ((el = g('[data-pedit]'))) return lineEditor(+el.dataset.pedit);
    if ((el = g('[data-psettle]'))) return settleTable(el.dataset.psettle);
    if ((el = g('[data-pdec]'))) { const i = +el.dataset.pdec; if (pos.lines[i]) { pos.lines[i].qty--; if (pos.lines[i].qty <= 0) pos.lines.splice(i, 1); } return refreshTicket(); }
    if ((el = g('[data-pt]'))) { pos.type = el.dataset.pt; return refreshTicket(); }
    if ((el = g('[data-pch]'))) { pos.channel = el.dataset.pch; return refreshTicket(); }
    if ((el = g('[data-pdm]'))) { pos.discMode = el.dataset.pdm; return refreshTicket(); }
    if ((el = g('[data-pc]'))) { pos.cat = el.dataset.pc; $$('[data-pc]', root).forEach((b) => b.setAttribute('aria-pressed', b === el)); return refreshTiles(); }
    if ((el = g('[data-pay]'))) return posCharge(el.dataset.pay);
    if ((el = g('[data-br]'))) { bf.range = el.dataset.br; return render(); }
    if ((el = g('[data-bs]'))) { bf.status = el.dataset.bs; return render(); }
    if ((el = g('[data-mc]'))) { mf.cat = el.dataset.mc; return render(); }
    if ((el = g('[data-dedit]'))) return canDo('dishEdit') ? dishEditor(el.dataset.dedit) : null;
    if ((el = g('[data-tedit]'))) return memberEditor(el.dataset.tedit);
    if ((el = g('[data-st]'))) { sf.tab = el.dataset.st; return render(); }
    if ((el = g('[data-sbuy]'))) return canDo('stockBuy') ? stockDialog('buy', el.dataset.sbuy, +el.dataset.sugg || 0) : toast('Only an owner records purchases', 'warn');
    if ((el = g('[data-swaste]'))) return canDo('stockWaste') ? stockDialog('waste', el.dataset.swaste) : null;
    if ((el = g('[data-scount]'))) return canDo('stockCount') ? stockDialog('count', el.dataset.scount) : toast('Only an owner records stock counts', 'warn');
    if ((el = g('[data-sedit]'))) return canDo('stockEdit') ? ingredientEditor(el.dataset.sedit) : null;
    if ((el = g('[data-rr]'))) { rf.range = el.dataset.rr; return render(); }
    if (sideOpen && g('.side a')) { sideOpen = false; }
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-pq]')) { pos.q = t.value; refreshTiles(); }
    if (t.matches('[data-pext]')) pos.ext = t.value;
    if (t.matches('[data-pdisc]')) { pos.disc = t.value; refreshTotals(); }
    if (t.matches('[data-pphone]')) { pos.phone = t.value; if (!D.cleanPhone(pos.phone)) pos.redeem = false; refreshTotals(); }
    if (t.matches('[data-predeem]')) { pos.redeem = t.checked; refreshTotals(); }
    if (t.matches('[data-bq]')) { bf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-bq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    if (t.matches('[data-mq]')) { mf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-mq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    if (t.matches('[data-sq]')) { sf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-sq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
  }
  function onChange(e) {
    if (e.target.matches && e.target.matches('[data-prn]')) {
      const [a, b] = e.target.dataset.prn.split('.'), v = e.target.type === 'checkbox' ? e.target.checked : ['width', 'port', 'copies', 'baud'].includes(b) ? +e.target.value : e.target.value;
      const c = JSON.parse(JSON.stringify(Printer.cfg)); if (b) { c[a][b] = v; if (b === 'type') c[a].label = ''; } else c[a] = v;
      Printer.save(c); if (b !== 'host' && b !== 'bridge' && a !== 'device') render(); return;
    }
    if (e.target.matches && e.target.matches('[data-predeem]')) { pos.redeem = e.target.checked; refreshTotals(); return; }
    if (e.target.matches && e.target.matches('[data-ctl],[data-num],[data-tlim]') && !canDo('settings')) { toast('Only an owner can change this', 'warn'); render(); return; }
    if (e.target.matches && e.target.matches('[data-tlim]')) { const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)); D.api.setSettings({ cashierMaxDisc: v }).then(() => toast(`Cashiers can give up to ${v}% off`)); return; }
    if (e.target.matches && e.target.matches('[data-ctl]')) return setCtl(e.target.dataset.ctl, e.target.checked);
    if (e.target.matches && e.target.matches('[data-num]')) { const v = Math.max(1, parseInt(e.target.value, 10) || 0); if (!v) return; return setCtl(e.target.dataset.num, v); }
    const t = e.target;
    if (t.matches('[data-ptable]')) pos.table = t.value;
    if (t.matches('[data-dact]') && !canDo('dishToggle')) return;
    if (t.matches('[data-dact]')) { const d = X().menuById[t.dataset.dact]; if (d) D.api.putDish(Object.assign({}, d, { active: t.checked })).then(() => toast(`${d.name} ${t.checked ? 'is on the menu' : 'is hidden from the menu'}`)); }
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target.matches('tr[data-bill]')) billDialog(e.target.dataset.bill);
    // billing: Enter in search adds the first available match, Escape clears the search
    if (page === 'billing' && e.target.matches('[data-pq]')) {
      if (e.key === 'Enter') { e.preventDefault(); const d = posTiles().find((x) => status(x).ok); if (d && posAdd(d.id)) { pos.q = ''; e.target.value = ''; refreshTiles(); } }
      if (e.key === 'Escape') { pos.q = ''; e.target.value = ''; refreshTiles(); }
    }
  }
  // "/" jumps to the dish search on the billing screen
  document.addEventListener('keydown', (e) => { if (e.key !== '/' || page !== 'billing' || !document.body.classList.contains('s-mode') || e.target.matches('input,textarea,select') || document.querySelector('.scrim')) return; const i = $('[data-pq]', root); if (i) { e.preventDefault(); i.focus(); } });

  /* ---------------- new-order alerts ---------------- */
  function watch() {
    const list = S().orders;
    if (!primed) { if (S().ready && (S().mode !== 'cloud' || S().synced)) { list.forEach((o) => seen.add(o.id)); primed = true; } return; }
    for (const o of list) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      if (Printer.cfg.autoKot && me() && o.status === 'new' && !o.kotAt && Date.now() - o.createdAt < 10 * 60000) autoKot(o);
      if (o.status === 'new' && Date.now() - o.createdAt < 5 * 60000 && me() && page !== 'board' && document.body.classList.contains('s-mode') && (o.source === 'portal' || o.channel)) {
        toast(`New order ${o.id}, ${D.whereLabel(o)}, ${D.money(o.total)}`, 'ok', 5000);
        if (soundOn) UI.chime();
      }
    }
  }

  // one device prints each new order's KOT; the order is marked so another device set to auto-print skips it
  async function autoKot(o) {
    const fresh = S().orders.find((x) => x.id === o.id) || o; if (fresh.kotAt) return;
    if (!Printer.ready(Printer.kotSlot()) || Printer.cfg[Printer.kotSlot()].type === 'browser') return;
    try { if (await Printer.printKot(fresh)) await D.api.patchOrder(o.id, { kotAt: Date.now(), kotBy: Printer.cfg.device || who() }); }
    catch (e) { toast(`KOT ${o.id} did not print: ${e.message || 'printer error'}. Tap KOT on the order to retry.`, 'bad', 6000); }
  }

  /* ---------------- public ---------------- */
  function mount(el) { root = el; }
  function show(p) {
    page = PAGES.some(([k]) => k === p) ? p : 'overview';
    sideOpen = false;
    document.body.classList.add('s-mode');
    root.onclick = onClick; root.oninput = onInput; root.onchange = onChange; root.onkeydown = onKey;
    render();
  }
  function onData() {
    watch();
    if (!root || !document.body.classList.contains('s-mode')) return;
    const a = document.activeElement;
    if (a && root.contains(a) && (a.matches('input,select,textarea'))) { if (page === 'billing') { refreshTiles(); const t = $('[data-ptot]', root); if (t) t.innerHTML = totRows(posBill()); } return; }
    if (page === 'billing' && $('[data-ticket]', root)) { const w = $('.pos', root); if (w) { const y = window.scrollY; render(); window.scrollTo(0, y); } return; }
    render();
  }
  function leave() { clearInterval(ticker); document.body.classList.remove('s-mode'); }
  return { mount, show, onData, leave, watch };
})();
