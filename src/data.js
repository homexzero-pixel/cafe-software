'use strict';
/* Data: defaults, billing math (GST), availability, recipe-based stock, storage adapters */
const Data = (() => {
  /* ---------------- defaults ---------------- */
  const SETTINGS = {
    name: 'Kaapi & Marble', tagline: 'Café and bakery',
    address: 'Shop 1, Sample Street, Bengaluru 560001', phone: '+91 90000 00000',
    gstin: '29AAAAA0000A1Z5', fssai: '00000000000000', sac: '996331',
    gstRate: 5, taxInclusive: false,
    upiId: 'yourcafe@upi', upiName: 'Kaapi & Marble',
    prefix: 'KM', tables: 12, pin: '1234', portalUrl: '', timeMenus: true,
    // rewards: 1 bean per ₹beanPer of paid bills; redeemBeans beans = ₹redeemValue off (a discount before GST)
    loyalty: true, beanPer: 10, redeemBeans: 100, redeemValue: 50,
  };
  const CATEGORIES = ['Coffee', 'Tea & coolers', 'Bakery', 'Breakfast', 'Mains', 'Snacks', 'Desserts'];
  // [id, name, category, price, veg, model, kcal, prep, from, to, desc, recipe, tags]
  const M = [
    ['cappuccino', 'Cappuccino', 'Coffee', 180, true, 'cappuccino', 120, 5, '', '', 'Double ristretto, velvety milk and heart latte art.', { beans: 18, milk: 150, sugar: 8 }, ['Bestseller']],
    ['filter-kaapi', 'Filter Kaapi', 'Coffee', 90, true, 'filterCoffee', 90, 4, '', '', 'Chicory decoction and boiled milk, poured high in a steel davara.', { filter: 14, milk: 120, sugar: 10 }, []],
    ['cold-coffee', 'Cold Coffee', 'Coffee', 210, true, 'coldCoffee', 290, 5, '', '', 'Blended espresso and milk, whipped cream, chocolate drizzle.', { beans: 18, milk: 220, sugar: 20, cream: 30, choc: 15, icecream: 40 }, []],
    ['kulhad-chai', 'Masala Kulhad Chai', 'Tea & coolers', 60, true, 'masalaChai', 110, 6, '', '', 'Ginger, cardamom and clove, brewed strong. Rusk on the side.', { tea: 8, milk: 120, sugar: 10 }, ['Bestseller']],
    ['mango-lassi', 'Mango Lassi', 'Tea & coolers', 150, true, 'mangoLassi', 260, 4, '', '', 'Alphonso pulp and thick curd, saffron and pistachio on top.', { mango: 120, curd: 150, sugar: 15 }, []],
    ['croissant', 'Butter Croissant', 'Bakery', 140, true, 'croissant', 270, 3, '', '', 'Laminated for 72 hours and baked fresh every morning.', { 'croissant-dough': 1, butter: 5 }, []],
    ['muffin', 'Blueberry Muffin', 'Bakery', 120, true, 'blueberryMuffin', 340, 2, '', '', 'Eggless, packed with blueberries, crunchy sugar top.', { 'muffin-mix': 110, blueberry: 25 }, ['Eggless']],
    ['donut', 'Strawberry Donut', 'Bakery', 110, true, 'glazedDonut', 280, 2, '', '', 'Eggless yeast-raised donut, strawberry glaze and sprinkles.', { donut: 1, sugar: 10 }, ['Eggless']],
    ['pancakes', 'Buttermilk Pancakes', 'Breakfast', 240, false, 'pancakes', 520, 10, '07:00', '12:00', 'Three-stack with maple syrup, butter and berries.', { 'pancake-mix': 150, eggs: 2, milk: 120, butter: 15, maple: 30, blueberry: 15 }, ['Contains egg']],
    ['avocado-toast', 'Avocado Toast', 'Breakfast', 260, true, 'avocadoToast', 380, 8, '07:00', '12:00', 'Sourdough, smashed avocado, cherry tomato and chilli flakes.', { bread: 2, avocado: 1, tomato: 40, herbs: 3 }, []],
    ['club-sandwich', 'Veg Club Sandwich', 'Mains', 220, true, 'vegClub', 450, 10, '', '', 'Triple-decker with paneer, cheese, cucumber, tomato and lettuce.', { bread: 3, paneer: 60, cheese: 1, tomato: 50, lettuce: 25, butter: 10 }, []],
    ['chicken-burger', 'Smoky Chicken Burger', 'Mains', 290, false, 'chickenBurger', 610, 14, '11:00', '23:00', 'Grilled chicken thigh, cheddar, red onion and a brioche bun.', { buns: 1, chicken: 150, cheese: 1, lettuce: 20, tomato: 30, oil: 15 }, []],
    ['margherita', 'Margherita Pizza', 'Mains', 340, true, 'margherita', 780, 16, '12:00', '23:00', 'Hand-stretched base, slow-cooked tomato sauce, mozzarella, basil.', { 'pizza-dough': 1, mozzarella: 120, tomato: 120, herbs: 3 }, []],
    ['penne', 'Penne Arrabbiata', 'Mains', 320, true, 'penne', 560, 14, '12:00', '23:00', 'Spicy tomato, garlic and chilli, finished with parmesan and basil.', { pasta: 120, tomato: 150, oil: 20, herbs: 4, mozzarella: 10 }, ['Spicy']],
    ['samosa', 'Punjabi Samosa, 2 pc', 'Snacks', 70, true, 'samosa', 310, 6, '', '', 'Spiced potato and peas with mint and tamarind chutneys.', { samosa: 2, oil: 40, herbs: 2 }, []],
    ['fries', 'Peri Peri Fries', 'Snacks', 150, true, 'fries', 410, 8, '', '', 'Double-fried, dusted with peri peri, chipotle mayo dip.', { potato: 220, oil: 60, herbs: 3 }, ['Spicy']],
    ['truffle-cake', 'Chocolate Truffle Cake', 'Desserts', 190, true, 'chocoCake', 420, 2, '', '', 'Eggless dark chocolate sponge, ganache layers, a cherry on top.', { cake: 1 }, ['Eggless']],
    ['sizzling-brownie', 'Sizzling Brownie', 'Desserts', 230, true, 'sizzler', 640, 7, '', '', 'Hot walnut brownie on an iron plate, vanilla ice cream, chocolate sauce.', { brownie: 1, icecream: 80, choc: 30 }, ['Eggless']],
  ];
  // [id, name, unit, stock, reorder, cost per unit (₹), supplier]
  const S = [
    ['beans', 'Espresso beans', 'g', 2400, 1000, 1.6, 'Hill Estate Roasters'], ['filter', 'Filter coffee powder', 'g', 1800, 800, 0.9, 'Hill Estate Roasters'],
    ['tea', 'CTC tea and masala', 'g', 1500, 500, 0.6, 'Assam Leaf Co.'], ['milk', 'Milk', 'ml', 18000, 8000, 0.065, 'Local dairy'],
    ['sugar', 'Sugar', 'g', 6000, 2000, 0.045, 'Wholesale market'], ['cream', 'Whipping cream', 'ml', 900, 1000, 0.32, 'Local dairy'],
    ['choc', 'Chocolate sauce', 'ml', 1400, 500, 0.4, 'Bakers supply'], ['mango', 'Mango pulp', 'ml', 0, 2000, 0.18, 'Fruit supplier'],
    ['curd', 'Curd', 'g', 4000, 1500, 0.08, 'Local dairy'], ['croissant-dough', 'Croissant, frozen', 'pc', 24, 12, 38, 'Bakers supply'],
    ['muffin-mix', 'Eggless muffin batter', 'g', 3000, 1200, 0.22, 'In-house'], ['blueberry', 'Blueberries', 'g', 180, 400, 1.2, 'Fruit supplier'],
    ['donut', 'Donut base', 'pc', 30, 12, 22, 'Bakers supply'], ['pancake-mix', 'Pancake mix', 'g', 4000, 1500, 0.12, 'In-house'],
    ['eggs', 'Eggs', 'pc', 60, 30, 7, 'Poultry farm'], ['maple', 'Maple syrup', 'ml', 700, 300, 1.1, 'Importer'],
    ['butter', 'Butter', 'g', 3000, 1000, 0.55, 'Local dairy'], ['bread', 'Bread, sliced', 'slice', 70, 30, 9, 'Bakers supply'],
    ['avocado', 'Avocado', 'pc', 9, 10, 75, 'Fruit supplier'], ['tomato', 'Tomatoes', 'g', 5000, 2000, 0.04, 'Vegetable market'],
    ['lettuce', 'Lettuce', 'g', 1500, 600, 0.12, 'Vegetable market'], ['cheese', 'Cheese slices', 'pc', 80, 40, 9, 'Local dairy'],
    ['paneer', 'Paneer', 'g', 2500, 1000, 0.38, 'Local dairy'], ['chicken', 'Chicken thigh', 'g', 6000, 2500, 0.32, 'Meat supplier'],
    ['buns', 'Brioche buns', 'pc', 40, 20, 14, 'Bakers supply'], ['pizza-dough', 'Pizza dough ball', 'pc', 28, 12, 25, 'In-house'],
    ['mozzarella', 'Mozzarella', 'g', 4000, 1500, 0.55, 'Local dairy'], ['pasta', 'Penne, dry', 'g', 5000, 2000, 0.16, 'Importer'],
    ['potato', 'Potatoes', 'g', 12000, 5000, 0.03, 'Vegetable market'], ['samosa', 'Samosa, handmade', 'pc', 60, 30, 9, 'In-house'],
    ['oil', 'Cooking oil', 'ml', 15000, 5000, 0.14, 'Wholesale market'], ['cake', 'Truffle cake slice', 'pc', 14, 6, 65, 'In-house'],
    ['brownie', 'Brownie', 'pc', 18, 8, 45, 'In-house'], ['icecream', 'Vanilla ice cream', 'g', 4000, 1500, 0.28, 'Local dairy'],
    ['herbs', 'Seasoning and herbs', 'g', 2000, 600, 0.3, 'Wholesale market'], ['cups', 'Takeaway cups and lids', 'pc', 300, 150, 4, 'Packaging supplier'],
  ];
  /* Customisation (size, milk, add-ons, spice). A group is { name, many, choices: [{ n, p (₹ extra), r ({ingredient: qty} extra) }] }.
     For one-choice groups the first choice is the default. A dish without its own `options` uses its category's set. */
  const CHOICE = (n, p = 0, r) => (r ? { n, p, r } : { n, p });
  const SWEET = { name: 'Sweetness', many: false, choices: [CHOICE('Regular sugar'), CHOICE('Less sugar'), CHOICE('No sugar')] };
  const CATEGORY_OPTIONS = {
    'Coffee': [
      { name: 'Size', many: false, choices: [CHOICE('Regular'), CHOICE('Large', 40, { milk: 60 })] },
      { name: 'Milk', many: false, choices: [CHOICE('Dairy milk'), CHOICE('Oat milk', 50), CHOICE('Almond milk', 50)] },
      { name: 'Add-ons', many: true, choices: [CHOICE('Extra shot', 45, { beans: 9 }), CHOICE('Whipped cream', 30, { cream: 20 }), CHOICE('Hazelnut syrup', 35)] },
      SWEET,
    ],
    'Tea & coolers': [{ name: 'Size', many: false, choices: [CHOICE('Regular'), CHOICE('Large', 30, { milk: 50 })] }, SWEET],
    'Bakery': [{ name: 'Serve', many: false, choices: [CHOICE('As it is'), CHOICE('Warmed up')] }],
    'Breakfast': [{ name: 'Add-ons', many: true, choices: [CHOICE('Extra butter', 20, { butter: 10 }), CHOICE('Side of berries', 60, { blueberry: 20 })] }],
    'Mains': [
      { name: 'Spice', many: false, choices: [CHOICE('Regular'), CHOICE('Mild'), CHOICE('Extra hot')] },
      { name: 'Add-ons', many: true, choices: [CHOICE('Extra cheese', 40, { cheese: 1 }), CHOICE('Side of fries', 90, { potato: 120, oil: 30 })] },
    ],
    'Snacks': [{ name: 'Add-ons', many: true, choices: [CHOICE('Extra dip', 25)] }],
    'Desserts': [{ name: 'Add-ons', many: true, choices: [CHOICE('Scoop of ice cream', 60, { icecream: 60 })] }],
  };
  const optionGroups = (d) => (d && Array.isArray(d.options) ? d.options : (d && CATEGORY_OPTIONS[d.category]) || []);
  // picks: { groupIndex: [choiceIndex, ...] } -> chosen names (defaults left out), extra price (₹) and extra recipe
  function resolveOpts(d, picks = {}) {
    const opts = [], r = {}; let add = 0;
    optionGroups(d).forEach((g, gi) => {
      const sel = picks[gi] || (g.many ? [] : [0]);
      for (const ci of sel) {
        const c = g.choices[ci]; if (!c) continue;
        if (g.many || ci !== 0) opts.push(c.n);
        add += Number(c.p) || 0;
        for (const k in c.r || {}) r[k] = (r[k] || 0) + c.r[k];
      }
    });
    return { opts, add, r };
  }
  // "Size: Regular, Large +40 [milk 60]" lines <-> groups; a trailing * on the name allows several choices
  function optionsToText(groups) {
    return (groups || []).map((g) => `${g.name}${g.many ? '*' : ''}: ${g.choices.map((c) => `${c.n}${c.p ? ' +' + c.p : ''}${c.r ? ' [' + Object.entries(c.r).map(([k, v]) => k + ' ' + v).join(', ') + ']' : ''}`).join(', ')}`).join('\n');
  }
  function optionsFromText(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      const m = /^\s*([^:]+?)(\*)?\s*:\s*(.+)$/.exec(line); if (!m) continue;
      const choices = [];
      for (const part of m[3].match(/[^,\[]+(\[[^\]]*\])?/g) || []) {
        const cm = /^\s*(.+?)(?:\s*\+\s*(\d+(?:\.\d+)?))?\s*(?:\[([^\]]*)\])?\s*$/.exec(part); if (!cm || !cm[1].trim()) continue;
        const c = { n: cm[1].trim(), p: cm[2] ? Number(cm[2]) : 0 };
        if (cm[3]) { c.r = {}; for (const kv of cm[3].split(',')) { const km = /^\s*(\S+)\s+([\d.]+)\s*$/.exec(kv); if (km) c.r[km[1]] = Number(km[2]); } }
        choices.push(c);
      }
      if (choices.length) out.push({ name: m[1].trim(), many: !!m[2], choices });
    }
    return out;
  }

  /* Rewards ("beans"), derived from orders like stock: earned on paid bills, spent when redeemed */
  const cleanPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d : ''; };
  function beans(phone, orders, s = SETTINGS) {
    const ph = cleanPhone(phone); let earned = 0, spent = 0, pending = 0;
    if (!ph) return { earned, spent, pending, balance: 0 };
    const per = Math.max(1, Number(s.beanPer) || 10) * 100;
    for (const o of orders || []) {
      if (o.phone !== ph || o.status === 'cancelled') continue;
      spent += Number(o.beans) || 0;
      const p = o.pay || {};
      if (p.status === 'paid') earned += Math.floor((o.total || 0) / per);
      else if (p.status !== 'refunded') pending += Math.floor((o.total || 0) / per);
    }
    return { earned, spent, pending, balance: Math.max(0, earned - spent) };
  }

  function defaultMenu() {
    return M.map(([id, name, category, price, veg, model, kcal, prep, from, to, desc, recipe, tags], i) => ({
      id, name, category, price, veg, model, kcal, prep, from, to, desc, tags, active: true, sort: i,
      recipe: Object.entries(recipe).map(([ing, qty]) => ({ ing, qty })),
    }));
  }
  function defaultStock(at = Date.now()) {
    return S.map(([id, name, unit, base, reorder, cost, supplier]) => ({ id, name, unit, base, baseAt: at, reorder, cost, supplier }));
  }

  /* ---------------- money + time ---------------- */
  const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const INR0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const NUM = new Intl.NumberFormat('en-IN');
  // paise -> "₹1,234.50" ; whole rupees drop decimals when dec !== true
  function money(paise, dec) {
    const r = (paise || 0) / 100;
    if (dec === true || (dec !== false && Math.round(r) !== r)) return INR.format(r);
    return INR0.format(r);
  }
  const rupees = (p) => money(Math.round(p * 100));
  const compact = (paise) => { const r = paise / 100; if (Math.abs(r) >= 1e7) return '₹' + (r / 1e7).toFixed(2) + ' Cr'; if (Math.abs(r) >= 1e5) return '₹' + (r / 1e5).toFixed(1) + ' L'; if (Math.abs(r) >= 1e3) return '₹' + (r / 1e3).toFixed(1) + 'K'; return INR0.format(r); };
  const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fy = (d = new Date()) => { const y = d.getFullYear() % 100, m = d.getMonth(); return m >= 3 ? `${pad2(y)}-${pad2(y + 1)}` : `${pad2(y - 1)}-${pad2(y)}`; };
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const time12 = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const dateShort = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const dateLong = (t) => new Date(t).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const hm = (hhmm) => { const m = toMin(hhmm), h = Math.floor(m / 60) % 24, mm = m % 60; const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 || 12; return mm ? `${h12}:${pad2(mm)} ${ap}` : `${h12} ${ap}`; };

  /* ---------------- billing (integer paise) ---------------- */
  function bill(lines, o = {}) {
    const rate = o.rate == null ? 5 : Number(o.rate), incl = !!o.incl;
    const sub = lines.reduce((s, l) => s + Math.round(Number(l.price) * 100) * l.qty, 0);
    let disc = o.discPct ? Math.round((sub * Number(o.discPct)) / 100) : Math.round(Number(o.disc || 0));
    disc = Math.max(0, Math.min(disc, sub));
    const net = sub - disc;
    let taxable, cgst, sgst;
    if (incl) { taxable = Math.round((net * 100) / (100 + rate)); const tax = net - taxable; cgst = Math.round(tax / 2); sgst = tax - cgst; }
    else { taxable = net; cgst = Math.round((taxable * rate) / 200); sgst = cgst; }
    const gross = taxable + cgst + sgst;
    const total = Math.round(gross / 100) * 100;
    return { sub, disc, taxable, cgst, sgst, round: total - gross, total, rate, incl };
  }

  /* ---------------- stock + availability ---------------- */
  function computeStock(stock, orders, ledger) {
    const map = {};
    for (const s of stock || []) map[s.id] = Object.assign({}, s, { qty: Number(s.base) || 0, used: 0, in: 0, out: 0 });
    for (const e of ledger || []) { const s = map[e.ing]; if (e.type === 'count') continue; if (s && e.at > (s.baseAt || 0)) { s.qty += Number(e.qty) || 0; if (e.qty > 0) s.in += e.qty; else s.out -= e.qty; } }
    for (const o of orders || []) {
      if (o.status === 'cancelled') continue;
      for (const ing in o.use || {}) { const s = map[ing]; if (s && o.createdAt >= (s.baseAt || 0)) { s.qty -= o.use[ing]; s.used += o.use[ing]; } }
    }
    for (const id in map) { const s = map[id]; s.qty = Math.round(s.qty * 1000) / 1000; s.state = s.qty <= 0 ? 'out' : s.qty <= s.reorder ? 'low' : 'ok'; }
    return map;
  }
  function consumption(lines, menuById) {
    const use = {};
    for (const l of lines) { const d = menuById[l.id]; if (!d) continue; for (const r of d.recipe || []) use[r.ing] = (use[r.ing] || 0) + r.qty * l.qty; for (const k in l.xr || {}) use[k] = (use[k] || 0) + l.xr[k] * l.qty; }
    return use;
  }
  function inWindow(d, now) {
    if (!d.from || !d.to) return true;
    const m = now.getHours() * 60 + now.getMinutes(), f = toMin(d.from), t = toMin(d.to);
    return f <= t ? m >= f && m < t : m >= f || m < t;
  }
  // Is a dish orderable right now? reserve = qty already in the cart, per ingredient
  function dishStatus(d, stockMap, settings, now = new Date(), reserve = null) {
    if (!d || d.active === false) return { ok: false, reason: 'off', label: 'Not available today' };
    if ((!settings || settings.timeMenus !== false) && !inWindow(d, now)) return { ok: false, reason: 'time', label: `Served ${hm(d.from)} to ${hm(d.to)}`, short: `From ${hm(d.from)}` };
    let portions = Infinity, short = null;
    for (const r of d.recipe || []) {
      const s = stockMap[r.ing];
      if (!s) continue;
      const have = s.qty - (reserve ? reserve[r.ing] || 0 : 0), n = Math.floor(have / r.qty + 1e-9);
      if (n < portions) { portions = n; short = r.ing; }
    }
    if (portions <= 0) return { ok: false, reason: 'stock', label: 'Sold out', short: 'Sold out', ing: short };
    return { ok: true, portions: portions === Infinity ? null : portions, low: portions !== Infinity && portions <= 5 };
  }
  function foodCost(d, stockById) {
    let c = 0;
    for (const r of d.recipe || []) { const s = stockById[r.ing]; if (s) c += r.qty * (Number(s.cost) || 0); }
    return Math.round(c * 100); // paise
  }

  /* ---------------- ids ---------------- */
  const rid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function orderIds(no, prefix, t = Date.now()) { return { id: `${prefix}-${no}`, inv: `${prefix}/${fy(new Date(t))}/${String(no).padStart(4, '0')}` }; }

  /* ---------------- sample sales ---------------- */
  function sampleOrders(menu, settings, startNo, days = 14) {
    const r = E3.rng(20260419 + startNo);
    const out = [];
    const byCat = {};
    for (const d of menu) (byCat[d.category] = byCat[d.category] || []).push(d);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    let no = startNo;
    const now = Date.now();
    for (let day = days; day >= 0; day--) {
      const base = startOfDay(now - day * 864e5);
      const count = day === 0 ? 0 : 5 + Math.floor(r() * 6) + (new Date(base).getDay() % 6 === 0 ? 4 : 0);
      const times = [];
      for (let k = 0; k < count; k++) { const h = 8 + Math.pow(r(), 0.9) * 14; times.push(base + h * 36e5); }
      if (day === 0) { const lim = (now - base) / 36e5; for (let h = 7.6; h < lim - 0.25; h += 0.35 + r() * 0.6) times.push(base + h * 36e5); }
      times.sort((a, b) => a - b);
      for (const t of times) {
        if (t >= now - 60000) continue;
        const hr = new Date(t).getHours();
        const n = 1 + Math.floor(r() * 3), lines = [];
        for (let k = 0; k < n; k++) {
          let cat = hr < 11 ? pick(['Coffee', 'Coffee', 'Tea & coolers', 'Bakery', 'Breakfast', 'Breakfast']) : hr < 16 ? pick(['Coffee', 'Mains', 'Mains', 'Snacks', 'Tea & coolers', 'Desserts']) : pick(['Coffee', 'Mains', 'Snacks', 'Desserts', 'Desserts', 'Tea & coolers']);
          const pool = (byCat[cat] || menu).filter((d) => inWindow(d, new Date(t)));
          const d = pick(pool.length ? pool : menu);
          const ex = lines.find((l) => l.id === d.id);
          if (ex) ex.qty++; else lines.push({ id: d.id, name: d.name, price: d.price, qty: 1 + (r() < 0.2 ? 1 : 0), veg: d.veg, model: d.model, note: '' });
        }
        const b = bill(lines, { rate: settings.gstRate, incl: settings.taxInclusive });
        const pr = r(), method = pr < 0.58 ? 'upi' : pr < 0.82 ? 'card' : 'cash';
        no++;
        const ids = orderIds(no, settings.prefix, t);
        const portal = r() < 0.55;
        out.push(Object.assign({
          id: ids.id, no, inv: ids.inv, createdAt: Math.round(t), table: r() < 0.82 ? 1 + Math.floor(r() * (settings.tables || 12)) : null,
          source: portal ? 'portal' : 'pos', items: lines, status: 'served', use: {}, demo: true, note: '',
          pay: { method, status: 'paid', at: Math.round(t + 6e5), ref: method === 'upi' ? 'UPI' + Math.floor(r() * 1e9) : method === 'card' ? 'TEST' + Math.floor(r() * 1e6) : '', last4: method === 'card' ? String(1000 + Math.floor(r() * 8999)) : '' },
          log: [{ s: 'new', at: Math.round(t) }, { s: 'served', at: Math.round(t + 9e5) }],
        }, b, { type: r() < 0.18 ? 'takeaway' : 'dine-in' }));
      }
    }
    return out;
  }

  /* ---------------- storage ---------------- */
  // Common in-memory state + listeners. Adapters: Cloud (artifact db) or Local (this browser).
  const state = { ready: false, mode: 'local', settings: Object.assign({}, SETTINGS), menu: [], stock: [], orders: [], ledger: [], uid: null, canEdit: true, error: null, synced: false };
  const listeners = new Set();
  let notifyQueued = false;
  function notify() { if (notifyQueued) return; notifyQueued = true; queueMicrotask(() => { notifyQueued = false; for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } } }); }
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const sortMenu = (arr) => arr.slice().sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || String(a.name).localeCompare(b.name));
  const sortOrders = (arr) => arr.slice().sort((a, b) => b.createdAt - a.createdAt);

  const safeLS = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };

  /* Local adapter (self-hosted or offline): one browser, syncs across its tabs */
  const Local = {
    key: 'km.cafe.v1', chan: null, mem: null,
    load() {
      let d = null;
      try { d = JSON.parse(safeLS.get(this.key) || 'null'); } catch (e) { d = null; }
      let fresh = false;
      if (!d || !Array.isArray(d.menu)) { d = { settings: Object.assign({}, SETTINGS), menu: defaultMenu(), stock: defaultStock(), orders: [], ledger: [], counter: 1000 }; fresh = true; }
      this.mem = d;
      if (fresh) safeLS.set(this.key, JSON.stringify(d));
      this.apply();
    },
    apply() {
      const d = this.mem;
      state.settings = Object.assign({}, SETTINGS, d.settings);
      state.menu = sortMenu(d.menu); state.stock = d.stock.slice(); state.orders = sortOrders(d.orders); state.ledger = d.ledger.slice().sort((a, b) => b.at - a.at);
      notify();
    },
    save(broadcast = true) {
      safeLS.set(this.key, JSON.stringify(this.mem));
      this.apply();
      if (broadcast && this.chan) try { this.chan.postMessage('sync'); } catch (e) { /* ignore */ }
    },
    async init() {
      state.mode = 'local';
      this.load();
      try { this.chan = new BroadcastChannel('km-cafe'); this.chan.onmessage = () => this.load(); } catch (e) { this.chan = null; }
      window.addEventListener('storage', (e) => { if (e.key === this.key) this.load(); });
      state.ready = true; state.synced = true; notify();
    },
    async setSettings(patch) { this.mem.settings = Object.assign({}, this.mem.settings, patch); this.save(); },
    async putDish(d) { const i = this.mem.menu.findIndex((x) => x.id === d.id); if (i >= 0) this.mem.menu[i] = d; else this.mem.menu.push(d); this.save(); },
    async delDish(id) { this.mem.menu = this.mem.menu.filter((x) => x.id !== id); this.save(); },
    async putStock(s) { const i = this.mem.stock.findIndex((x) => x.id === s.id); if (i >= 0) this.mem.stock[i] = s; else this.mem.stock.push(s); this.save(); },
    async delStock(id) { this.mem.stock = this.mem.stock.filter((x) => x.id !== id); this.save(); },
    async nextNo() { this.load(); this.mem.counter = Math.max(this.mem.counter || 1000, ...this.mem.orders.map((o) => o.no || 0)) + 1; this.save(); return this.mem.counter; },
    async putOrder(o) { const i = this.mem.orders.findIndex((x) => x.id === o.id); if (i >= 0) this.mem.orders[i] = o; else this.mem.orders.push(o); this.save(); },
    async patchOrder(id, patch) { const o = this.mem.orders.find((x) => x.id === id); if (o) { Object.assign(o, patch); this.save(); } },
    async putOrders(list) { for (const o of list) { const i = this.mem.orders.findIndex((x) => x.id === o.id); if (i >= 0) this.mem.orders[i] = o; else this.mem.orders.push(o); } this.save(); },
    async delOrders(ids) { const s = new Set(ids); this.mem.orders = this.mem.orders.filter((o) => !s.has(o.id)); this.save(); },
    async addLedger(e) { this.mem.ledger.push(e); this.save(); },
    async seed() { this.mem.menu = defaultMenu(); this.mem.stock = defaultStock(); this.save(); },
    async reset() { this.mem = { settings: Object.assign({}, SETTINGS), menu: defaultMenu(), stock: defaultStock(), orders: [], ledger: [], counter: 1000 }; this.save(); },
  };

  /* Cloud adapter: the artifact's shared database (all signed-in viewers, live) */
  const Cloud = {
    db: null, unsubs: [], writing: new Map(), holder: rid('tab'),
    // one write at a time per document
    write(path, fn) {
      const prev = this.writing.get(path) || Promise.resolve();
      const next = prev.catch(() => {}).then(fn);
      this.writing.set(path, next);
      return next.catch((e) => { handleWriteError(e); throw e; });
    },
    async init(db, user) {
      this.db = db;
      state.mode = 'cloud';
      try { state.uid = user ? await user.id() : null; } catch (e) { state.uid = null; }
      try { if (user && user.canEdit) state.canEdit = !!(await user.canEdit()); } catch (e) { /* keep default */ }
      let got = 0;
      const timer = setTimeout(() => { if (!state.synced) { state.error = 'slow'; notify(); } }, 10000);
      const mark = (snap) => { if (snap && snap.metadata && !snap.metadata.fromCache) { got++; if (got >= 3) { state.synced = true; state.error = null; clearTimeout(timer); } } state.ready = true; notify(); };
      const fail = (e) => { state.error = (e && e.code) || 'unavailable'; state.ready = true; clearTimeout(timer); notify(); };
      this.unsubs.push(db.doc('cafe/settings').onSnapshot((s) => { state.settings = Object.assign({}, SETTINGS, s.exists ? s.data() : {}); mark(s); }, fail));
      this.unsubs.push(db.collection('menu').onSnapshot((s) => { state.menu = sortMenu(s.docs.map((d) => Object.assign({ id: d.id }, d.data()))); mark(s); }, fail));
      this.unsubs.push(db.collection('stock').onSnapshot((s) => { state.stock = s.docs.map((d) => Object.assign({ id: d.id }, d.data())); mark(s); }, fail));
      this.unsubs.push(db.collection('orders').orderBy('createdAt', 'desc').limit(800).onSnapshot((s) => { state.orders = s.docs.map((d) => Object.assign({ id: d.id }, d.data())); mark(s); }, fail));
      this.unsubs.push(db.collection('ledger').orderBy('at', 'desc').limit(400).onSnapshot((s) => { state.ledger = s.docs.map((d) => Object.assign({ id: d.id }, d.data())); mark(s); }, fail));
    },
    clean(o) { return JSON.parse(JSON.stringify(o)); },
    setSettings(patch) { const next = Object.assign({}, state.settings, patch); return this.write('cafe/settings', () => this.db.doc('cafe/settings').set(this.clean(next))); },
    putDish(d) { const { id, ...rest } = d; return this.write('menu/' + id, () => this.db.doc('menu/' + id).set(this.clean(rest))); },
    delDish(id) { return this.write('menu/' + id, () => this.db.doc('menu/' + id).delete()); },
    putStock(s) { const { id, qty, used, in: _i, out: _o, state: _s, ...rest } = s; return this.write('stock/' + id, () => this.db.doc('stock/' + id).set(this.clean(rest))); },
    delStock(id) { return this.write('stock/' + id, () => this.db.doc('stock/' + id).delete()); },
    async nextNo() {
      const ref = this.db.doc('meta/counter');
      const floor = Math.max(1000, ...state.orders.map((o) => o.no || 0));
      for (let attempt = 0; attempt < 8; attempt++) {
        let lease = { acquired: true };
        try { lease = await ref.acquire({ holder: this.holder, ttlMs: 5000 }); } catch (e) { lease = { acquired: true }; }
        if (lease.acquired) {
          const snap = await ref.get();
          const cur = Math.max(floor, snap.exists ? Number(snap.data().no) || 0 : 0);
          const no = cur + 1;
          await ref.set({ no, at: Date.now() });
          return no;
        }
        await new Promise((res) => setTimeout(res, 250 + Math.random() * 500));
      }
      return floor + 1 + Math.floor(Math.random() * 50);
    },
    putOrder(o) { const { id, ...rest } = o; return this.write('orders/' + id, () => this.db.doc('orders/' + id).set(this.clean(rest))); },
    patchOrder(id, patch) { return this.write('orders/' + id, () => this.db.doc('orders/' + id).update(this.clean(patch))); },
    // bulk writes go straight to the store with retry + backoff, so a rate limit pauses instead of failing
    async retry(fn, n = 5) {
      for (let k = 0; ; k++) {
        try { return await fn(); } catch (e) {
          const code = e && e.code;
          if (k >= n || !(code === 'resource_exhausted' || code === 'unavailable')) throw e;
          await new Promise((r) => setTimeout(r, 700 * Math.pow(2, k) + Math.random() * 400));
        }
      }
    },
    async putOrders(list, progress) { let i = 0; for (const o of list) { const { id, ...rest } = o; await this.retry(() => this.db.doc('orders/' + id).set(this.clean(rest))); if (++i % 20 === 0 && progress) progress(i, list.length); } },
    async delOrders(ids, progress) { let i = 0; for (const id of ids) { await this.retry(() => this.db.doc('orders/' + id).delete()); if (++i % 20 === 0 && progress) progress(i, ids.length); } },
    addLedger(e) { const { id, ...rest } = e; return this.write('ledger/' + id, () => this.db.doc('ledger/' + id).set(this.clean(rest))); },
    async seed() {
      for (const d of defaultMenu()) await this.putDish(d);
      for (const s of defaultStock()) await this.putStock(s);
      if (!state.settings || !state.settings._saved) await this.setSettings({ _saved: true });
    },
  };

  /* Supabase adapter (your own hosting): set window.KM_CONFIG = { supabaseUrl, supabaseKey } (see config.example.json).
     Tables hold one jsonb `data` column per row plus a few indexed columns; schema in supabase/schema.sql.
     Live updates come from Supabase Realtime, so a portal order shows on the kitchen board straight away. */
  const Supa = {
    sb: null, chan: null, rows: { settings: null, dishes: new Map(), ingredients: new Map(), orders: new Map(), stock_movements: new Map() },
    async init(cfg) {
      state.mode = 'connecting'; state.backend = 'supabase'; notify();
      const mod = await import(cfg.supabaseLib || 'https://esm.sh/@supabase/supabase-js@2');
      this.sb = mod.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true } });
      try { const { data } = await this.sb.auth.getSession(); state.staffUser = data && data.session ? data.session.user.email : null; } catch (e) { state.staffUser = null; }
      this.sb.auth.onAuthStateChange((_e, sess) => { state.staffUser = sess ? sess.user.email : null; notify(); });
      this.chan = this.sb.channel('cafe');
      for (const t of ['settings', 'dishes', 'ingredients', 'orders', 'stock_movements']) {
        this.chan.on('postgres_changes', { event: '*', schema: 'public', table: t }, (ev) => this.change(t, ev));
      }
      this.chan.subscribe((st) => { if (st === 'SUBSCRIBED') { state.error = null; } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { state.error = 'unavailable'; } notify(); });
      await this.reload();
      state.mode = 'cloud'; state.ready = true; state.synced = true; notify();
      // re-read after the tab wakes up, in case events were missed while asleep
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reload().catch(() => {}); });
    },
    async reload() {
      const q = (t, f) => f(this.sb.from(t).select('id,data')).then((r) => { if (r.error) throw r.error; return r.data; });
      const [st, ds, ing, ord, led] = await Promise.all([
        q('settings', (x) => x.eq('id', 'cafe')), q('dishes', (x) => x), q('ingredients', (x) => x),
        q('orders', (x) => x.order('created_at', { ascending: false }).limit(800)), q('stock_movements', (x) => x.order('at', { ascending: false }).limit(400)),
      ]);
      this.rows.settings = st[0] ? st[0].data : {};
      for (const [k, list] of [['dishes', ds], ['ingredients', ing], ['orders', ord], ['stock_movements', led]]) { const m = new Map(); for (const r of list) m.set(r.id, Object.assign({}, r.data, { id: r.id })); this.rows[k] = m; }
      this.apply();
    },
    change(t, ev) {
      if (t === 'settings') { if (ev.new && ev.new.id === 'cafe') this.rows.settings = ev.new.data; }
      else if (ev.eventType === 'DELETE') this.rows[t].delete(ev.old.id);
      else this.rows[t].set(ev.new.id, Object.assign({}, ev.new.data, { id: ev.new.id }));
      this.apply();
    },
    apply() {
      state.settings = Object.assign({}, SETTINGS, this.rows.settings || {});
      state.menu = sortMenu([...this.rows.dishes.values()]); state.stock = [...this.rows.ingredients.values()];
      state.orders = sortOrders([...this.rows.orders.values()]); state.ledger = [...this.rows.stock_movements.values()].sort((a, b) => b.at - a.at);
      notify();
    },
    clean(o) { return JSON.parse(JSON.stringify(o)); },
    async up(t, row) { const r = await this.sb.from(t).upsert(row); if (r.error) { handleWriteError(r.error); throw r.error; } },
    async del(t, ids) { const r = await this.sb.from(t).delete().in('id', ids); if (r.error) { handleWriteError(r.error); throw r.error; } },
    orderRow(o) { const { id, ...rest } = o; return { id, created_at: new Date(o.createdAt).toISOString(), status: o.status, table_no: o.table ? String(o.table) : null, total_paise: o.total, data: this.clean(rest) }; },
    setSettings(patch) { const next = Object.assign({}, state.settings, patch); this.rows.settings = next; this.apply(); return this.up('settings', { id: 'cafe', data: this.clean(next) }); },
    putDish(d) { const { id, ...rest } = d; return this.up('dishes', { id, data: this.clean(rest) }); },
    delDish(id) { return this.del('dishes', [id]); },
    putStock(x) { const { id, qty, used, in: _i, out: _o, state: _s, ...rest } = x; return this.up('ingredients', { id, data: this.clean(rest) }); },
    delStock(id) { return this.del('ingredients', [id]); },
    async nextNo() {
      const floor = Math.max(1000, ...state.orders.map((o) => o.no || 0));
      const r = await this.sb.rpc('next_order_no', { floor_no: floor });
      if (r.error) { handleWriteError(r.error); throw r.error; }
      return Number(r.data);
    },
    async setCounter(no) { const r = await this.sb.rpc('set_order_no', { new_no: no }); if (r.error) throw r.error; },
    putOrder(o) { this.rows.orders.set(o.id, o); this.apply(); return this.up('orders', this.orderRow(o)); },
    async patchOrder(id, patch) {
      const cur = this.rows.orders.get(id); if (!cur) return;
      const next = Object.assign({}, cur, this.clean(patch)); this.rows.orders.set(id, next); this.apply();
      // guests may only change the payment of their own order; the database checks this in customer_pay()
      if (!state.staffUser && Object.keys(patch).every((k) => k === 'pay')) { const r = await this.sb.rpc('customer_pay', { order_id: id, pay: this.clean(patch.pay) }); if (r.error) { handleWriteError(r.error); throw r.error; } return; }
      return this.up('orders', this.orderRow(next));
    },
    async putOrders(list, progress) { for (let i = 0; i < list.length; i += 100) { await this.up('orders', list.slice(i, i + 100).map((o) => this.orderRow(o))); if (progress) progress(Math.min(i + 100, list.length), list.length); } },
    async delOrders(ids, progress) { for (let i = 0; i < ids.length; i += 100) { await this.del('orders', ids.slice(i, i + 100)); if (progress) progress(Math.min(i + 100, ids.length), ids.length); } },
    addLedger(e) { const { id, ...rest } = e; return this.up('stock_movements', { id, at: new Date(e.at).toISOString(), data: this.clean(rest) }); },
    async seed() {
      await this.up('dishes', defaultMenu().map((d) => { const { id, ...rest } = d; return { id, data: this.clean(rest) }; }));
      await this.up('ingredients', defaultStock().map((x) => { const { id, ...rest } = x; return { id, data: this.clean(rest) }; }));
      if (!this.rows.settings || !this.rows.settings._saved) await this.setSettings({ _saved: true });
    },
    async signIn(email, password) { const r = await this.sb.auth.signInWithPassword({ email, password }); if (r.error) throw r.error; state.staffUser = r.data.user.email; notify(); },
    async signOut() { await this.sb.auth.signOut(); state.staffUser = null; notify(); },
  };
  let writeErrorHandler = null;
  function handleWriteError(e) { if (writeErrorHandler) writeErrorHandler(e); }

  let adapter = Local;
  async function init() {
    // Your own Supabase project wins when configured; inside the Claude artifact viewer use its shared database; else this browser.
    const cfg = window.KM_CONFIG || {};
    if (cfg.supabaseUrl && cfg.supabaseKey) {
      try { adapter = Supa; return await Supa.init(cfg); } catch (e) { console.error('Supabase connection failed, using this browser', e); state.backend = null; state.error = null; }
    }
    const hasRuntime = typeof window.claude === 'object' && window.claude && typeof window.claude.use === 'function';
    if (!hasRuntime) { adapter = Local; return Local.init(); }
    state.ready = false; state.mode = 'connecting'; notify();
    let db = null, user = null;
    try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user').catch(() => null)]); } catch (e) { db = null; }
    if (db) { adapter = Cloud; return Cloud.init(db, user); }
    adapter = Local;
    await Local.init();
    state.mode = 'local-preview';
    notify();
  }
  const api = {
    get adapter() { return adapter; },
    setSettings: (p) => adapter.setSettings(p), putDish: (d) => adapter.putDish(d), delDish: (id) => adapter.delDish(id),
    putStock: (s) => adapter.putStock(s), delStock: (id) => adapter.delStock(id), nextNo: () => adapter.nextNo(),
    putOrder: (o) => adapter.putOrder(o), patchOrder: (id, p) => adapter.patchOrder(id, p), putOrders: (l, pr) => adapter.putOrders(l, pr), delOrders: (ids, pr) => adapter.delOrders(ids, pr),
    addLedger: (e) => adapter.addLedger(e), seed: () => adapter.seed(), reset: () => (adapter.reset ? adapter.reset() : null),
  };

  // derived, memoised per state change
  let memo = { key: null };
  function derived() {
    const key = [state.menu, state.stock, state.orders, state.ledger, state.settings];
    if (memo.key && memo.key.every((v, i) => v === key[i])) return memo;
    const menuById = {}; for (const d of state.menu) menuById[d.id] = d;
    const stockById = {}; for (const s of state.stock) stockById[s.id] = s;
    const stockMap = computeStock(state.stock, state.orders, state.ledger);
    memo = { key, menuById, stockById, stockMap };
    return memo;
  }

  return {
    SETTINGS, CATEGORIES, defaultMenu, defaultStock, money, rupees, compact, NUM, toMin, pad2, fy, dayKey, startOfDay, time12, dateShort, dateLong, hm,
    bill, computeStock, consumption, dishStatus, optionGroups, resolveOpts, optionsToText, optionsFromText, CATEGORY_OPTIONS, beans, cleanPhone, inWindow, foodCost, rid, orderIds, sampleOrders,
    state, on, notify, init, api, derived, safeLS, onWriteError: (fn) => { writeErrorHandler = fn; },
  };
})();
