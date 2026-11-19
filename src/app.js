'use strict';
/* Boot + hash router. Views: #welcome, customer (#table-N, #menu, #ar, #cart, #bills), staff (#staff, #staff-orders, ...) */
(() => {
  const { $, esc, icon, toast } = UI;
  let app = null;
  function welcome() {
    document.body.classList.remove('c-mode', 's-mode');
    const s = Data.state.settings, m = Data.state.mode;
    const note = m === 'cloud' ? 'Orders sync live between every device signed in to Claude. Open the customer portal on your phone and the café manager on a laptop, then watch an order arrive.'
      : m === 'connecting' ? 'Connecting to the shared café database…'
        : m === 'local-preview' ? 'Sign in to Claude to sync orders between devices. Until then, everything is saved in this browser.'
          : 'Running in this browser. Orders sync between tabs on this device. Connect a shared database to sync phones and the counter.';
    app.onclick = null; app.oninput = null; app.onchange = null; app.onkeydown = null;
    app.innerHTML = `<div class="welcome"><div class="welcome-in">
      <span class="plate lg">${esc(s.name)}</span>
      <h1>A menu guests can see on their table</h1>
      <p class="lead">Two apps in one link. Guests open the camera, swipe through dishes in 3D, order and pay. Staff run billing, the kitchen board, stock and GST reports.</p>
      <div class="doors">
        <a class="door c" href="#table-3">${icon('camera', 'lg')}<h2>Customer portal</h2><p>What guests see after scanning the QR code on their table.</p><span class="go">Open as Table 3</span></a>
        <a class="door" href="#staff">${icon('register', 'lg')}<h2>Café manager</h2><p>Billing, kitchen tickets, bills, menu, recipe-based stock, reports and table QR codes.</p><span class="go">Open the staff software</span></a>
      </div>
      <div class="tables">Jump to a table ${Array.from({ length: Math.min(8, s.tables || 12) }, (_, i) => `<a href="#table-${i + 1}">${i + 1}</a>`).join('')}</div>
      <div class="mode-note">${icon('info', 'sm')}<span>${note}</span></div></div></div>`;
  }
  let current = '';
  // KM_APP: 'customer' (index.html, guests only), 'cafe' (cafe.html, staff only) or 'both' (demo.html, one link for both)
  const APP = window.KM_APP || 'both';
  function route() {
    const h = (location.hash || '').slice(1);
    UI.closeAll();
    let m;
    if (APP === 'customer') {
      current = 'cust';
      if ((m = /^table-(\d{1,3})$/.exec(h))) return Cust.show('menu', +m[1]);
      return Cust.show(['menu', 'cart', 'bills', 'ar'].includes(h) ? h : 'menu');
    }
    if (APP === 'cafe') { current = 'staff'; return Staff.show(h.startsWith('staff-') ? h.slice(6) : h || 'overview'); }
    if ((m = /^table-(\d{1,3})$/.exec(h))) { Staff.leave(); current = 'cust'; Cust.show('menu', +m[1]); return; }
    if (['menu', 'cart', 'bills', 'ar'].includes(h)) { Staff.leave(); current = 'cust'; Cust.show(h); return; }
    if (h === 'staff' || h.startsWith('staff-')) { Cust.leave(); current = 'staff'; Staff.show(h === 'staff' ? 'overview' : h.slice(6)); return; }
    Cust.leave(); Staff.leave(); current = 'welcome'; welcome();
  }
  let pending = false;
  function onData() {
    if (pending) return; pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (APP !== 'customer') Staff.watch();
      if (current === 'cust') Cust.onData(); else if (current === 'staff') Staff.onData(); else welcome();
      if (current !== 'cust' && APP !== 'cafe') Cust.onData();
    });
  }
  Data.onWriteError((e) => {
    const c = e && e.code;
    const msg = c === 'invalid_argument' ? 'You can view this café but not change it. Ask the owner for edit access.'
      : c === 'quota_exceeded' ? 'The café database is full. Export your data and remove old sample sales.'
        : c === 'resource_exhausted' ? 'Too many changes at once. Wait a moment and try again.'
          : 'Could not save. Check your connection and try again.';
    toast(msg, 'bad', 4500);
  });
  async function waitForRuntime(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (typeof window.claude === 'object' && window.claude && typeof window.claude.use === 'function') return true; await new Promise((r) => setTimeout(r, 60)); }
    return false;
  }
  async function boot() {
    app = $('#app');
    Cust.mount(app); Staff.mount(app);
    Data.on(onData);
    window.addEventListener('hashchange', route);
    route();
    await waitForRuntime(900);
    await Data.init();
    if (APP !== 'cafe') Cust.primeSeen();
    if (Viewer.ok()) for (const [k] of Dishes.LIST) Viewer.requestThumb(k);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
