'use strict';
/* Staff software: overview, KOT board, billing (POS), bills, menu, stock, reports, tables & QR, setup */
const Staff = (() => {
  const { $, $$, esc, icon, vmark, toast, modal, confirmBox } = UI;
  const D = Data;
  const S = () => D.state, X = () => D.derived();
  const C = { upi: '#8B5A3C', card: '#D59A55', cash: '#4E8A5B', bar: '#8B5A3C' };
  let root = null, page = 'overview', unlocked = false, sideOpen = false, soundOn = false, ticker = 0, pinBuf = '';
  const seen = new Set(); let primed = false;
  const pos = { lines: [], type: 'dine-in', table: '', disc: '', discMode: 'pct', cat: 'All', q: '', ref: null };
  const bf = { range: 'today', status: 'all', q: '' }, mf = { q: '', cat: 'All' }, sf = { tab: 'items', q: '' }, rf = { range: '7d' }, kf = { type: 'all' };
  try { unlocked = sessionStorage.getItem('km.staff') === '1'; } catch (e) { unlocked = false; }

  const PAGES = [
    ['overview', 'home', 'Overview'], ['orders', 'bell', 'Orders'], ['billing', 'register', 'Billing'], ['bills', 'receipt', 'Bills'],
    ['menu', 'utensils', 'Menu'], ['stock', 'box', 'Stock'], ['reports', 'chart', 'Reports'], ['tables', 'qr', 'Tables & QR'], ['setup', 'sliders', 'Setup'],
  ];
  const href = (p) => '#staff' + (p === 'overview' ? '' : '-' + p);
  const live = () => S().orders.filter((o) => o.status !== 'cancelled');
  const sales = (o) => o.status !== 'cancelled' && (!o.pay || o.pay.status !== 'refunded');
  const unpaidOrders = () => S().orders.filter((o) => o.status !== 'cancelled' && o.pay && (o.pay.status === 'unpaid' || o.pay.status === 'pending'));
  const stockIssues = () => Object.values(X().stockMap).filter((s) => s.state !== 'ok');
  const status = (d) => D.dishStatus(d, X().stockMap, S().settings, new Date());
  const fmtQty = (q, u) => { const a = Math.abs(q); if (u === 'g' && a >= 1000) return (q / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' kg'; if (u === 'ml' && a >= 1000) return (q / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + ' L'; return D.NUM.format(Math.round(q * 100) / 100) + ' ' + u; };

  /* ---------------- lock ---------------- */
  const supa = () => S().backend === 'supabase';
  function lockScreen() {
    if (supa()) {
      if (S().staffUser) { unlocked = true; return render(); }
      root.innerHTML = `<div class="lock"><div class="lock-in">
      <span class="plate lg">${esc(S().settings.name)}</span>
      <h1 style="font-size:22px;margin:10px 0 0;font-weight:600">Staff sign-in</h1>
      <p style="margin:0;color:#E6D6C6">Sign in with the staff account the owner created in Supabase.</p>
      <form id="supa-login" style="display:grid;gap:10px;width:100%;text-align:left">
        <input class="in" type="email" name="email" autocomplete="username" placeholder="Email" required>
        <input class="in" type="password" name="password" autocomplete="current-password" placeholder="Password" required>
        <button class="btn saffron lg block" type="submit">Sign in</button></form>
      <a href="#welcome" style="color:#E6D6C6;font-size:14px">Back to start</a></div></div>`;
      $('#supa-login', root).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        try { await D.api.adapter.signIn(f.email.value.trim(), f.password.value); unlocked = true; UI.unlockAudio(); render(); } catch (err) { toast('Email or password is wrong', 'bad'); }
      };
      return;
    }
    const def = String(S().settings.pin || '1234') === '1234';
    root.innerHTML = `<div class="lock"><div class="lock-in">
      <span class="plate lg">${esc(S().settings.name)}</span>
      <h1 style="font-size:22px;margin:10px 0 0;font-weight:600">Staff sign-in</h1>
      <p style="margin:0;color:#E6D6C6">Enter the 4-digit staff PIN${def ? '. The starting PIN is 1234; change it in Setup.' : '.'}</p>
      <div class="pin-dots" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pinpad" role="group" aria-label="PIN keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-pin="${n}">${n}</button>`).join('')}<button data-pin="clr" aria-label="Clear">${icon('x')}</button><button data-pin="0">0</button><button data-pin="del" aria-label="Delete">${icon('back')}</button></div>
      <a href="#welcome" style="color:#E6D6C6;font-size:14px">Back to start</a></div></div>`;
  }
  function pinPress(k) {
    if (k === 'clr') pinBuf = ''; else if (k === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 4) pinBuf += k;
    if (pinBuf.length === 4) {
      if (pinBuf === String(S().settings.pin || '1234')) { unlocked = true; pinBuf = ''; try { sessionStorage.setItem('km.staff', '1'); } catch (e) { /* ignore */ } UI.unlockAudio(); render(); return; }
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
      ${PAGES.map(([k, ic, l]) => `<a href="${href(k)}" ${page === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span>${k === 'orders' && nNew ? `<span class="badge">${nNew}</span>` : ''}${k === 'stock' && nLow ? `<span class="badge" style="background:#FFD9D2;color:#7A1E10">${nLow}</span>` : ''}</a>`).join('')}
      <div class="foot"><div class="sync ${sync[0]}"><span class="dot"></span>${sync[1]}</div>
      <a class="btn quiet sm" href="#menu">${icon('utensils', 'sm')}Customer view</a>
      <button class="btn quiet sm" data-a="lock">${icon('lock', 'sm')}Lock</button></div></nav>`;
  }
  function render() {
    if (!root) return;
    clearInterval(ticker);
    if (!unlocked) return lockScreen();
    const y = window.scrollY;
    const body = { overview: overview, orders: orders, billing: billing, bills: bills, menu: menuPage, stock: stockPage, reports: reports, tables: tables, setup: setup }[page] || overview;
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
    const kpis = `<div class="kpis">
      <div class="kpi"><div class="l">Sales today</div><div class="v money">${D.money(tSales)}</div><div class="d ${delta == null ? '' : delta >= 0 ? 'up' : 'down'}">${delta == null ? 'No sales yesterday by this time' : `${delta >= 0 ? '+' : ''}${delta}% vs this time yesterday`}</div></div>
      <div class="kpi"><div class="l">Orders today</div><div class="v num">${today.length}</div><div class="d">${today.filter((o) => o.source === 'portal').length} from the customer portal</div></div>
      <div class="kpi"><div class="l">Average order</div><div class="v money">${D.money(today.length ? Math.round(tSales / today.length / 100) * 100 : 0)}</div><div class="d">GST included</div></div>
      <div class="kpi"><div class="l">Waiting for payment</div><div class="v money">${D.money(sumBy(up, (o) => o.total))}</div><div class="d">${up.length} bill${up.length === 1 ? '' : 's'}</div></div></div>`;
    if (!all.length) {
      return head('Today', D.dateLong(now), `<a class="btn" href="#staff-billing">${icon('plus')}New bill</a>`) + modeBanner() + kpis +
        `<div class="box"><div class="empty" style="padding:28px 10px">${icon('chart')}<h2>No sales yet</h2><p>Place a test order from the customer portal, or add two weeks of sample sales to explore the dashboard and reports. Sample sales are marked and can be removed in Setup.</p>
        <div class="row" style="justify-content:center;margin-top:14px;flex-wrap:wrap"><a class="btn" href="#menu">Open the customer portal</a><button class="btn ghost" data-a="sample">Add sample sales</button></div></div></div>`;
    }
    const hours = []; for (let h = 7; h <= 23; h++) hours.push(h);
    const byHour = hours.map((h) => { const v = sumBy(today.filter((o) => new Date(o.createdAt).getHours() === h), (o) => o.total); return { l: h % 12 === 0 ? '12' + (h < 12 ? 'a' : 'p') : (h % 12) + (h < 12 ? 'a' : 'p'), v, tip: `<b>${D.money(v)}</b> between ${D.hm(D.pad2(h) + ':00')} and ${D.hm(D.pad2((h + 1) % 24) + ':00')}` }; });
    const days = []; for (let k = 13; k >= 0; k--) { const a = sod - k * 864e5, b = a + 864e5; const list = all.filter((o) => o.createdAt >= a && o.createdAt < b && sales(o)); const v = sumBy(list, (o) => o.total); days.push({ l: k === 0 ? 'Today' : new Date(a).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), v, tip: `<b>${D.money(v)}</b> on ${D.dateShort(a)}, ${list.length} orders` }); }
    const top = {}; for (const o of today) for (const l of o.items || []) top[l.name] = (top[l.name] || 0) + l.qty;
    const topRows = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, v]) => ({ l, v }));
    const paid = today.filter((o) => o.pay && o.pay.status === 'paid');
    const pay = ['upi', 'card', 'cash'].map((k) => ({ l: { upi: 'UPI', card: 'Card', cash: 'Cash' }[k], c: C[k], v: sumBy(paid.filter((o) => o.pay.method === k), (o) => o.total) }));
    const attn = [];
    for (const o of up.slice(0, 5)) attn.push(`<button data-bill="${esc(o.id)}"><span class="ico ${o.pay.status === 'pending' ? 'warn' : 'info'}">${icon(o.pay.status === 'pending' ? 'upi' : 'receipt')}</span><span><span class="t">${esc(o.id)} ${o.pay.status === 'pending' ? 'UPI to confirm' : 'not paid'}</span><br><span class="s">${o.table ? 'Table ' + o.table : 'Takeaway'}, ${D.money(o.total)}, ${UI.ago(o.createdAt)} ago</span></span></button>`);
    for (const s of stockIssues().slice(0, 6)) attn.push(`<a href="#staff-stock"><span class="ico ${s.state === 'out' ? 'bad' : 'warn'}">${icon('box')}</span><span><span class="t">${esc(s.name)} ${s.state === 'out' ? 'out of stock' : 'running low'}</span><br><span class="s">${fmtQty(Math.max(0, s.qty), s.unit)} left, reorder at ${fmtQty(s.reorder, s.unit)}</span></span></a>`);
    const soldOut = S().menu.filter((d) => status(d).reason === 'stock');
    if (soldOut.length) attn.push(`<a href="#staff-menu"><span class="ico bad">${icon('utensils')}</span><span><span class="t">${soldOut.length} dish${soldOut.length > 1 ? 'es' : ''} sold out</span><br><span class="s">${esc(soldOut.map((d) => d.name).join(', '))}</span></span></a>`);
    return head('Today', D.dateLong(now), `<a class="btn ghost" href="#staff-orders">${icon('bell')}Kitchen board</a><a class="btn" href="#staff-billing">${icon('plus')}New bill</a>`) + modeBanner() + kpis +
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
      <div class="hd"><span class="id">${esc(o.id)}</span><span class="where">${o.table ? 'Table ' + o.table : 'Takeaway'}</span><span class="age" data-age="${o.createdAt}">${UI.mmss(o.createdAt)}</span></div>
      <ul>${(o.items || []).map((l) => `<li><b>${l.qty}×</b><span>${esc(l.name)}${l.note ? `<span class="n">${esc(l.note)}</span>` : ''}</span></li>`).join('')}</ul>
      <div class="ft">${payc}<span class="chip">${o.source === 'portal' ? 'Portal' : 'Counter'}</span>
        <button class="btn xs ghost" data-kot="${esc(o.id)}" aria-label="Kitchen ticket">${icon(UI.canPrint() ? 'print' : 'download', 'sm')}KOT</button>
        <button class="btn xs danger ghost" data-cancel="${esc(o.id)}">Cancel</button>
        ${next ? `<button class="btn sm ${o.status === 'new' ? 'saffron' : ''}" data-next="${esc(o.id)}" data-to="${next[0]}">${next[1]}</button>` : ''}</div></article>`;
  }
  function orders() {
    const list = S().orders.filter((o) => ['new', 'preparing', 'ready'].includes(o.status) && (kf.type === 'all' || o.type === kf.type)).sort((a, b) => a.createdAt - b.createdAt);
    const lane = (k, t) => { const l = list.filter((o) => o.status === k); return `<section class="lane" aria-label="${t}"><h2>${t}<span class="count">${l.length}</span></h2>${l.length ? l.map(kotCard).join('') : `<div class="none">${k === 'new' ? 'New orders appear here the moment they are placed.' : 'Nothing here.'}</div>`}</section>`; };
    const served = S().orders.filter((o) => o.status === 'served' && o.createdAt >= D.startOfDay()).slice(0, 8);
    return head('Orders', 'Kitchen order tickets from the customer portal and the billing counter, live.',
      `<div class="seg" role="group" aria-label="Order type">${[['all', 'All'], ['dine-in', 'Dine-in'], ['takeaway', 'Takeaway']].map(([k, l]) => `<button data-kf="${k}" aria-pressed="${kf.type === k}">${l}</button>`).join('')}</div>
       <button class="btn ghost sm" data-a="sound" aria-pressed="${soundOn}">${icon(soundOn ? 'sound' : 'mute', 'sm')}${soundOn ? 'Sound on' : 'Sound off'}</button>`) +
      `<div class="board">${lane('new', 'New')}${lane('preparing', 'Preparing')}${lane('ready', 'Ready to serve')}</div>
      ${served.length ? `<div class="box" style="margin-top:14px"><h2>Served today <span class="faint">Latest ${served.length}</span></h2><div class="row wrap">${served.map((o) => `<button class="chip" data-bill="${esc(o.id)}">${esc(o.id)}, ${o.table ? 'T' + o.table : 'TA'}, ${D.time12(o.createdAt)}</button>`).join('')}</div></div>` : ''}`;
  }
  async function advance(id, to) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    try { await D.api.patchOrder(id, { status: to, log: [...(o.log || []), { s: to, at: Date.now() }] }); toast(`${id} ${to === 'preparing' ? 'started' : to === 'ready' ? 'is ready' : 'served'}`); }
    catch (e) { /* handled globally */ }
  }
  async function cancelOrder(id) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    const paid = o.pay && o.pay.status === 'paid';
    const ok = await confirmBox(`Cancel order ${id}? Its ingredients go back into stock.${paid ? ' It was already paid, so it will be marked for refund.' : ''}`, { title: 'Cancel this order?', ok: 'Cancel order', cancel: 'Keep order', danger: true });
    if (!ok) return;
    await D.api.patchOrder(id, { status: 'cancelled', log: [...(o.log || []), { s: 'cancelled', at: Date.now() }], pay: Object.assign({}, o.pay, paid ? { status: 'refunded', refundAt: Date.now() } : {}) });
    toast(`${id} cancelled`);
  }
  function kotText(o) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>KOT ${esc(o.id)}</title><style>body{font-family:ui-monospace,Menlo,monospace;font-size:14px;max-width:300px;margin:10px auto}h1{font-size:20px;margin:0}hr{border:0;border-top:1px dashed #000}li{margin:4px 0}small{display:block;color:#444}</style></head><body>
      <h1>KOT ${esc(o.id)}</h1><div>${o.table ? 'Table ' + o.table : 'Takeaway'}, ${new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</div><hr><ul style="padding-left:18px">${(o.items || []).map((l) => `<li><b>${l.qty} x ${esc(l.name)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ''}</li>`).join('')}</ul><hr></body></html>`;
  }
  function printHtml(html, inner) {
    let area = $('#print-area'); if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    area.innerHTML = inner;
    try { window.print(); } catch (e) { /* ignore */ }
    setTimeout(() => { area.innerHTML = ''; }, 1000);
  }

  /* ---------------- billing (POS) ---------------- */
  function billing() {
    const cats = ['All', ...new Set(S().menu.map((d) => d.category))];
    const ql = pos.q.trim().toLowerCase();
    const tiles = S().menu.filter((d) => (pos.cat === 'All' || d.category === pos.cat) && (!ql || d.name.toLowerCase().includes(ql)));
    const waiting = unpaidOrders();
    return head('Billing', 'Tap dishes to add them. Customer portal orders waiting for payment are listed first.') +
      (waiting.length ? `<div class="box" style="margin-bottom:14px"><h2>${icon('receipt')}Waiting for payment <span class="faint">${waiting.length} bill${waiting.length > 1 ? 's' : ''}</span></h2>
        <div class="row wrap">${waiting.map((o) => `<button class="btn ${o.pay.status === 'pending' ? 'saffron' : 'ghost'} sm" data-collect="${esc(o.id)}">${esc(o.id)}, ${o.table ? 'T' + o.table : 'TA'}, ${D.money(o.total)}${o.pay.status === 'pending' ? ', UPI sent' : ''}</button>`).join('')}</div></div>` : '') +
      `<div class="pos"><div>
        <div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Search dishes" value="${esc(pos.q)}" data-pq aria-label="Search dishes"></label>
        <div class="pills">${cats.map((c) => `<button class="pill" data-pc="${esc(c)}" aria-pressed="${pos.cat === c}">${esc(c)}</button>`).join('')}</div></div>
        <div class="tiles" data-tiles>${tilesHtml(tiles)}</div></div>
        <aside class="box ticket" aria-label="Current bill" data-ticket>${ticketHtml()}</aside></div>`;
  }
  function tilesHtml(tiles) {
    return tiles.map((d) => {
      const s = status(d), q = pos.lines.filter((l) => l.id === d.id).reduce((a, l) => a + l.qty, 0);
      return `<button class="tile${s.ok ? '' : ' off'}" data-padd="${d.id}" ${s.ok ? '' : 'aria-disabled="true"'}>${Viewer.img(d.model, '')}${q ? `<span class="badge q">${q}</span>` : ''}
        <span class="nm">${vmark(d.veg)}<span>${esc(d.name)}</span></span><span class="pr">${D.rupees(d.price)}</span>${s.ok ? (s.low ? `<span class="why" style="color:var(--warn)">${s.portions} left</span>` : '') : `<span class="why">${esc(s.short || s.label)}</span>`}</button>`;
    }).join('') || '<p class="muted">No dishes match.</p>';
  }
  const posLines = () => pos.lines.map((l) => { const d = X().menuById[l.id]; return d ? Object.assign({}, l, { name: d.name, price: d.price, veg: d.veg, model: d.model }) : null; }).filter(Boolean);
  const posBill = () => D.bill(posLines(), { rate: S().settings.gstRate, incl: S().settings.taxInclusive, discPct: pos.discMode === 'pct' ? +pos.disc || 0 : 0, disc: pos.discMode === 'amt' ? Math.round((+pos.disc || 0) * 100) : 0 });
  function ticketHtml() {
    const lines = posLines(), b = posBill(), n = S().settings.tables || 12;
    return `<div class="row" style="margin-bottom:10px"><h2 style="margin:0">Current bill</h2><span class="grow"></span>${lines.length ? `<button class="btn xs ghost" data-a="pclear">Clear</button>` : ''}</div>
      <div class="row wrap" style="margin-bottom:8px"><div class="seg">${[['dine-in', 'Dine-in'], ['takeaway', 'Takeaway']].map(([k, l]) => `<button data-pt="${k}" aria-pressed="${pos.type === k}">${l}</button>`).join('')}</div>
      ${pos.type === 'dine-in' ? `<select class="in" data-ptable style="width:auto;min-height:36px" aria-label="Table"><option value="">Table</option>${Array.from({ length: n }, (_, i) => `<option ${+pos.table === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>` : ''}</div>
      <div class="lines">${lines.length ? lines.map((l, i) => `<div class="tline"><div><div class="nm">${esc(l.name)}</div><div class="sm money">${D.rupees(l.price)}</div></div>
        <div class="mini-step"><button data-pdec="${i}" aria-label="One less">${icon('minus', 'sm')}</button><span>${l.qty}</span><button data-pinc="${i}" aria-label="One more">${icon('plus', 'sm')}</button></div><span class="amt">${D.money(Math.round(l.price * 100) * l.qty)}</span></div>`).join('') : '<p class="muted" style="margin:14px 0">Tap a dish to start a bill.</p>'}</div>
      <div class="row" style="margin:12px 0 8px"><label class="field grow"><span>Discount</span><input class="in" inputmode="decimal" placeholder="0" value="${esc(pos.disc)}" data-pdisc></label>
        <div class="seg" style="align-self:flex-end;margin-bottom:3px"><button data-pdm="pct" aria-pressed="${pos.discMode === 'pct'}">%</button><button data-pdm="amt" aria-pressed="${pos.discMode === 'amt'}">₹</button></div></div>
      <table class="sumtbl" data-ptot>${totRows(b)}</table>
      <div class="paybtns" style="margin-top:12px">
        <button class="btn" data-pay="cash" ${lines.length ? '' : 'disabled'}>${icon('cash')}Cash</button>
        <button class="btn" data-pay="upi" ${lines.length ? '' : 'disabled'}>${icon('upi')}UPI</button>
        <button class="btn" data-pay="card" ${lines.length ? '' : 'disabled'}>${icon('card')}Card</button></div>`;
  }
  const totRows = (b) => `<tbody><tr class="sub"><td>Item total</td><td>${D.money(b.sub, true)}</td></tr>${b.disc ? `<tr class="sub"><td>Discount</td><td>−${D.money(b.disc, true)}</td></tr>` : ''}
    <tr class="sub"><td>CGST ${b.rate / 2}%</td><td>${D.money(b.cgst, true)}</td></tr><tr class="sub"><td>SGST ${b.rate / 2}%</td><td>${D.money(b.sgst, true)}</td></tr>${b.round ? `<tr class="sub"><td>Round off</td><td>${b.round > 0 ? '+' : '−'}${D.money(Math.abs(b.round), true)}</td></tr>` : ''}
    <tr class="total"><td>Total</td><td>${D.money(b.total)}</td></tr></tbody>`;
  function refreshTicket() { const t = $('[data-ticket]', root); if (t) t.innerHTML = ticketHtml(); refreshTiles(); }
  function refreshTiles() { const t = $('[data-tiles]', root); if (!t) return; const ql = pos.q.trim().toLowerCase(); t.innerHTML = tilesHtml(S().menu.filter((d) => (pos.cat === 'All' || d.category === pos.cat) && (!ql || d.name.toLowerCase().includes(ql)))); }
  function posAdd(id) {
    const d = X().menuById[id]; if (!d) return;
    const s = status(d); if (!s.ok) { toast(`${d.name}: ${s.label}`, 'warn'); return; }
    const reserve = {}; for (const l of pos.lines) { const dd = X().menuById[l.id]; for (const r of (dd && dd.recipe) || []) reserve[r.ing] = (reserve[r.ing] || 0) + r.qty * l.qty; }
    if (!D.dishStatus(d, X().stockMap, S().settings, new Date(), reserve).ok) { toast(`Not enough stock for another ${d.name}`, 'warn'); return; }
    const l = pos.lines.find((x) => x.id === id); if (l) l.qty++; else pos.lines.push({ id, qty: 1, note: '' });
    refreshTicket();
  }
  // payment dialog used for new POS bills and for collecting existing orders
  function payDialog(method, amount, ref, onDone) {
    const s = S().settings;
    let body = '';
    if (method === 'cash') {
      const sugg = [amount, Math.ceil(amount / 10000) * 10000, Math.ceil(amount / 50000) * 50000, 200000].filter((v, i, a) => v >= amount && a.indexOf(v) === i).slice(0, 4);
      body = `<div style="font-size:30px;font-weight:700" class="money">${D.money(amount)}</div>
        <label class="field" style="margin-top:12px"><span>Cash received</span><input class="in" inputmode="decimal" value="${(amount / 100).toFixed(0)}" data-recv autofocus></label>
        <div class="row wrap" style="margin-top:8px">${sugg.map((v) => `<button class="btn quiet sm" data-quick="${v}">${D.money(v)}</button>`).join('')}</div>
        <div style="margin-top:12px;font-size:16px">Change to return <b class="money" data-change>₹0</b></div>`;
    } else if (method === 'upi') {
      const link = `upi://pay?pa=${encodeURIComponent((s.upiId || '').toLowerCase()).replace('%40', '@')}&pn=${encodeURIComponent(s.upiName || s.name)}&am=${(amount / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill ' + ref)}&tr=${encodeURIComponent(ref)}`;
      body = `<div class="upi-box"><div class="qr">${QR.svg(link, { margin: 1, dark: '#3E2A1E' })}</div><b>Customer scans to pay ${D.money(amount)}</b><span class="muted">UPI ID ${esc(s.upiId)}, reference ${esc(ref)}</span></div>
        <div class="testnote" style="margin-top:10px">${icon('info', 'sm')}<span>Confirm only after the payment shows in your UPI app or soundbox.</span></div>
        <label class="field" style="margin-top:10px"><span>UPI reference (optional)</span><input class="in" data-uref placeholder="12-digit UTR"></label>`;
    } else {
      body = `<div style="font-size:30px;font-weight:700" class="money">${D.money(amount)}</div><p class="muted">Take the payment on your card terminal, then record it here.</p>
        <label class="field"><span>Last 4 digits of the card (optional)</span><input class="in" inputmode="numeric" maxlength="4" data-l4></label>`;
    }
    const m = modal({
      title: { cash: 'Cash payment', upi: 'UPI payment', card: 'Card payment' }[method], body,
      actions: [{ label: 'Back' }, {
        label: method === 'cash' ? 'Complete sale' : 'Payment received', cls: 'saffron', onClick: (mm) => {
          const pay = { method, status: 'paid', at: Date.now(), by: 'staff' };
          if (method === 'cash') { const recv = Math.round((parseFloat($('[data-recv]', mm.el).value) || 0) * 100); if (recv < amount) { toast('Cash received is less than the total', 'warn'); return false; } pay.received = recv; pay.change = recv - amount; }
          if (method === 'upi') pay.ref = ($('[data-uref]', mm.el).value || '').trim() || ref;
          if (method === 'card') { pay.last4 = ($('[data-l4]', mm.el).value || '').replace(/\D/g, '').slice(-4); pay.ref = 'POS'; }
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
  }
  async function posCharge(method) {
    const lines = posLines(); if (!lines.length) return;
    if (pos.type === 'dine-in' && !pos.table) { toast('Choose the table first', 'warn'); const sel = $('[data-ptable]', root); if (sel) sel.focus(); return; }
    const b = posBill();
    const tmpRef = (S().settings.prefix || 'KM') + 'P' + Date.now().toString(36).toUpperCase().slice(-5);
    payDialog(method, b.total, tmpRef, async (pay) => {
      try {
        const no = await D.api.nextNo(), now = Date.now(), ids = D.orderIds(no, S().settings.prefix || 'KM', now);
        const order = Object.assign({ id: ids.id, no, inv: ids.inv, createdAt: now, table: pos.type === 'dine-in' ? +pos.table : null, type: pos.type, source: 'pos', customer: null,
          items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, note: l.note || '', veg: l.veg, model: l.model })), status: 'new', log: [{ s: 'new', at: now }],
          use: D.consumption(lines, X().menuById), pay, note: '' }, b);
        await D.api.putOrder(order);
        pos.lines = []; pos.disc = ''; pos.table = '';
        refreshTicket();
        receiptDialog(order, pay.change);
      } catch (e) { toast('Could not save the bill. Try again.', 'bad'); }
    });
  }
  function collect(id) {
    const o = S().orders.find((x) => x.id === id); if (!o) return;
    if (o.pay && o.pay.status === 'pending') {
      return modal({ title: `Confirm UPI for ${o.id}`, body: `<p class="muted" style="margin-top:0">The customer says they paid <b class="money">${D.money(o.total)}</b> by UPI${o.pay.ref ? ` with reference <b>${esc(o.pay.ref)}</b>` : ''}. Check your UPI app or soundbox before confirming.</p>`,
        actions: [{ label: 'Not received', cls: 'ghost', onClick: async () => { await D.api.patchOrder(o.id, { pay: Object.assign({}, o.pay, { status: 'unpaid', claimed: false }) }); toast('Marked as not paid'); } },
          { label: 'Collect another way', cls: 'ghost', onClick: () => { setTimeout(() => chooseCollect(o), 50); } },
          { label: 'Payment received', cls: 'saffron', onClick: async () => { await D.api.patchOrder(o.id, { pay: Object.assign({}, o.pay, { status: 'paid', at: Date.now(), by: 'staff' }) }); toast(`${o.id} paid`); } }] });
    }
    chooseCollect(o);
  }
  function chooseCollect(o) {
    const m = modal({ title: `Collect ${D.money(o.total)} for ${o.id}`, body: `<div class="paybtns">${['cash', 'upi', 'card'].map((k) => `<button class="btn" data-cm="${k}">${icon(k)}${k === 'upi' ? 'UPI' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`, foot: false });
    m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-cm]'); if (!b) return; m.close(); payDialog(b.dataset.cm, o.total, o.id, async (pay) => { await D.api.patchOrder(o.id, { pay }); toast(`${o.id} paid`); const fresh = Object.assign({}, o, { pay }); receiptDialog(fresh, pay.change); }); });
  }
  function receiptDialog(o, change) {
    const m = modal({
      title: `Bill ${o.id}`, body: `${change ? `<div class="banner info" style="margin-bottom:12px">${icon('cash')}<span>Return change of <b class="money">${D.money(change)}</b></span></div>` : ''}${Invoice.lines(o, S().settings)}`,
      actions: [...(UI.canPrint() ? [{ label: 'Print', icon: 'print', cls: 'ghost', close: false, onClick: () => printHtml(null, Invoice.lines(o, S().settings)) }] : []),
        { label: 'Download', icon: 'download', cls: 'ghost', close: false, onClick: () => { UI.download(`${o.id}-bill.html`, Invoice.html(o, S().settings), 'text/html'); } },
        { label: 'Done', cls: '' }],
    });
    return m;
  }

  /* ---------------- bills ---------------- */
  function billsFiltered() {
    const r = rangeOf(bf.range), ql = bf.q.trim().toLowerCase();
    return S().orders.filter((o) => inRange(o, r) && (bf.status === 'all' || (bf.status === 'unpaid' ? o.status !== 'cancelled' && o.pay && o.pay.status !== 'paid' && o.pay.status !== 'refunded' : bf.status === 'paid' ? o.pay && o.pay.status === 'paid' && o.status !== 'cancelled' : o.status === 'cancelled' || (o.pay && o.pay.status === 'refunded')))
      && (!ql || o.id.toLowerCase().includes(ql) || String(o.table || '').includes(ql) || (o.items || []).some((l) => l.name.toLowerCase().includes(ql))));
  }
  function payCell(o) {
    const p = o.pay || {};
    const m = { upi: 'UPI', card: 'Card', cash: 'Cash', counter: 'Counter' }[p.method] || '';
    if (o.status === 'cancelled') return `<span class="chip">${p.status === 'refunded' ? 'Refunded' : 'Cancelled'}</span>`;
    return p.status === 'paid' ? `<span class="chip ok">${m}</span>` : p.status === 'pending' ? '<span class="chip warn">UPI to confirm</span>' : p.status === 'refunded' ? '<span class="chip">Refunded</span>' : '<span class="chip bad">Unpaid</span>';
  }
  function stChip(o) { const m = { new: ['new', 'New'], preparing: ['info', 'Preparing'], ready: ['ok', 'Ready'], served: ['', 'Served'], cancelled: ['bad', 'Cancelled'] }[o.status] || ['', o.status]; return `<span class="chip ${m[0]}">${m[1]}</span>`; }
  function bills() {
    const list = billsFiltered(), tot = sumBy(list.filter(sales), (o) => o.total);
    return head('Bills', `${list.length} bill${list.length === 1 ? '' : 's'}, ${D.money(tot)} in sales for this view.`, `<button class="btn ghost sm" data-a="bcsv">${icon('download', 'sm')}Export CSV</button>`) +
      `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Order ID, table or dish" value="${esc(bf.q)}" data-bq aria-label="Search bills"></label>
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
    if (canCollect) acts.push({ label: p.status === 'pending' ? 'Confirm UPI' : 'Collect payment', cls: 'saffron', onClick: () => { setTimeout(() => collect(o.id), 30); } });
    if (o.status !== 'cancelled') acts.push({ label: 'Cancel order', cls: 'danger ghost', onClick: () => { setTimeout(() => cancelOrder(o.id), 30); } });
    if (p.status === 'paid' && o.status !== 'cancelled') acts.push({ label: 'Refund', cls: 'ghost', onClick: async () => { const ok = await confirmBox(`Refund ${D.money(o.total)} for ${o.id}? Return the money the same way it was paid.`, { title: 'Refund this bill?', ok: 'Mark refunded', danger: true }); if (ok) { await D.api.patchOrder(o.id, { pay: Object.assign({}, p, { status: 'refunded', refundAt: Date.now() }) }); toast(`${o.id} refunded`); } } });
    acts.push({ label: 'Download', icon: 'download', cls: 'ghost', close: false, onClick: () => { UI.download(`${o.id}-bill.html`, Invoice.html(o, S().settings), 'text/html'); } });
    if (UI.canPrint()) acts.push({ label: 'Print', icon: 'print', cls: 'ghost', close: false, onClick: () => printHtml(null, Invoice.lines(o, S().settings)) });
    modal({ title: `Bill ${o.id}`, body: `<div class="row wrap" style="margin-bottom:12px">${stChip(o)}${payCell(o)}<span class="chip">${o.source === 'portal' ? 'Customer portal' : 'Counter'}</span>${(o.log || []).map((l) => `<span class="faint" style="font-size:12.5px">${l.s} ${D.time12(l.at)}</span>`).join('')}</div>${Invoice.lines(o, S().settings)}`, actions: acts });
  }
  function csv(rows) { return rows.map((r) => r.map((v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n'); }
  function exportBills() {
    const list = billsFiltered();
    const rows = [['Invoice', 'Order', 'Date', 'Time', 'Table', 'Type', 'Items', 'Sub total', 'Discount', 'Taxable', 'CGST', 'SGST', 'Round off', 'Total', 'Payment', 'Payment status', 'Order status', 'Source']];
    for (const o of list) rows.push([o.inv, o.id, D.dayKey(o.createdAt), D.time12(o.createdAt), o.table || '', o.type, (o.items || []).map((l) => `${l.qty} x ${l.name}`).join('; '), (o.sub / 100).toFixed(2), ((o.disc || 0) / 100).toFixed(2), (o.taxable / 100).toFixed(2), (o.cgst / 100).toFixed(2), (o.sgst / 100).toFixed(2), ((o.round || 0) / 100).toFixed(2), (o.total / 100).toFixed(2), (o.pay || {}).method || '', (o.pay || {}).status || '', o.status, o.source]);
    UI.download(`bills-${bf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }

  /* ---------------- menu ---------------- */
  function menuPage() {
    const cats = ['All', ...new Set(S().menu.map((d) => d.category))];
    const ql = mf.q.trim().toLowerCase();
    const list = S().menu.filter((d) => (mf.cat === 'All' || d.category === mf.cat) && (!ql || d.name.toLowerCase().includes(ql)));
    return head('Menu', 'Dishes, prices, 3D models and recipes. Recipes drive stock and sold-out status automatically.', `<button class="btn" data-a="dnew">${icon('plus')}Add dish</button>`) + modeBanner() +
      `<div class="toolbar"><label class="search">${icon('search')}<input type="search" placeholder="Search menu" value="${esc(mf.q)}" data-mq aria-label="Search menu"></label>
        <div class="pills">${cats.map((c) => `<button class="pill" data-mc="${esc(c)}" aria-pressed="${mf.cat === c}">${esc(c)}</button>`).join('')}</div></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>Dish</th><th>Category</th><th class="r">Price</th><th class="r">Food cost</th><th class="r">Margin</th><th>Available now</th><th>On menu</th><th></th></tr></thead><tbody>
      ${list.map((d) => {
        const s = status(d), fc = D.foodCost(d, X().stockById), price = Math.round(d.price * 100), mg = price ? Math.round(((price - fc) / price) * 100) : 0;
        const av = s.ok ? `<span class="chip ok">${s.portions != null ? `${s.portions} left` : 'Yes'}</span>` : `<span class="chip ${s.reason === 'time' ? 'warn' : 'bad'}">${esc(s.short || s.label)}</span>`;
        return `<tr><td style="width:56px">${Viewer.img(d.model, '').replace('<img', '<img style="width:48px;height:48px;object-fit:contain"')}</td><td><div class="row" style="gap:7px">${vmark(d.veg)}<b>${esc(d.name)}</b></div>${d.from ? `<span class="faint" style="font-size:12.5px">${D.hm(d.from)} to ${D.hm(d.to)}</span>` : ''}</td>
          <td>${esc(d.category)}</td><td class="r money">${D.rupees(d.price)}</td><td class="r money">${D.money(fc, true)}</td><td class="r ${mg < 60 ? '' : ''}">${mg}%</td><td>${av}</td>
          <td><label class="switch"><input type="checkbox" ${d.active !== false ? 'checked' : ''} data-dact="${d.id}" aria-label="Show ${esc(d.name)} on the menu"></label></td>
          <td><button class="btn xs ghost" data-dedit="${d.id}">${icon('edit', 'sm')}Edit</button></td></tr>`;
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
      if (!d.id) { let base = slug(name), idn = base, k = 2; while (X().menuById[idn]) idn = base + '-' + k++; d.id = idn; }
      try { await D.api.putDish(d); toast(`${name} saved`); } catch (e) { return false; }
    }
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
          <td><div class="row" style="gap:6px;justify-content:flex-end"><button class="btn xs" data-sbuy="${s.id}">${icon('plus', 'sm')}Purchase</button><button class="btn xs ghost" data-swaste="${s.id}">Wastage</button><button class="btn xs ghost" data-scount="${s.id}">Count</button><button class="btn xs ghost icon" data-sedit="${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit', 'sm')}</button></div></td></tr>`;
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
      body = `<div class="dash"><div class="box"><h2>Stock movements <span class="faint">Purchases, wastage and counts</span></h2>${S().ledger.length ? `<div class="tblwrap" style="border:0"><table class="tbl"><thead><tr><th>When</th><th>Ingredient</th><th>Type</th><th class="r">Change</th><th>Note</th></tr></thead><tbody>
        ${S().ledger.slice(0, 80).map((e) => { const s = X().stockById[e.ing]; return `<tr><td>${D.dateShort(e.at)}, ${D.time12(e.at)}</td><td>${esc(s ? s.name : e.ing)}</td><td>${{ purchase: '<span class="chip ok">Purchase</span>', waste: '<span class="chip bad">Wastage</span>', count: '<span class="chip info">Count</span>' }[e.type] || esc(e.type)}</td><td class="r num">${e.qty > 0 ? '+' : ''}${s ? fmtQty(e.qty, s.unit) : e.qty}</td><td class="muted">${esc(e.note || '')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No purchases, wastage or counts recorded yet.</p>'}</div>
        <div class="box"><h2>Used today <span class="faint">From today’s orders</span></h2>${usedRows.length ? hbars(usedRows.slice(0, 12).map((r) => ({ l: r.s.name, v: r.v * (r.s.cost || 0), q: r.v, u: r.s.unit })), (r) => fmtQty(r.q, r.u)) : '<p class="muted" style="margin:0">Nothing used yet today.</p>'}</div></div>`;
    }
    return head('Stock', 'Every order deducts its recipe from stock. Dishes sell out on their own when an ingredient runs out.', `<button class="btn" data-a="snew">${icon('plus')}Add ingredient</button>`) +
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
    const gross = sumBy(good, (o) => o.total), taxable = sumBy(good, (o) => o.taxable), gst = sumBy(good, (o) => o.cgst + o.sgst), disc = sumBy(good, (o) => o.disc || 0);
    const refunds = list.filter((o) => o.pay && o.pay.status === 'refunded'), cancelled = list.filter((o) => o.status === 'cancelled');
    const days = []; for (let t = D.startOfDay(r[0] || (good.length ? good[good.length - 1].createdAt : Date.now())); t < r[1]; t += 864e5) days.push(t);
    const byDay = days.slice(-62).map((t) => { const l = good.filter((o) => o.createdAt >= t && o.createdAt < t + 864e5); return { t, l, v: sumBy(l, (o) => o.total) }; });
    const items = {}; for (const o of good) for (const l of o.items || []) { const k = l.id; items[k] = items[k] || { name: l.name, q: 0, v: 0, cat: (X().menuById[l.id] || {}).category || 'Other' }; items[k].q += l.qty; items[k].v += Math.round(l.price * 100) * l.qty; }
    const itemRows = Object.entries(items).sort((a, b) => b[1].v - a[1].v);
    const catSum = {}; for (const [, it] of itemRows) catSum[it.cat] = (catSum[it.cat] || 0) + it.v;
    const itemTot = sumBy(itemRows, ([, it]) => it.v) || 1;
    let cogs = 0; for (const [id, it] of itemRows) { const d = X().menuById[id]; if (d) cogs += D.foodCost(d, X().stockById) * it.q; }
    const paidL = good.filter((o) => o.pay && o.pay.status === 'paid');
    const pay = ['upi', 'card', 'cash'].map((k) => ({ l: { upi: 'UPI', card: 'Card', cash: 'Cash' }[k], c: C[k], v: sumBy(paidL.filter((o) => o.pay.method === k), (o) => o.total) }));
    const unpaid = sumBy(good.filter((o) => o.pay && o.pay.status !== 'paid'), (o) => o.total);
    return head('Reports', 'Sales, GST and food cost for the period. Cancelled and refunded bills are left out of sales.', `<button class="btn ghost sm" data-a="gstcsv">${icon('download', 'sm')}GST summary CSV</button><button class="btn ghost sm" data-a="itemcsv">${icon('download', 'sm')}Item sales CSV</button>`) +
      `<div class="toolbar"><div class="pills">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']].map(([k, l]) => `<button class="pill" data-rr="${k}" aria-pressed="${rf.range === k}">${l}</button>`).join('')}</div></div>
      <div class="kpis"><div class="kpi"><div class="l">Gross sales</div><div class="v money">${D.money(gross)}</div><div class="d">${good.length} bills</div></div>
        <div class="kpi"><div class="l">Net sales, before GST</div><div class="v money">${D.money(taxable)}</div><div class="d">${disc ? `${D.money(disc)} in discounts` : 'No discounts'}</div></div>
        <div class="kpi"><div class="l">GST collected</div><div class="v money">${D.money(gst)}</div><div class="d">CGST ${D.money(gst / 2)}, SGST ${D.money(gst / 2)}</div></div>
        <div class="kpi"><div class="l">Food cost estimate</div><div class="v money">${D.money(Math.round(cogs / 100) * 100)}</div><div class="d">${taxable ? Math.round((cogs / taxable) * 100) + '% of net sales, from recipes' : 'From recipes'}</div></div></div>
      ${good.length ? `<div class="dash"><div class="col">
        <div class="box"><h2>Daily sales <span class="faint">GST included</span></h2>${columns(byDay.map((d) => ({ l: new Date(d.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), v: d.v, tip: `<b>${D.money(d.v)}</b> on ${D.dateShort(d.t)}, ${d.l.length} bills` })), { label: 'Daily sales', fmtAxis: (v) => D.compact(v), maxLabels: 8 })}</div>
        <div class="box"><h2>Item sales</h2><div class="tblwrap" style="border:0;max-height:420px"><table class="tbl"><thead><tr><th>Dish</th><th class="r">Qty</th><th class="r">Sales</th><th class="r">Share</th></tr></thead><tbody>
          ${itemRows.map(([, it]) => `<tr><td>${esc(it.name)}</td><td class="r num">${it.q}</td><td class="r money">${D.money(it.v)}</td><td class="r num">${Math.round((it.v / itemTot) * 100)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="box"><h2>GST summary <span class="faint">For GSTR-1 and GSTR-3B, SAC ${esc(S().settings.sac || '996331')}</span></h2><div class="tblwrap" style="border:0;max-height:360px"><table class="tbl"><thead><tr><th>Date</th><th class="r">Bills</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">Total</th></tr></thead><tbody>
          ${byDay.filter((d) => d.l.length).reverse().map((d) => `<tr><td>${D.dateShort(d.t)}</td><td class="r num">${d.l.length}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.taxable), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.cgst), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.sgst), true)}</td><td class="r money">${D.money(sumBy(d.l, (o) => o.total), true)}</td></tr>`).join('')}
          <tr><td><b>Total</b></td><td class="r num"><b>${good.length}</b></td><td class="r money"><b>${D.money(taxable, true)}</b></td><td class="r money"><b>${D.money(sumBy(good, (o) => o.cgst), true)}</b></td><td class="r money"><b>${D.money(sumBy(good, (o) => o.sgst), true)}</b></td><td class="r money"><b>${D.money(gross, true)}</b></td></tr></tbody></table></div></div>
      </div><div class="col">
        <div class="box"><h2>By category</h2>${hbars(Object.entries(catSum).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v })), (r2) => D.money(r2.v))}</div>
        <div class="box"><h2>By payment <span class="faint">Paid bills</span></h2>${sumBy(pay, (p) => p.v) ? split(pay) : '<p class="muted" style="margin:0">No paid bills in this period.</p>'}${unpaid ? `<p class="muted" style="margin:10px 0 0">${D.money(unpaid)} not yet paid.</p>` : ''}</div>
        <div class="box"><h2>Adjustments</h2><div class="attn"><div style="display:flex;justify-content:space-between;padding:6px"><span>Cancelled orders</span><b class="num">${cancelled.length}</b></div><div style="display:flex;justify-content:space-between;padding:6px"><span>Refunds</span><b class="money">${D.money(sumBy(refunds, (o) => o.total))}</b></div><div style="display:flex;justify-content:space-between;padding:6px"><span>Discounts given</span><b class="money">${D.money(disc)}</b></div></div></div>
      </div></div>` : `<div class="box"><div class="empty">${icon('chart')}<h2>No sales in this period</h2><p>Pick a longer period, or add sample sales in Setup.</p></div></div>`}`;
  }
  function exportGST() {
    const r = rangeOf(rf.range), good = S().orders.filter((o) => inRange(o, r) && sales(o));
    const by = {}; for (const o of good) { const k = D.dayKey(o.createdAt); by[k] = by[k] || { n: 0, t: 0, c: 0, s: 0, g: 0 }; by[k].n++; by[k].t += o.taxable; by[k].c += o.cgst; by[k].s += o.sgst; by[k].g += o.total; }
    const rows = [['Date', 'Bills', 'Taxable value', 'CGST', 'SGST', 'Total', 'SAC', 'GST rate']];
    for (const k of Object.keys(by).sort()) rows.push([k, by[k].n, (by[k].t / 100).toFixed(2), (by[k].c / 100).toFixed(2), (by[k].s / 100).toFixed(2), (by[k].g / 100).toFixed(2), S().settings.sac || '996331', S().settings.gstRate + '%']);
    UI.download(`gst-summary-${rf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }
  function exportItems() {
    const r = rangeOf(rf.range), good = S().orders.filter((o) => inRange(o, r) && sales(o)), items = {};
    for (const o of good) for (const l of o.items || []) { items[l.name] = items[l.name] || [0, 0]; items[l.name][0] += l.qty; items[l.name][1] += Math.round(l.price * 100) * l.qty; }
    const rows = [['Dish', 'Quantity', 'Sales before GST']]; for (const [k, v] of Object.entries(items).sort((a, b) => b[1][1] - a[1][1])) rows.push([k, v[0], (v[1] / 100).toFixed(2)]);
    UI.download(`item-sales-${rf.range}-${D.dayKey(Date.now())}.csv`, csv(rows), 'text/csv');
  }

  /* ---------------- tables & QR ---------------- */
  function portalBase() { const s = S().settings; if (s.portalUrl) return s.portalUrl.replace(/#.*$/, ''); return location.href.replace(/#.*$/, ''); }
  function tables() {
    const s = S().settings, n = s.tables || 12, base = portalBase();
    return head('Tables & QR', 'Print a QR card for each table. Guests scan it to open the menu with their table already set.', `<button class="btn" data-a="qrsheet">${icon('download')}Printable QR sheet</button>`) +
      `<div class="box" style="margin-bottom:14px;display:grid;gap:12px"><div class="grid2" style="grid-template-columns:160px 1fr"><label class="field"><span>Number of tables</span><input class="in" inputmode="numeric" value="${n}" data-tn></label>
        <label class="field"><span>Menu link the QR codes open</span><input class="in" value="${esc(s.portalUrl || '')}" placeholder="${esc(base)}" data-tu><small>Leave empty to use this page’s link. If you host the menu on your own website, paste its address here.</small></label></div>
        <div><button class="btn sm" data-a="tsave">Save</button></div></div>
      <div class="qrgrid">${Array.from({ length: n }, (_, i) => { const url = `${base}#table-${i + 1}`; return `<div class="qrcard"><b>Table ${i + 1}</b><div class="qr">${QR.svg(url, { margin: 1, dark: '#3E2A1E', label: `QR code for table ${i + 1}` })}</div><span class="faint" style="font-size:12.5px">Scan to see dishes on your table</span><a class="btn xs ghost" href="#table-${i + 1}">Open as Table ${i + 1}</a></div>`; }).join('')}
      <div class="qrcard"><b>Takeaway</b><div class="qr">${QR.svg(`${base}#menu`, { margin: 1, dark: '#3E2A1E' })}</div><span class="faint" style="font-size:12.5px">For the counter and the window</span><a class="btn xs ghost" href="#menu">Open menu</a></div></div>`;
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
          <label class="field"><span>Staff PIN</span><input class="in" name="pin" inputmode="numeric" maxlength="4" value="${esc(s.pin || '1234')}"></label></div>
        <div class="box"><h2>Data</h2><p class="muted" style="margin:0">${supa() ? 'Orders, menu and stock live in your Supabase project and sync to every phone and counter in real time.' : S().mode === 'cloud' ? 'Orders, menu and stock are shared live between every device that opens this page while signed in to Claude.' : 'Data is saved in this browser. To share orders between phones and the counter, connect a shared database or open this page inside Claude.'}</p>
          <div class="row wrap"><button type="button" class="btn ghost sm" data-a="sample">${icon('chart', 'sm')}Add sample sales</button>${demo ? `<button type="button" class="btn ghost sm" data-a="unsample">${icon('trash', 'sm')}Remove ${demo} sample sales</button>` : ''}
          <button type="button" class="btn ghost sm" data-a="seed">${icon('refresh', 'sm')}${S().menu.length ? 'Reset menu and stock' : 'Load starter menu'}</button><button type="button" class="btn ghost sm" data-a="export">${icon('download', 'sm')}Export all data</button></div></div>
      </form>`;
  }
  async function saveSetup() {
    const fm = $('[data-sform]', root); if (!fm) return;
    const v = (n) => (fm.elements[n].type === 'checkbox' ? fm.elements[n].checked : fm.elements[n].value.trim());
    const patch = { name: v('name'), tagline: v('tagline'), address: v('address'), phone: v('phone'), gstin: v('gstin').toUpperCase(), fssai: v('fssai'), gstRate: +v('gstRate'), sac: v('sac'), taxInclusive: v('taxInclusive'), upiId: v('upiId'), upiName: v('upiName'), prefix: v('prefix').toUpperCase().replace(/[^A-Z]/g, '') || 'KM', tables: Math.max(1, Math.min(99, parseInt(v('tables'), 10) || 12)), timeMenus: v('timeMenus'), pin: v('pin') };
    if (!patch.name) return toast('Enter the café name', 'warn');
    if (!/^\d{4}$/.test(patch.pin)) return toast('The staff PIN needs 4 digits', 'warn');
    if (patch.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(patch.upiId)) return toast('That UPI ID doesn’t look right, for example yourcafe@okaxis', 'warn');
    if (patch.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(patch.gstin)) return toast('A GSTIN has 15 characters, for example 29ABCDE1234F1Z5', 'warn');
    if (patch.fssai && !/^\d{14}$/.test(patch.fssai)) return toast('The FSSAI number has 14 digits', 'warn');
    try { await D.api.setSettings(patch); toast('Settings saved'); } catch (e) { /* handled */ }
  }

  /* ---------------- actions ---------------- */
  async function act(a, el) {
    if (a === 'lock') { if (supa()) D.api.adapter.signOut().catch(() => {}); unlocked = false; try { sessionStorage.removeItem('km.staff'); } catch (e) { /* ignore */ } render(); }
    if (a === 'side') { sideOpen = !sideOpen; $('.side', root).classList.toggle('open', sideOpen); }
    if (a === 'sound') { soundOn = !soundOn; if (soundOn) { UI.unlockAudio(); UI.chime(); } render(); }
    if (a === 'pclear') { pos.lines = []; pos.disc = ''; refreshTicket(); }
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
    if (!unlocked) { const p = t.closest('[data-pin]'); if (p) pinPress(p.dataset.pin); return; }
    const g = (sel) => t.closest(sel);
    let el;
    if ((el = g('[data-a]'))) return act(el.dataset.a, el);
    if ((el = g('[data-next]'))) return advance(el.dataset.next, el.dataset.to);
    if ((el = g('[data-cancel]'))) return cancelOrder(el.dataset.cancel);
    if ((el = g('[data-kot]'))) { const o = S().orders.find((x) => x.id === el.dataset.kot); if (o) { if (UI.canPrint()) printHtml(null, kotText(o).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '')); else UI.download(`KOT-${o.id}.html`, kotText(o), 'text/html'); } return; }
    if ((el = g('[data-kf]'))) { kf.type = el.dataset.kf; return render(); }
    if ((el = g('[data-bill]'))) return billDialog(el.dataset.bill);
    if ((el = g('[data-collect]'))) return collect(el.dataset.collect);
    if ((el = g('[data-padd]'))) return posAdd(el.dataset.padd);
    if ((el = g('[data-pinc]'))) { const l = pos.lines[+el.dataset.pinc]; if (l) posAdd(l.id); return; }
    if ((el = g('[data-pdec]'))) { const i = +el.dataset.pdec; if (pos.lines[i]) { pos.lines[i].qty--; if (pos.lines[i].qty <= 0) pos.lines.splice(i, 1); } return refreshTicket(); }
    if ((el = g('[data-pt]'))) { pos.type = el.dataset.pt; return refreshTicket(); }
    if ((el = g('[data-pdm]'))) { pos.discMode = el.dataset.pdm; return refreshTicket(); }
    if ((el = g('[data-pc]'))) { pos.cat = el.dataset.pc; $$('[data-pc]', root).forEach((b) => b.setAttribute('aria-pressed', b === el)); return refreshTiles(); }
    if ((el = g('[data-pay]'))) return posCharge(el.dataset.pay);
    if ((el = g('[data-br]'))) { bf.range = el.dataset.br; return render(); }
    if ((el = g('[data-bs]'))) { bf.status = el.dataset.bs; return render(); }
    if ((el = g('[data-mc]'))) { mf.cat = el.dataset.mc; return render(); }
    if ((el = g('[data-dedit]'))) return dishEditor(el.dataset.dedit);
    if ((el = g('[data-st]'))) { sf.tab = el.dataset.st; return render(); }
    if ((el = g('[data-sbuy]'))) return stockDialog('buy', el.dataset.sbuy, +el.dataset.sugg || 0);
    if ((el = g('[data-swaste]'))) return stockDialog('waste', el.dataset.swaste);
    if ((el = g('[data-scount]'))) return stockDialog('count', el.dataset.scount);
    if ((el = g('[data-sedit]'))) return ingredientEditor(el.dataset.sedit);
    if ((el = g('[data-rr]'))) { rf.range = el.dataset.rr; return render(); }
    if (sideOpen && g('.side a')) { sideOpen = false; }
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-pq]')) { pos.q = t.value; refreshTiles(); }
    if (t.matches('[data-pdisc]')) { pos.disc = t.value; const tb = $('[data-ptot]', root); if (tb) tb.innerHTML = totRows(posBill()); }
    if (t.matches('[data-bq]')) { bf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-bq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    if (t.matches('[data-mq]')) { mf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-mq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
    if (t.matches('[data-sq]')) { sf.q = t.value; clearTimeout(onInput.t); onInput.t = setTimeout(() => { render(); const i = $('[data-sq]', root); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-ptable]')) pos.table = t.value;
    if (t.matches('[data-dact]')) { const d = X().menuById[t.dataset.dact]; if (d) D.api.putDish(Object.assign({}, d, { active: t.checked })).then(() => toast(`${d.name} ${t.checked ? 'is on the menu' : 'is hidden from the menu'}`)); }
  }
  function onKey(e) { if (e.key === 'Enter' && e.target.matches('tr[data-bill]')) billDialog(e.target.dataset.bill); }

  /* ---------------- new-order alerts ---------------- */
  function watch() {
    const list = S().orders;
    if (!primed) { if (S().ready && (S().mode !== 'cloud' || S().synced)) { list.forEach((o) => seen.add(o.id)); primed = true; } return; }
    for (const o of list) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      if (o.status === 'new' && Date.now() - o.createdAt < 5 * 60000 && unlocked && document.body.classList.contains('s-mode') && o.source === 'portal') {
        toast(`New order ${o.id}, ${o.table ? 'Table ' + o.table : 'Takeaway'}, ${D.money(o.total)}`, 'ok', 5000);
        if (soundOn) UI.chime();
      }
    }
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
