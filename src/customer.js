'use strict';
/* Customer portal: menu, dish sheet, AR table view, cart, payment, bills */
const Cust = (() => {
  const { $, $$, esc, icon, vmark, toast, modal } = UI;
  const D = Data;
  let root = null, view = 'menu', cat = 'All', q = '', vegOnly = false, payMethod = 'upi';
  let cart = { lines: [], table: null, type: 'dine-in', pickup: 0, phone: '', redeem: false };
  let heroKey = null, openSheet = null, lastSeen = {};
  const CK = 'km.cart.v2', IDK = 'km.cid';

  /* ---------- persistence (this device only: cart + who I am) ---------- */
  try { const c = JSON.parse(D.safeLS.get(CK) || 'null'); if (c && Array.isArray(c.lines)) cart = Object.assign(cart, c); } catch (e) { /* ignore */ }
  const saveCart = () => D.safeLS.set(CK, JSON.stringify(cart));
  let localId = D.safeLS.get(IDK);
  if (!localId) { localId = D.rid('c_'); D.safeLS.set(IDK, localId); }
  const me = () => D.state.uid || localId;

  /* ---------- helpers ---------- */
  const S = () => D.state, X = () => D.derived();
  const qty = (id) => cart.lines.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0);
  const lineCount = () => cart.lines.reduce((s, l) => s + l.qty, 0);
  const cartLines = () => cart.lines.map((l) => { const d = X().menuById[l.id]; return d ? Object.assign({}, l, { name: d.name, price: d.price + (Number(l.add) || 0), veg: d.veg, model: d.model }) : null; }).filter(Boolean);
  const hasOpts = (d) => D.optionGroups(d).length > 0;
  const optLine = (l) => ((l.opts || []).length ? `<div class="opts">${esc(l.opts.join(', '))}</div>` : '');
  const lineSel = (l) => ({ opts: l.opts || [], add: Number(l.add) || 0, r: l.xr || {} });
  /* rewards: phone number on this device, balance derived from orders */
  const rewards = () => { const st = S().settings; if (st.loyalty === false) return null; const ph = D.cleanPhone(cart.phone); return Object.assign({ phone: ph }, D.beans(ph, S().orders, st)); };
  const redeemPaise = () => {
    const st = S().settings, rw = rewards(); if (!rw || !cart.redeem || !rw.phone) return 0;
    const need = Number(st.redeemBeans) || 100, val = Math.round((Number(st.redeemValue) || 50) * 100);
    const sub = cartLines().reduce((a, l) => a + Math.round(l.price * 100) * l.qty, 0);
    return rw.balance >= need && sub > val ? val : 0;
  };
  const cartBill = () => D.bill(cartLines(), { rate: S().settings.gstRate, incl: S().settings.taxInclusive, disc: redeemPaise() });
  const reserveFor = (exceptId) => { const r = {}; for (const l of cart.lines) { if (l.id === exceptId) continue; const d = X().menuById[l.id]; if (!d) continue; for (const x of d.recipe || []) r[x.ing] = (r[x.ing] || 0) + x.qty * l.qty; for (const k in l.xr || {}) r[k] = (r[k] || 0) + l.xr[k] * l.qty; } return r; };
  const status = (d) => D.dishStatus(d, X().stockMap, S().settings, new Date());
  const cats = () => { const set = []; for (const d of S().menu) if (!set.includes(d.category)) set.push(d.category); return set; };
  function add(d, n = 1, note = '', sel = null) {
    sel = sel || D.resolveOpts(d);
    const key = sel.opts.join('|');
    const st = status(d);
    if (n > 0 && !st.ok) { toast(`${d.name}: ${st.label}`, 'warn'); return false; }
    if (n > 0) {
      const after = D.dishStatus(d, X().stockMap, S().settings, new Date(), reserveFor(null));
      if (!after.ok) { toast(`Only ${qty(d.id)} ${d.name} left today`, 'warn'); return false; }
    }
    let l = cart.lines.find((x) => x.id === d.id && (x.note || '') === (note || '') && (x.opts || []).join('|') === key);
    if (!l && n < 0) l = cart.lines.filter((x) => x.id === d.id).pop();
    if (!l && n > 0) { l = { id: d.id, qty: 0, note: note || '', opts: sel.opts, add: sel.add, xr: sel.r }; cart.lines.push(l); }
    if (!l) return false;
    l.qty += n;
    if (l.qty <= 0) cart.lines = cart.lines.filter((x) => x !== l);
    saveCart(); refreshBits(); return true;
  }

  /* ---------- layout ---------- */
  function nav() {
    const n = lineCount();
    const item = (h, ic, label, extra = '') => `<a href="#${h}" ${view === h ? 'aria-current="page"' : ''} ${extra}>${ic}<span>${label}</span></a>`;
    return `<nav class="bnav" aria-label="Customer">
      ${item('menu', icon('utensils'), 'Menu')}
      <a href="#ar" class="cam" ${view === 'ar' ? 'aria-current="page"' : ''}><span class="ring">${icon('camera')}</span><span>Table view</span></a>
      <a href="#cart" ${view === 'cart' ? 'aria-current="page"' : ''}>${icon('bag')}<span>Order</span>${n ? `<span class="badge">${n}</span>` : ''}</a>
      ${item('bills', icon('receipt'), 'Bills')}
    </nav>`;
  }
  function tableLabel() { return cart.type === 'takeaway' ? 'Takeaway' : cart.table ? `Table ${cart.table}` : 'Choose table'; }
  function cartbar() {
    const n = lineCount();
    if (!n || view !== 'menu') return '';
    const b = cartBill();
    return `<button class="cartbar" data-act="go-cart"><span class="grow"><b>${n} item${n > 1 ? 's' : ''} ${D.money(b.sub)}</b><small>Plus GST, no service charge</small></span><span class="btn saffron sm">View order</span></button>`;
  }

  function menuView() {
    const s = S().settings;
    const pick = S().menu.find((d) => status(d).ok && (d.tags || []).includes('Bestseller')) || S().menu.find((d) => status(d).ok) || S().menu[0];
    heroKey = pick ? pick.model : 'cappuccino';
    return `<header class="c-head">
      <div class="c-top"><span class="plate">${esc(s.name)}</span><button class="tbl-chip" data-act="table">${icon(cart.type === 'takeaway' ? 'takeaway' : 'dine', 'sm')}${esc(tableLabel())}</button></div>
      <div class="hero">
        <div class="hero-copy"><h1>See it on your table</h1><p>Open the camera and swipe through today’s dishes in 3D.</p><a class="btn saffron" href="#ar">${icon('camera')}Open camera</a></div>
        <div class="hero-stage"><div class="stage" data-stage="hero" role="img" aria-label="${esc(pick ? pick.name : '')} in 3D"></div></div>
      </div>
    </header>
    <div class="c-tools">
      <div class="row"><label class="search grow">${icon('search')}<input type="search" placeholder="Search dishes" value="${esc(q)}" data-in="q" aria-label="Search dishes"></label>
      <button class="vtoggle" data-act="veg" aria-pressed="${vegOnly}">${vmark(true)}Veg only</button></div>
      <div class="cats" role="toolbar" aria-label="Categories">${['All', ...cats()].map((c) => `<button class="cat" data-cat="${esc(c)}" aria-pressed="${cat === c}">${esc(c)}</button>`).join('')}</div>
    </div>
    <main id="menu-list">${menuList()}</main>
    <div class="cust-foot">${esc(s.address || '')}${s.fssai && !/^0+$/.test(s.fssai) ? `<br>FSSAI ${esc(s.fssai)}` : ''}<br><a href="${window.KM_APP === 'customer' ? 'cafe.html' : '#staff'}">Café staff</a></div>`;
  }
  function menuList() {
    if (!S().ready) return `<div class="empty">${icon('clock')}<h2>Loading the menu</h2></div>`;
    if (!S().menu.length) return `<div class="empty">${icon('utensils')}<h2>The menu is being set up</h2><p>Please ask the staff, or check back in a minute.</p></div>`;
    const ql = q.trim().toLowerCase();
    const groups = {};
    for (const d of S().menu) {
      if (cat !== 'All' && d.category !== cat) continue;
      if (vegOnly && !d.veg) continue;
      if (ql && !(d.name + ' ' + d.desc + ' ' + d.category).toLowerCase().includes(ql)) continue;
      (groups[d.category] = groups[d.category] || []).push(d);
    }
    const keys = Object.keys(groups);
    if (!keys.length) return `<div class="empty">${icon('search')}<h2>No dishes match</h2><p>Try another word or clear the filters.</p><button class="btn ghost" data-act="clear">Clear filters</button></div>`;
    return keys.map((k) => {
      const list = groups[k].map((d) => ({ d, s: status(d) })).sort((a, b) => (b.s.ok - a.s.ok));
      const avail = list.filter((x) => x.s.ok).length;
      return `<section aria-labelledby="sec-${esc(k)}"><div class="sec-h"><h2 id="sec-${esc(k)}">${esc(k)}</h2><span>${avail} of ${list.length} available now</span></div>
        <div class="list">${list.map(({ d, s }) => dishRow(d, s)).join('')}</div></section>`;
    }).join('');
  }
  function dishRow(d, s) {
    const n = qty(d.id);
    let act;
    if (!s.ok) act = `<span class="offlbl ${s.reason === 'time' ? 'time' : ''}">${esc(s.short || s.label)}</span>`;
    else if (n) act = `<div class="stepper" role="group" aria-label="${esc(d.name)} quantity"><button data-dec="${d.id}" aria-label="Remove one">${icon('minus', 'sm')}</button><span>${n}</span><button data-inc="${d.id}" aria-label="Add one more">${icon('plus', 'sm')}</button></div>`;
    else act = `<button class="addbtn" data-inc="${d.id}" aria-label="Add ${esc(d.name)}">${icon('plus', 'sm')}Add</button>`;
    const tags = (d.tags || []).filter((t) => t !== 'Bestseller').map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    return `<div class="dish${s.ok ? '' : ' off'}">
      <button class="open" data-open="${d.id}" aria-label="${esc(d.name)} details"></button>
      <button class="th" data-open="${d.id}" tabindex="-1" aria-hidden="true">${Viewer.img(d.model, '')}</button>
      <div><div class="dish-n">${vmark(d.veg)}<span>${esc(d.name)}</span></div>
        <div class="dish-d">${esc(d.desc || '')}</div>
        <div class="dish-m">${d.kcal ? `<span>${d.kcal} kcal</span>` : ''}${d.prep ? `<span>${d.prep} min</span>` : ''}${hasOpts(d) ? '<span>Customisable</span>' : ''}${(d.tags || []).includes('Bestseller') ? '<span class="tag">Bestseller</span>' : ''}${tags}</div></div>
      <div class="dish-r"><div class="dish-p">${D.rupees(d.price)}</div>${act}${s.ok && s.low ? `<div class="leftlbl">Only ${s.portions} left</div>` : ''}</div>
    </div>`;
  }

  function cartView() {
    const lines = cartLines(), s = S().settings;
    if (!lines.length) {
      return `<div class="page-h"><h1>Your order</h1></div><div class="empty">${icon('bag')}<h2>Nothing here yet</h2><p>Add dishes from the menu, or see them on your table first.</p>
        <div class="row" style="justify-content:center;margin-top:14px"><a class="btn" href="#menu">Browse the menu</a><a class="btn ghost" href="#ar">${icon('camera')}Open camera</a></div></div>`;
    }
    const b = cartBill();
    const blocked = lines.filter((l) => !status(X().menuById[l.id]).ok);
    const rate = s.gstRate;
    return `<div class="page-h"><a class="btn icon quiet sm" href="#menu" aria-label="Back to menu">${icon('back')}</a><h1>Your order</h1></div>
    <div class="c-pad" style="display:grid;gap:14px">
      <div class="row wrap"><div class="seg" role="group" aria-label="Order type"><button data-type="dine-in" aria-pressed="${cart.type === 'dine-in'}">Dine-in</button><button data-type="takeaway" aria-pressed="${cart.type === 'takeaway'}">Takeaway</button></div>
        <span class="grow"></span>${cart.type === 'dine-in' ? `<button class="btn quiet sm" data-act="table">${icon('dine', 'sm')}${esc(tableLabel())}</button>` : ''}</div>
      ${cart.type === 'takeaway' ? `<div class="panel" style="padding:12px 14px"><div style="font-weight:650;margin-bottom:8px">When will you pick it up?</div>
        <div class="pills" role="group" aria-label="Pickup time">${[0, 15, 30, 45, 60].map((m) => `<button class="pill" data-pick="${m}" aria-pressed="${(cart.pickup || 0) === m}">${m ? `In ${m} min` : 'As soon as ready'}</button>`).join('')}</div>
        ${cart.pickup ? `<div class="faint" style="font-size:13px;margin-top:8px">The kitchen will time it for about ${D.time12(Date.now() + cart.pickup * 60000)}.</div>` : ''}</div>` : ''}
      <div class="panel">${lines.map((l, i) => {
        const st = status(X().menuById[l.id]);
        return `<div class="cart-line"><span>${Viewer.img(l.model, '')}</span>
          <div><div class="dish-n" style="font-size:15px">${vmark(l.veg)}<span class="nm">${esc(l.name)}</span></div>
           ${optLine(l)}<div class="note">${st.ok ? '' : `<span style="color:var(--danger);font-weight:600">${esc(st.label)}. Remove to continue.</span> `}${l.note ? esc(l.note) + ' ' : ''}<button data-note="${i}">${l.note ? 'Edit note' : 'Add note'}</button></div>
          <div class="faint money" style="font-size:13px">${D.rupees(l.price)} each</div></div>
          <div style="display:grid;justify-items:end;gap:6px"><b class="money">${D.money(Math.round(l.price * 100) * l.qty)}</b>
          <div class="stepper"><button data-ldec="${i}" aria-label="Remove one">${icon('minus', 'sm')}</button><span>${l.qty}</span><button data-linc="${i}" aria-label="Add one more">${icon('plus', 'sm')}</button></div></div></div>`;
      }).join('')}</div>
      <div><a class="btn ghost sm" href="#menu">${icon('plus', 'sm')}Add more dishes</a></div>
      <div class="panel" style="padding:14px 16px">
        <table class="sumtbl"><tbody>
          <tr><td>Item total</td><td>${D.money(b.sub, true)}</td></tr>
          ${b.disc ? `<tr class="sub"><td>Rewards (${S().settings.redeemBeans} beans)</td><td>−${D.money(b.disc, true)}</td></tr>` : ''}
          ${b.incl ? `<tr class="sub"><td>Includes GST ${rate}%</td><td>${D.money(b.cgst + b.sgst, true)}</td></tr>` : `<tr class="sub"><td>CGST ${rate / 2}%</td><td>${D.money(b.cgst, true)}</td></tr><tr class="sub"><td>SGST ${rate / 2}%</td><td>${D.money(b.sgst, true)}</td></tr>`}
          ${b.round ? `<tr class="sub"><td>Round off</td><td>${b.round > 0 ? '+' : '−'}${D.money(Math.abs(b.round), true)}</td></tr>` : ''}
          <tr class="total"><td>To pay</td><td>${D.money(b.total)}</td></tr></tbody></table>
        <div class="note-line">${icon('info', 'sm')}<span>${b.incl ? 'Prices include GST.' : `GST at ${rate}% is added to menu prices.`} No service charge is added to your bill.</span></div>
      </div>
      ${rewardsPanel()}
      <div><h2 style="font-size:17px;margin:4px 0 10px">How would you like to pay?</h2>
      <div class="paymethods" role="radiogroup" aria-label="Payment method">
        ${pm('upi', 'upi', 'UPI', 'Scan and pay with any UPI app')}
        ${pm('card', 'card', 'Card', 'Debit or credit card')}
        ${pm('counter', 'store', 'Pay at counter', 'Cash, UPI or card when you leave')}
      </div></div>
      <button class="btn saffron lg block placebtn" data-act="place" ${blocked.length ? 'disabled' : ''}>Place order ${D.money(b.total)}</button>
    </div>`;
  }
  function rewardsPanel() {
    const st = S().settings, rw = rewards(); if (!rw) return '';
    const need = Number(st.redeemBeans) || 100;
    const info = !rw.phone ? `Earn 1 bean for every ₹${st.beanPer || 10} you spend. ${need} beans take ₹${st.redeemValue || 50} off a bill.`
      : `You have <b>${rw.balance}</b> bean${rw.balance === 1 ? '' : 's'}${rw.pending ? `, plus ${rw.pending} on bills not paid yet` : ''}. This order earns about ${Math.floor(cartBill().total / (Math.max(1, st.beanPer || 10) * 100))}.`;
    const can = rw.phone && rw.balance >= need;
    return `<div class="panel rewards" style="padding:12px 14px"><div class="row" style="gap:8px">${icon('star')}<b class="grow">Café rewards</b>${rw.phone ? `<span class="chip ok">${rw.balance} beans</span>` : ''}</div>
      <label class="field" style="margin-top:10px"><span>Phone number for rewards (optional)</span><input class="in" inputmode="tel" maxlength="14" placeholder="98765 43210" value="${esc(cart.phone || '')}" data-in="phone" autocomplete="tel-national"></label>
      <p class="faint" style="font-size:13px;margin:8px 0 0">${info}</p>
      ${can ? `<label class="row" style="margin-top:10px;gap:10px"><span class="switch"><input type="checkbox" data-act="redeem" ${cart.redeem ? 'checked' : ''}></span><span>Use ${need} beans for ₹${st.redeemValue || 50} off</span></label>` : ''}</div>`;
  }
  const pm = (k, ic, t, sub) => `<button class="pm" role="radio" aria-checked="${payMethod === k}" data-pm="${k}"><span class="ico">${icon(ic)}</span><span><b>${t}</b><small>${sub}</small></span><span class="radio"></span></button>`;

  const myOrders = () => S().orders.filter((o) => o.customer === me());
  function payChip(o) {
    const p = o.pay || {};
    if (o.status === 'cancelled') return '<span class="chip">Cancelled</span>';
    if (p.status === 'paid') return `<span class="chip ok">${icon('check', 'sm')}Paid</span>`;
    if (p.status === 'refunded') return '<span class="chip">Refunded</span>';
    if (p.status === 'pending') return '<span class="chip warn">UPI checking</span>';
    return '<span class="chip bad">Pay at counter</span>';
  }
  const STEPS = [['new', 'Placed'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['served', 'Served']];
  function statusChip(o) {
    if (o.status === 'cancelled') return '<span class="chip bad">Cancelled</span>';
    const m = { new: ['new', 'Placed'], preparing: ['info', 'Preparing'], ready: ['ok', 'Ready'], served: ['', 'Served'] }[o.status] || ['', o.status];
    return `<span class="chip ${m[0]}"><span class="dot"></span>${m[1]}</span>`;
  }
  function billsView() {
    const list = myOrders();
    const body = !list.length ? `<div class="empty">${icon('receipt')}<h2>No bills yet</h2><p>Orders you place on this phone show up here with their order ID.</p><a class="btn" href="#menu" style="margin-top:12px">Browse the menu</a></div>`
      : `<div class="panel" style="overflow:hidden;margin:0 16px">${list.map((o) => {
        const n = (o.items || []).reduce((s, l) => s + l.qty, 0);
        const when = D.startOfDay() === D.startOfDay(o.createdAt) ? `Today ${D.time12(o.createdAt)}` : `${D.dateShort(o.createdAt)}, ${D.time12(o.createdAt)}`;
        return `<button class="bill-row" data-order="${esc(o.id)}"><div><div class="oid">${esc(o.id)}</div><div class="meta">${when}, ${n} item${n > 1 ? 's' : ''}${o.table ? `, Table ${o.table}` : o.type === 'takeaway' ? ', Takeaway' : ''}</div></div>
          <div style="display:grid;gap:6px;justify-items:end"><div class="tot">${D.money(o.total)}</div><div class="chips">${statusChip(o)}${payChip(o)}</div></div></button>`;
      }).join('')}</div>`;
    return `<div class="page-h"><h1>Your bills</h1></div>${body}`;
  }

  /* ---------- render ---------- */
  function render() {
    if (!root) return;
    const scroll = window.scrollY;
    const html = view === 'cart' ? cartView() : view === 'bills' ? billsView() : menuView();
    root.innerHTML = `<div class="cust" data-view="${view}">${html}${cartbar()}${nav()}</div>`;
    if (view === 'menu' || view === 'ar') mountHero();
    if (view === 'menu') window.scrollTo(0, scroll); else window.scrollTo(0, 0);
  }
  function mountHero() {
    if (AR.isOpen() || openSheet) return;
    const el = $('[data-stage=hero]', root);
    if (!el || !Viewer.ok()) return;
    Viewer.mount(el, Viewer.studio({ key: heroKey || 'cappuccino', table: true, fit: 1.12, el: 0.52, az: 0.4, interactive: false }));
  }
  // light refresh of counts without rebuilding the whole page
  function refreshBits() {
    if (!root) return;
    if (view === 'menu') {
      const list = $('#menu-list', root); if (list) list.innerHTML = menuList();
      const old = $('.cartbar', root); if (old) old.remove();
      const cb = cartbar(); if (cb) $('.cust', root).insertAdjacentHTML('beforeend', cb);
      const nv = $('.bnav', root); if (nv) nv.outerHTML = nav();
    } else if (view === 'cart') render();
    if (AR.isOpen()) AR.refresh();
    if (openSheet && openSheet.refresh) openSheet.refresh();
  }

  /* ---------- AR ---------- */
  function arDishes() {
    const all = S().menu.filter((d) => status(d).ok && (!vegOnly || d.veg));
    return arCat && arCat !== 'All' ? all.filter((d) => d.category === arCat) : all;
  }
  let arCat = 'All';
  function openAR(startId) {
    AR.open({
      dishes: arDishes(), startId, categories: cats().filter((c) => S().menu.some((d) => d.category === c && status(d).ok)), category: arCat,
      getQty: qty, status, cartCount: lineCount, cartTotal: () => cartBill().sub,
      onAdd: (d, n) => { if (add(d, n) && n > 0) toast(`${d.name} added`, 'ok', 1400); },
      onClose: () => { location.hash = 'menu'; },
      onCart: () => { location.hash = 'cart'; },
      onCategory: (c) => { arCat = c; AR.update({ dishes: arDishes(), category: c }); },
    });
  }

  /* ---------- sheets ---------- */
  function dishSheet(id) {
    const d = X().menuById[id]; if (!d) return;
    let n = 1, note = '';
    const groups = D.optionGroups(d), picks = {};
    groups.forEach((g, gi) => { picks[gi] = g.many ? [] : [0]; });
    const m = modal({
      title: d.name, cls: 'dish-sheet',
      body: `<div class="dsheet-stage"><div class="stage" data-stage="detail"></div><span class="hint">Drag to turn, pinch to zoom</span><a class="btn white sm" href="#ar" data-view-ar style="position:absolute;top:12px;right:14px;box-shadow:0 2px 8px rgba(62,42,30,.15)">${icon('camera', 'sm')}See it on my table</a></div>
        <div style="margin-top:14px" data-info></div>`,
      foot: '',
      onClose: () => { openSheet = null; Viewer.unmount($('[data-stage=detail]', m.el)); mountHero(); },
    });
    openSheet = m;
    // "Goes well with": available dishes from other categories, bestsellers first
    const pairs = () => S().menu.filter((x) => x.id !== d.id && x.category !== d.category && status(x).ok)
      .sort((a, b) => ((b.tags || []).includes('Bestseller') - (a.tags || []).includes('Bestseller')) || a.price - b.price).slice(0, 3);
    const draw = () => {
      const s = status(d), sel = D.resolveOpts(d, picks), unit = d.price + sel.add;
      const pr = pairs();
      $('[data-info]', m.el).innerHTML = `<div class="row" style="align-items:flex-start"><div class="grow"><div class="dish-n" style="font-size:20px">${vmark(d.veg)}<span>${esc(d.name)}</span></div>
          <div class="kv" style="margin-top:6px">${d.kcal ? `<span>${icon('flame', 'sm')}${d.kcal} kcal</span>` : ''}${d.prep ? `<span>${icon('clock', 'sm')}${d.prep} min</span>` : ''}${(d.tags || []).map((t) => `<span class="chip new">${esc(t)}</span>`).join('')}</div></div>
          <div class="dish-p" style="font-size:21px">${D.rupees(unit)}</div></div>
        <p class="muted" style="margin:10px 0 14px">${esc(d.desc || '')}</p>
        ${s.ok ? `${groups.map((g, gi) => `<div class="optgroup"><div class="og-h"><b>${esc(g.name)}</b><span class="faint">${g.many ? 'Choose any' : 'Choose one'}</span></div>
            <div class="og-c" role="${g.many ? 'group' : 'radiogroup'}" aria-label="${esc(g.name)}">${g.choices.map((c, ci) => `<button class="optc" data-og="${gi}" data-oc="${ci}" role="${g.many ? 'checkbox' : 'radio'}" aria-checked="${picks[gi].includes(ci)}">${esc(c.n)}${c.p ? `<span>+${D.rupees(c.p)}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
          <label class="field"><span>Note for the kitchen</span><input class="in" maxlength="80" placeholder="Less ice, no onion, extra hot" data-note-in value="${esc(note)}"></label>
          ${pr.length ? `<div class="pairs"><b>Goes well with</b><div class="pair-row">${pr.map((x) => `<button class="pair" data-pair="${x.id}"><span class="pth">${Viewer.img(x.model, '')}</span><span class="pn">${esc(x.name)}</span><span class="pp">${D.rupees(x.price)} ${qty(x.id) ? `<em>${qty(x.id)} in order</em>` : `<em>${icon('plus', 'sm')}Add</em>`}</span></button>`).join('')}</div></div>` : ''}`
        : `<div class="banner">${icon('clock')}<span>${esc(s.label)}.${s.reason === 'stock' ? ' The kitchen has run out for today.' : ''}</span></div>`}`;
      const f = m.foot;
      f.style.justifyContent = 'space-between';
      f.innerHTML = s.ok ? `<div class="stepper lg"><button data-sdec aria-label="One less">${icon('minus')}</button><span>${n}</span><button data-sinc aria-label="One more">${icon('plus')}</button></div><button class="btn saffron grow" data-sadd>Add to order ${D.money(Math.round(unit * 100) * n)}</button>` : `<button class="btn ghost block" data-x-close>Close</button>`;
      const ni = $('[data-note-in]', m.el); if (ni) ni.oninput = (e) => { note = e.target.value; };
    };
    draw();
    m.refresh = draw;
    m.el.addEventListener('click', (e) => {
      const oc = e.target.closest('[data-oc]');
      if (oc) {
        const gi = +oc.dataset.og, ci = +oc.dataset.oc, g = groups[gi];
        if (g.many) picks[gi] = picks[gi].includes(ci) ? picks[gi].filter((x) => x !== ci) : picks[gi].concat(ci); else picks[gi] = [ci];
        draw(); return;
      }
      const pa = e.target.closest('[data-pair]');
      if (pa) { const x = X().menuById[pa.dataset.pair]; if (x && add(x, 1)) { toast(`${x.name} added`, 'ok', 1400); draw(); } return; }
      if (e.target.closest('[data-sinc]')) { n = Math.min(20, n + 1); draw(); }
      if (e.target.closest('[data-sdec]')) { n = Math.max(1, n - 1); draw(); }
      if (e.target.closest('[data-sadd]')) {
        const sel = D.resolveOpts(d, picks);
        let okc = 0; for (let k = 0; k < n; k++) if (add(d, 1, note.trim(), sel)) okc++;
        if (okc) { toast(`${okc} × ${d.name} added`); m.close(); }
      }
      if (e.target.closest('[data-x-close]')) m.close();
      if (e.target.closest('[data-view-ar]')) { e.preventDefault(); m.close(); pendingStart = d.id; location.hash = 'ar'; if (view === 'ar') { AR.close(); openAR(d.id); } }
    });
    setTimeout(() => Viewer.mount($('[data-stage=detail]', m.el), Viewer.studio({ key: d.model, fit: 0.86, el: 0.55 })), 30);
  }
  let pendingStart = null;

  function tableSheet() {
    const n = S().settings.tables || 12;
    const m = modal({
      title: 'Where are you sitting?',
      body: `<div class="seg" style="margin-bottom:14px"><button data-tt="dine-in" aria-pressed="${cart.type === 'dine-in'}">Dine-in</button><button data-tt="takeaway" aria-pressed="${cart.type === 'takeaway'}">Takeaway</button></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px" ${cart.type === 'takeaway' ? 'hidden' : ''} data-tables>${Array.from({ length: n }, (_, i) => `<button class="btn ${cart.table === i + 1 ? '' : 'ghost'}" data-t="${i + 1}">${i + 1}</button>`).join('')}</div>
        <p class="faint" style="font-size:13px;margin:12px 0 0">The table number is printed on the QR card at your table.</p>`,
      foot: false,
    });
    m.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]'), tt = e.target.closest('[data-tt]');
      if (tt) { cart.type = tt.dataset.tt; saveCart(); if (cart.type === 'takeaway') { m.close(); render(); } else { $$('[data-tt]', m.el).forEach((b) => b.setAttribute('aria-pressed', b === tt)); $('[data-tables]', m.el).hidden = false; } }
      if (t) { cart.table = +t.dataset.t; cart.type = 'dine-in'; saveCart(); m.close(); render(); toast(`Table ${cart.table}`); }
    });
  }
  function noteSheet(i) {
    const l = cart.lines[i]; if (!l) return;
    const m = modal({
      title: 'Note for the kitchen', body: `<label class="field"><span>${esc((X().menuById[l.id] || {}).name || '')}</span><input class="in" maxlength="80" value="${esc(l.note)}" autofocus placeholder="Less sugar, no onion, extra hot"></label>`,
      actions: [{ label: 'Cancel' }, { label: 'Save note', cls: '', onClick: (mm) => { l.note = $('input', mm.el).value.trim(); saveCart(); render(); } }],
    });
    return m;
  }

  /* ---------- placing orders ---------- */
  async function createOrder(pay) {
    const s = S().settings, lines = cartLines();
    const b = cartBill();
    const no = await D.api.nextNo();
    const now = Date.now();
    const ids = D.orderIds(no, s.prefix || 'KM', now);
    const order = Object.assign({
      id: ids.id, no, inv: ids.inv, createdAt: now, table: cart.type === 'dine-in' ? cart.table : null, type: cart.type,
      source: 'portal', customer: me(), items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, qty: l.qty, note: l.note || '', veg: l.veg, model: l.model, opts: l.opts || [] })),
      status: 'new', log: [{ s: 'new', at: now }], use: D.consumption(lines, X().menuById), pay, note: '',
    }, b);
    const ph = D.cleanPhone(cart.phone); if (ph && S().settings.loyalty !== false) { order.phone = ph; if (b.disc) order.beans = Number(S().settings.redeemBeans) || 100; }
    if (cart.type === 'takeaway' && cart.pickup) order.pickupAt = now + cart.pickup * 60000;
    await D.api.putOrder(order);
    cart.lines = []; cart.redeem = false; cart.pickup = 0; saveCart();
    lastSeen[order.id] = 'new';
    return order;
  }
  function checkBeforePay() {
    if (!cartLines().length) return false;
    if (cart.type === 'dine-in' && !cart.table) { toast('Choose your table first', 'warn'); tableSheet(); return false; }
    if (cart.phone && !D.cleanPhone(cart.phone)) { toast('Check the phone number, or leave it empty', 'warn'); return false; }
    const total = {};
    for (const l of cartLines()) { const d = X().menuById[l.id]; for (const r of d.recipe || []) total[r.ing] = (total[r.ing] || 0) + r.qty * l.qty; }
    const sm = X().stockMap;
    for (const ing in total) if (sm[ing] && sm[ing].qty < total[ing] - 1e-9) { toast('Some dishes just ran out. Please review your order.', 'warn'); render(); return false; }
    for (const l of cartLines()) if (!status(X().menuById[l.id]).ok) { toast(`${l.name} is not available right now`, 'warn'); return false; }
    return true;
  }
  async function place() {
    if (!checkBeforePay()) return;
    const total = cartBill().total;
    if (payMethod === 'card') return cardSheet(total);
    if (payMethod === 'upi') return upiSheet(total);
    const btn = $('[data-act=place]', root); if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }
    try { const o = await createOrder({ method: 'counter', status: 'unpaid' }); placed(o); }
    catch (e) { toast('Could not place the order. Check your connection and try again.', 'bad'); render(); }
  }
  const upiLink = (amount, ref, note) => { const s = S().settings; return `upi://pay?pa=${encodeURIComponent((s.upiId || '').trim().toLowerCase()).replace('%40', '@')}&pn=${encodeURIComponent(s.upiName || s.name)}&am=${(amount / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}&tr=${encodeURIComponent(ref)}`; };
  function upiSheet(total, existing) {
    const s = S().settings, ref = existing ? existing.id : (s.prefix || 'KM') + 'T' + Date.now().toString(36).toUpperCase().slice(-6);
    const link = upiLink(total, ref, existing ? `Order ${existing.id}` : `${s.name} ${cart.type === 'dine-in' && cart.table ? 'Table ' + cart.table : 'order'}`);
    const m = modal({
      title: `Pay ${D.money(total)} by UPI`,
      body: `<div class="upi-box"><div class="qr">${QR.svg(link, { margin: 1, dark: '#3E2A1E' })}</div>
          <b>Scan with any UPI app</b><span class="muted" style="text-align:center">Paying ${esc(s.upiName || s.name)}<br>UPI ID <b>${esc(s.upiId)}</b>, reference ${esc(ref)}</span>
          <a class="btn quiet" href="${esc(link)}">${icon('upi')}Open a UPI app on this phone</a></div>
        <div class="testnote" style="margin-top:12px">${icon('info', 'sm')}<span>After paying, tap “I’ve paid”. Staff confirm UPI payments in their app before marking the bill paid.</span></div>`,
      actions: existing ? [{ label: 'Close' }, { label: 'I’ve paid', cls: 'saffron', onClick: async () => { await D.api.patchOrder(existing.id, { pay: Object.assign({}, existing.pay, { method: 'upi', status: 'pending', ref, claimed: true, claimedAt: Date.now() }) }); toast('Thanks. Staff will confirm your payment.'); } }]
        : [{ label: 'Pay at counter instead', cls: 'ghost', onClick: async () => { const o = await createOrder({ method: 'counter', status: 'unpaid' }); placed(o); } },
          { label: 'I’ve paid', cls: 'saffron', onClick: async (mm) => { const b = mm.foot.lastChild; b.disabled = true; b.textContent = 'Placing order…'; try { const o = await createOrder({ method: 'upi', status: 'pending', ref, claimed: true, claimedAt: Date.now() }); placed(o); } catch (e) { toast('Could not place the order. Try again.', 'bad'); b.disabled = false; b.textContent = 'I’ve paid'; return false; } } }],
    });
    return m;
  }
  const luhn = (num) => { let s = 0, alt = false; for (let i = num.length - 1; i >= 0; i--) { let n = +num[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
  const brand = (n) => /^4/.test(n) ? 'Visa' : /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n) ? 'Mastercard' : /^(60|65|81|82|508)/.test(n) ? 'RuPay' : /^3[47]/.test(n) ? 'Amex' : '';
  function cardSheet(total, existing) {
    const m = modal({
      title: `Pay ${D.money(total)} by card`,
      body: `<div class="testnote" style="margin-bottom:14px">${icon('info', 'sm')}<span>Test mode, no money moves. Use card 4111 1111 1111 1111 with any future expiry and CVV. Card numbers are never stored.</span></div>
        <form class="cardform" novalidate>
          <label class="field"><span>Card number <b data-brand style="color:var(--brand)"></b></span><input class="in cardnum" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" maxlength="23" data-cn autofocus></label>
          <div class="grid2"><label class="field"><span>Expiry</span><input class="in" inputmode="numeric" placeholder="MM/YY" maxlength="5" autocomplete="cc-exp" data-ce></label>
          <label class="field"><span>CVV</span><input class="in" inputmode="numeric" maxlength="4" placeholder="123" autocomplete="cc-csc" data-cv></label></div>
          <label class="field"><span>Name on card</span><input class="in" autocomplete="cc-name" data-cnm></label>
          <div data-err style="color:var(--danger);font-size:13.5px;min-height:18px"></div>
        </form>`,
      actions: [{ label: 'Cancel' }, { label: `Pay ${D.money(total)}`, cls: 'saffron', onClick: (mm) => payCard(mm, total, existing) }],
    });
    const cn = $('[data-cn]', m.el), ce = $('[data-ce]', m.el);
    cn.addEventListener('input', () => { const d = cn.value.replace(/\D/g, '').slice(0, 19); cn.value = d.replace(/(\d{4})(?=\d)/g, '$1 '); $('[data-brand]', m.el).textContent = brand(d); });
    ce.addEventListener('input', () => { let d = ce.value.replace(/\D/g, '').slice(0, 4); if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2); ce.value = d; });
    $('form', m.el).addEventListener('submit', (e) => e.preventDefault());
  }
  async function payCard(m, total, existing) {
    const num = $('[data-cn]', m.el).value.replace(/\D/g, ''), exp = $('[data-ce]', m.el).value, cvv = $('[data-cv]', m.el).value.replace(/\D/g, '');
    const err = $('[data-err]', m.el), fail = (msg, sel) => { err.textContent = msg; $$('.in', m.el).forEach((i) => i.classList.remove('err')); if (sel) $(sel, m.el).classList.add('err'); return false; };
    if (num.length < 13 || !luhn(num)) return fail('Check the card number.', '[data-cn]');
    const [mm, yy] = exp.split('/').map(Number), now = new Date();
    if (!mm || mm > 12 || yy == null || isNaN(yy) || new Date(2000 + yy, mm, 1) <= now) return fail('Check the expiry date.', '[data-ce]');
    if (cvv.length < 3) return fail('Enter the 3 or 4 digit CVV.', '[data-cv]');
    const btn = m.foot.lastChild; btn.disabled = true; btn.textContent = 'Processing…'; err.textContent = '';
    await new Promise((r) => setTimeout(r, 1100));
    if (num === '4000000000000002') { btn.disabled = false; btn.textContent = `Pay ${D.money(total)}`; return fail('The bank declined this card. Try another card or pay by UPI.'); }
    const pay = { method: 'card', status: 'paid', last4: num.slice(-4), brand: brand(num), ref: 'TEST' + Date.now().toString(36).toUpperCase().slice(-7), at: Date.now() };
    try {
      if (existing) { await D.api.patchOrder(existing.id, { pay }); toast('Payment received'); m.close(); return false; }
      const o = await createOrder(pay); m.close(); placed(o);
    } catch (e) { btn.disabled = false; btn.textContent = `Pay ${D.money(total)}`; return fail('Could not save the order. Try again.'); }
    return false;
  }
  function placed(o) {
    UI.closeAll();
    location.hash = 'bills';
    setTimeout(() => orderSheet(o.id, true), 60);
  }

  /* ---------- order detail / counter ---------- */
  function orderSheet(id, justPlaced) {
    const m = modal({ title: justPlaced ? 'Order placed' : 'Order details', body: '<div data-od></div>', foot: '', onClose: () => { openSheet = null; } });
    openSheet = m;
    const draw = () => {
      const o = S().orders.find((x) => x.id === id);
      if (!o) { $('[data-od]', m.el).innerHTML = `<p class="muted">Saving your order…</p>`; return; }
      const idx = Math.max(0, STEPS.findIndex((s2) => s2[0] === o.status));
      const p = o.pay || {};
      const payLine = o.status === 'cancelled' ? 'This order was cancelled.' : p.status === 'paid' ? (p.method === 'card' ? `Paid by ${esc(p.brand || 'card')} ending ${esc(p.last4)}` : p.method === 'upi' ? 'Paid by UPI' : p.method === 'cash' ? 'Paid in cash' : 'Paid') : p.status === 'pending' ? 'UPI payment sent. Staff are confirming it.' : p.status === 'refunded' ? 'Refunded' : 'Not paid yet. Pay now or at the counter.';
      const maxPrep = Math.max(3, ...(o.items || []).map((l) => (X().menuById[l.id] || {}).prep || 5));
      const eta = o.createdAt + maxPrep * 60000;
      $('[data-od]', m.el).innerHTML = `
        <div class="row" style="align-items:flex-end"><div><div class="faint" style="font-size:13px">Order ID</div><div class="bigid">${esc(o.id)}</div></div><span class="grow"></span>${statusChip(o)}</div>
        ${o.status === 'cancelled' ? '' : `<div class="tracker" style="margin-top:14px" aria-label="Order progress">${STEPS.map((s2, i) => `<div class="${i < idx || o.status === 'served' ? 'done' : i === idx ? 'done now' : ''}">${s2[1]}</div>`).join('')}</div>
        <p class="faint" style="font-size:13px;margin:4px 0 0">${o.status === 'served' ? 'Served. Enjoy your meal.' : o.status === 'ready' ? (o.type === 'takeaway' ? `Ready. Collect it at the counter with ${esc(o.id)}.` : 'Ready. It is on its way to you.') : o.pickupAt ? `Timed for pickup at ${D.time12(o.pickupAt)}` : `Usually ready by ${D.time12(eta)}`}</p>`}
        <div class="panel" style="margin-top:14px">${(o.items || []).map((l) => `<div class="cart-line"><span>${Viewer.img(l.model || (X().menuById[l.id] || {}).model || 'cappuccino', '')}</span><div><div class="dish-n" style="font-size:15px">${vmark(l.veg !== false)}<span>${esc(l.name)}</span></div>${optLine(l)}${l.note ? `<div class="note">${esc(l.note)}</div>` : ''}<div class="faint money" style="font-size:13px">${l.qty} × ${D.rupees(l.price)}</div></div><b class="money">${D.money(Math.round(l.price * 100) * l.qty)}</b></div>`).join('')}</div>
        <table class="sumtbl" style="margin-top:12px"><tbody>
          <tr class="sub"><td>Item total</td><td>${D.money(o.sub, true)}</td></tr>
          ${o.disc ? `<tr class="sub"><td>${o.beans ? 'Rewards' : 'Discount'}</td><td>−${D.money(o.disc, true)}</td></tr>` : ''}
          <tr class="sub"><td>CGST ${o.rate / 2}%</td><td>${D.money(o.cgst, true)}</td></tr><tr class="sub"><td>SGST ${o.rate / 2}%</td><td>${D.money(o.sgst, true)}</td></tr>
          ${o.round ? `<tr class="sub"><td>Round off</td><td>${o.round > 0 ? '+' : '−'}${D.money(Math.abs(o.round), true)}</td></tr>` : ''}
          <tr class="total"><td>Total</td><td>${D.money(o.total)}</td></tr></tbody></table>
        <div class="note-line">${icon(p.status === 'paid' ? 'check' : 'info', 'sm')}<span>${payLine}</span></div>
        <p class="faint" style="font-size:12.5px;margin:2px 0 0">${D.dateShort(o.createdAt)}, ${D.time12(o.createdAt)}${o.table ? `, Table ${o.table}` : ''}, ${o.type === 'takeaway' ? 'Takeaway' : 'Dine-in'}. Invoice ${esc(o.inv || o.id)}</p>`;
      const unpaid = o.status !== 'cancelled' && (p.status === 'unpaid' || (p.status === 'pending' && !p.claimed));
      m.foot.style.flexWrap = 'wrap';
      m.foot.innerHTML = `<button class="btn ghost sm" data-o="counter">${icon('qr', 'sm')}Show at counter</button>
        <button class="btn ghost sm" data-o="bill">${icon('download', 'sm')}Bill</button>
        <button class="btn ghost sm" data-o="again">${icon('refresh', 'sm')}Order again</button>
        ${unpaid ? `<button class="btn saffron sm" data-o="pay">Pay ${D.money(o.total)}</button>` : ''}`;
    };
    draw(); m.refresh = draw;
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-o]'); if (!b) return;
      const o = S().orders.find((x) => x.id === id); if (!o) return;
      if (b.dataset.o === 'counter') counterSheet(o);
      if (b.dataset.o === 'bill') UI.download(`${o.id}-bill.html`, Invoice.html(o, S().settings), 'text/html');
      if (b.dataset.o === 'again') { let n = 0; for (const l of o.items || []) { const d = X().menuById[l.id]; if (d) for (let k = 0; k < l.qty; k++) if (add(d, 1, l.note || '', l.opts && l.opts.length ? optsSel(d, l.opts) : null)) n++; } if (n) { m.close(); location.hash = 'cart'; } }
      if (b.dataset.o === 'pay') {
        const mm = modal({ title: `Pay ${D.money(o.total)}`, body: `<div class="paymethods">${pm('upi', 'upi', 'UPI', 'Scan with any UPI app')}${pm('card', 'card', 'Card', 'Test mode')}</div>`, foot: false });
        mm.el.addEventListener('click', (ev) => { const x = ev.target.closest('[data-pm]'); if (!x) return; mm.close(); if (x.dataset.pm === 'upi') upiSheet(o.total, o); else cardSheet(o.total, o); });
      }
    });
  }
  // rebuild a selection from saved option names (for "Order again")
  function optsSel(d, names) {
    const picks = {};
    D.optionGroups(d).forEach((g, gi) => { const idx = g.choices.map((c, ci) => (names.includes(c.n) ? ci : -1)).filter((i) => i >= 0); if (idx.length) picks[gi] = g.many ? idx : [idx[0]]; });
    return D.resolveOpts(d, picks);
  }
  function counterSheet(o) {
    modal({
      title: 'Show this at the counter',
      body: `<div class="counter-show"><div class="bigid" style="font-size:58px">${esc(o.id)}</div><div class="qr">${QR.svg(o.id, { margin: 2, dark: '#3E2A1E' })}</div>
        <div style="font-size:20px;font-weight:700" class="money">${D.money(o.total)}</div><div class="muted">${o.table ? `Table ${o.table}` : 'Takeaway'}, ${((n) => `${n} item${n === 1 ? '' : 's'}`)((o.items || []).reduce((s2, l) => s2 + l.qty, 0))}</div></div>`,
      foot: false,
    });
  }

  /* ---------- live status updates for my orders ---------- */
  function watchMine() {
    for (const o of myOrders()) {
      const prev = lastSeen[o.id];
      if (prev && prev !== o.status) {
        if (o.status === 'ready') { toast(o.type === 'takeaway' ? `Order ${o.id} is ready to collect` : `Order ${o.id} is ready`, 'ok', 6000); UI.chime(); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
        else if (o.status === 'preparing') toast(`The kitchen started order ${o.id}`, 'ok', 3000);
        else if (o.status === 'cancelled') toast(`Order ${o.id} was cancelled. Please ask the staff.`, 'warn', 5000);
      }
      if (prev && o.pay && o.pay.status === 'paid' && lastSeen[o.id + ':pay'] && lastSeen[o.id + ':pay'] !== 'paid') toast(`Payment for ${o.id} confirmed`, 'ok');
      lastSeen[o.id] = o.status; lastSeen[o.id + ':pay'] = o.pay && o.pay.status;
    }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const t = e.target;
    const inc = t.closest('[data-inc]'), dec = t.closest('[data-dec]');
    // customisable dishes open the customiser the first time; "+" then repeats the last way it was ordered
    if (inc) { const d = X().menuById[inc.dataset.inc]; if (d) { const last = cart.lines.filter((l) => l.id === d.id).pop(); if (hasOpts(d) && !last) dishSheet(d.id); else if (last) add(d, 1, last.note, lineSel(last)); else add(d, 1); } return; }
    if (dec) { const d = X().menuById[dec.dataset.dec]; if (d) add(d, -1); return; }
    const op = t.closest('[data-open]'); if (op) return dishSheet(op.dataset.open);
    const c = t.closest('[data-cat]'); if (c && root.contains(c)) { cat = c.dataset.cat; $$('.cat', root).forEach((b) => b.setAttribute('aria-pressed', b === c)); $('#menu-list', root).innerHTML = menuList(); return; }
    const li = t.closest('[data-linc]'), ld = t.closest('[data-ldec]');
    if (li) { const l = cart.lines[+li.dataset.linc]; const d = l && X().menuById[l.id]; if (d) add(d, 1, l.note, lineSel(l)); return; }
    if (ld) { const l = cart.lines[+ld.dataset.ldec]; if (l) { l.qty--; if (l.qty <= 0) cart.lines.splice(+ld.dataset.ldec, 1); saveCart(); render(); } return; }
    const nt = t.closest('[data-note]'); if (nt) return noteSheet(+nt.dataset.note);
    const pk = t.closest('[data-pick]'); if (pk) { cart.pickup = +pk.dataset.pick; saveCart(); render(); return; }
    const ty = t.closest('[data-type]'); if (ty) { cart.type = ty.dataset.type; saveCart(); render(); return; }
    const p = t.closest('[data-pm]'); if (p && root.contains(p)) { payMethod = p.dataset.pm; $$('[data-pm]', root).forEach((b) => b.setAttribute('aria-checked', b === p)); return; }
    const o = t.closest('[data-order]'); if (o) return orderSheet(o.dataset.order);
    const a = t.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'table') tableSheet();
    if (act === 'veg') { vegOnly = !vegOnly; a.setAttribute('aria-pressed', vegOnly); $('#menu-list', root).innerHTML = menuList(); }
    if (act === 'clear') { q = ''; cat = 'All'; vegOnly = false; render(); }
    if (act === 'go-cart') location.hash = 'cart';
    if (act === 'place') place();
    if (act === 'redeem') { cart.redeem = a.checked; saveCart(); render(); }
  }
  function onInput(e) {
    if (e.target.dataset.in === 'q') { q = e.target.value; $('#menu-list', root).innerHTML = menuList(); }
    if (e.target.dataset.in === 'phone') { cart.phone = e.target.value; saveCart(); if (D.cleanPhone(cart.phone) || !cart.phone) { const pos = e.target.selectionStart; render(); const inp = $('[data-in=phone]', root); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } } }
  }

  /* ---------- public ---------- */
  function mount(el) {
    root = el;
    root.onclick = onClick; root.oninput = onInput;
  }
  function show(v, tableNo) {
    document.body.classList.add('c-mode');
    root.onclick = onClick; root.oninput = onInput; root.onchange = null; root.onkeydown = null;
    if (tableNo) { cart.table = tableNo; cart.type = 'dine-in'; saveCart(); }
    const was = view;
    view = v;
    if (v === 'ar') {
      if (was !== 'menu' && was !== 'ar' || !$('.cust', root)) { view = 'menu'; render(); view = 'ar'; }
      if (!AR.isOpen()) openAR(pendingStart); else if (pendingStart) { AR.close(); openAR(pendingStart); }
      pendingStart = null;
      return;
    }
    if (AR.isOpen()) AR.close();
    render();
  }
  function onData() {
    watchMine();
    if (!root || !root.isConnected || !document.body.classList.contains('c-mode')) return;
    if (view === 'bills') { if (!openSheet) render(); else { const keep = window.scrollY; render(); window.scrollTo(0, keep); } }
    else if (view === 'cart') render();
    else refreshBits();
    if (openSheet && openSheet.refresh) openSheet.refresh();
    if (AR.isOpen()) AR.update({ dishes: arDishes(), categories: cats().filter((c) => S().menu.some((d) => d.category === c && status(d).ok)) });
  }
  function leave() { if (AR.isOpen()) AR.close(); document.body.classList.remove('c-mode'); }
  return { mount, show, onData, leave, get view() { return view; }, primeSeen: () => { for (const o of myOrders()) { lastSeen[o.id] = o.status; lastSeen[o.id + ':pay'] = o.pay && o.pay.status; } } };
})();

/* Printable / downloadable GST invoice (shared by customer + staff) */
const Invoice = (() => {
  const { esc } = UI;
  function lines(o, s) {
    const D = Data, p = o.pay || {};
    const pay = p.status === 'paid' ? (p.method === 'card' ? `Card ${p.brand || ''} xx${p.last4 || ''}`.trim() : p.method === 'upi' ? 'UPI' : p.method === 'cash' ? 'Cash' : 'Paid') : p.status === 'pending' ? 'UPI (confirming)' : p.status === 'refunded' ? 'Refunded' : 'Unpaid';
    return `<div class="receipt">
      <div class="c"><h3>${esc(s.name)}</h3><div class="small">${esc(s.address)}<br>${esc(s.phone)}</div>
      <div class="small">GSTIN ${esc(s.gstin)}<br>FSSAI Lic. No. ${esc(s.fssai)}</div></div>
      <div class="hr"></div><div class="c"><b>TAX INVOICE</b></div>
      <table><tbody><tr><td>Invoice</td><td class="r">${esc(o.inv || o.id)}</td></tr><tr><td>Order</td><td class="r">${esc(o.id)}</td></tr>
      <tr><td>Date</td><td class="r">${new Date(o.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td></tr>
      <tr><td>${o.type === 'takeaway' ? 'Takeaway' : 'Table'}</td><td class="r">${o.table || '-'}</td></tr></tbody></table>
      <div class="hr"></div>
      <table><tbody>${(o.items || []).map((l) => `<tr><td>${esc(l.name)}${(l.opts || []).length ? `<br><span class="small">${esc(l.opts.join(', '))}</span>` : ''}<br><span class="small">${l.qty} x ${(+l.price).toFixed(2)}</span></td><td class="r">${((l.price * 100 * l.qty) / 100).toFixed(2)}</td></tr>`).join('')}</tbody></table>
      <div class="hr"></div>
      <table><tbody><tr><td>Sub total</td><td class="r">${(o.sub / 100).toFixed(2)}</td></tr>
      ${o.disc ? `<tr><td>${o.beans ? 'Rewards discount' : 'Discount'}</td><td class="r">-${(o.disc / 100).toFixed(2)}</td></tr>` : ''}
      <tr><td>Taxable value</td><td class="r">${(o.taxable / 100).toFixed(2)}</td></tr>
      <tr><td>CGST @${o.rate / 2}%</td><td class="r">${(o.cgst / 100).toFixed(2)}</td></tr><tr><td>SGST @${o.rate / 2}%</td><td class="r">${(o.sgst / 100).toFixed(2)}</td></tr>
      ${o.round ? `<tr><td>Round off</td><td class="r">${(o.round / 100).toFixed(2)}</td></tr>` : ''}
      <tr class="tot"><td>TOTAL</td><td class="r">${D.money(o.total, true)}</td></tr></tbody></table>
      <div class="hr"></div>
      <table><tbody><tr><td>Payment</td><td class="r">${esc(pay)}</td></tr></tbody></table>
      <div class="hr"></div>
      <div class="c small">SAC ${esc(s.sac || '996331')} Restaurant service<br>No service charge levied. Thank you!</div></div>`;
  }
  function html(o, s) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.id)} bill</title><style>
      body{margin:0;padding:24px;background:#F3EDE6;font-family:ui-monospace,Menlo,Consolas,monospace}
      .receipt{font-size:12.5px;line-height:1.45;background:#fff;color:#111;max-width:320px;margin:0 auto;padding:16px 14px;border-radius:6px}
      .c{text-align:center}h3{font-family:Georgia,serif;font-weight:400;font-size:21px;margin:0}.hr{border-top:1px dashed #999;margin:8px 0}
      table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}td.r{text-align:right;white-space:nowrap}.tot td{font-weight:700;font-size:14px}.small{font-size:11px;color:#444}
      @media print{body{background:#fff;padding:0}.receipt{max-width:none}}</style></head><body>${lines(o, s)}</body></html>`;
  }
  return { lines, html };
})();
