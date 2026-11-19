'use strict';
/* Thermal printing (ESC/POS) for kitchen tickets and bills.
   Each device keeps its own printers (localStorage): a bill printer and a kitchen printer, each connected by
   USB (WebUSB), serial (Web Serial), Bluetooth (Web Bluetooth), the network (through tools/print-bridge.mjs)
   or the browser's print dialog. Chrome or Edge on HTTPS (or localhost) is needed for USB, serial and Bluetooth. */
const Printer = (() => {
  const KEY = 'km.printers.v1';
  const DEF = {
    bill: { type: 'none', width: 48, drawer: true, qr: true, copies: 1, host: '', port: 9100, bridge: 'http://localhost:9180', baud: 9600, label: '' },
    kot: { type: 'same', width: 48, copies: 1, host: '', port: 9100, bridge: 'http://localhost:9180', baud: 9600, label: '' },
    autoKot: false, autoBill: false, device: '',
  };
  let cfg = load();
  const conn = { bill: null, kot: null };
  function load() {
    try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c) return { ...DEF, ...c, bill: { ...DEF.bill, ...c.bill }, kot: { ...DEF.kot, ...c.kot } }; } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEF));
  }
  function save(next) { cfg = next; try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
  const support = () => ({ usb: !!navigator.usb, serial: !!navigator.serial, bluetooth: !!navigator.bluetooth, network: true, browser: true });

  /* ---------- ESC/POS encoder ---------- */
  // printers speak a single-byte code page: keep ASCII, swap the usual symbols, drop the rest
  const ascii = (s) => String(s == null ? '' : s).replace(/₹\s?/g, 'Rs.').replace(/[×✕]/g, 'x').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '*')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, '?');
  class Doc {
    constructor(width) { this.w = width || 48; this.b = [0x1b, 0x40]; } // ESC @ initialise
    raw(...a) { for (const x of a) this.b.push(x & 0xff); return this; }
    text(s) { for (const ch of ascii(s)) this.b.push(ch.charCodeAt(0)); return this; }
    line(s = '') { return this.text(s).raw(0x0a); }
    align(a) { return this.raw(0x1b, 0x61, { left: 0, center: 1, right: 2 }[a] || 0); }
    bold(on) { return this.raw(0x1b, 0x45, on ? 1 : 0); }
    size(w, h) { return this.raw(0x1d, 0x21, ((w - 1) << 4) | (h - 1)); }
    hr(ch = '-') { return this.line(ch.repeat(this.w)); }
    feed(n = 1) { return this.raw(0x1b, 0x64, n); }
    cut() { return this.feed(3).raw(0x1d, 0x56, 0x42, 0x00); }
    drawer() { return this.raw(0x1b, 0x70, 0x00, 0x19, 0xfa); } // kick pin 2
    // left text and right text on one line; long left text wraps
    lr(left, right, w = this.w) {
      left = ascii(left); right = ascii(right);
      const room = Math.max(4, w - right.length - 1), parts = wrap(left, room);
      parts.forEach((p, i) => this.line(i === parts.length - 1 ? p + ' '.repeat(Math.max(1, w - p.length - right.length)) + right : p));
      return this;
    }
    wrapped(s, indent = '') { for (const p of wrap(ascii(s), this.w - indent.length)) this.line(indent + p); return this; }
    // GS ( k QR code; printers without QR support skip it
    qr(data, size = 6) {
      const d = Array.from(ascii(data), (c) => c.charCodeAt(0)), n = d.length + 3;
      return this.raw(0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00).raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, size).raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)
        .raw(0x1d, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d).raw(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
    }
    bytes() { return new Uint8Array(this.b); }
  }
  function wrap(s, w) {
    const out = []; let cur = '';
    for (const word of String(s).split(/\s+/)) {
      if (!word) continue;
      if ((cur ? cur.length + 1 : 0) + word.length <= w) cur = cur ? cur + ' ' + word : word;
      else { if (cur) out.push(cur); let x = word; while (x.length > w) { out.push(x.slice(0, w)); x = x.slice(w); } cur = x; }
    }
    if (cur || !out.length) out.push(cur);
    return out;
  }
  const r2 = (p) => (p / 100).toFixed(2);
  const when = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

  /* ---------- layouts ---------- */
  function kot(o, width, reprint) {
    const d = new Doc(width), D = Data;
    d.align('center').size(2, 2).bold(true).line('KOT').size(1, 1).bold(false);
    if (reprint) d.line('** REPRINT **');
    d.size(2, 2).bold(true).line(o.id).size(1, 1).bold(false);
    d.size(1, 2).bold(true).line(D.whereLabel(o)).size(1, 1).bold(false);
    if (o.extId) d.line(`${D.CHANNELS[o.channel] ? D.CHANNELS[o.channel].label : 'App'} order ${o.extId}`);
    if (o.pickupAt) d.bold(true).line(`Pickup at ${D.time12(o.pickupAt)}`).bold(false);
    d.line(when(o.createdAt) + (o.by ? `, ${o.by}` : '')).align('left').hr('=');
    for (const l of o.items || []) {
      d.size(1, 2).bold(true).wrapped(`${l.qty} x ${l.name}`).size(1, 1).bold(false);
      if ((l.opts || []).length) d.wrapped(l.opts.join(', '), '    ');
      if (l.note) d.wrapped(`Note: ${l.note}`, '    ');
    }
    if (o.note) d.hr().wrapped(`Order note: ${o.note}`);
    const n = (o.items || []).reduce((a, l) => a + l.qty, 0);
    d.hr('=').align('center').line(`${n} item${n === 1 ? '' : 's'}`).cut();
    return d.bytes();
  }
  function bill(o, s, width, opts = {}) {
    const d = new Doc(width), D = Data, p = o.pay || {}, eco = D.isEco(o);
    d.align('center').size(2, 2).bold(true).wrapped(s.name).size(1, 1).bold(false);
    if (s.address) d.wrapped(s.address); if (s.phone) d.line(s.phone);
    d.line(`GSTIN ${s.gstin}`).line(`FSSAI Lic. No. ${s.fssai}`).hr();
    d.bold(true).line(eco ? 'ORDER SUMMARY' : 'TAX INVOICE').bold(false).align('left');
    if (!eco) d.lr('Invoice', o.inv || o.id);
    d.lr('Order', o.id);
    if (eco && o.extId) d.lr(`${D.CHANNELS[o.channel].label} order`, o.extId);
    d.lr('Date', when(o.createdAt)).lr(o.table ? 'Table' : 'Type', o.table ? String(o.table) : D.whereLabel(o)).hr();
    for (const l of o.items || []) {
      d.lr(`${l.qty} x ${l.name}`, r2(Math.round(l.price * 100) * l.qty));
      if ((l.opts || []).length) d.wrapped(l.opts.join(', '), '  ');
      if (l.qty > 1) d.line(`  @ ${(+l.price).toFixed(2)}`);
    }
    d.hr().lr('Sub total', r2(o.sub));
    if (o.disc) d.lr(o.beans ? 'Rewards discount' : 'Discount', '-' + r2(o.disc));
    if (!eco) d.lr('Taxable value', r2(o.taxable)).lr(`CGST @${o.rate / 2}%`, r2(o.cgst)).lr(`SGST @${o.rate / 2}%`, r2(o.sgst));
    if (o.round) d.lr('Round off', r2(o.round));
    d.bold(true).size(1, 2).lr('TOTAL', 'Rs.' + r2(o.total)).size(1, 1).bold(false).hr();
    const parts = D.payParts(o).map((x) => `${{ cash: 'Cash', upi: 'UPI', card: 'Card', online: 'Paid online', counter: 'Counter' }[x.m] || x.m} ${r2(x.a)}`).join(' + ');
    d.lr('Payment', p.status === 'paid' ? parts || 'Paid' : p.status === 'refunded' ? 'Refunded' : 'Not paid');
    if (p.change) d.lr('Change', r2(p.change));
    d.hr().align('center');
    if (eco) d.wrapped(`GST on this order is charged and paid by ${D.CHANNELS[o.channel].label} under section 9(5) of the CGST Act.`);
    else d.line(`SAC ${s.sac || '996331'} Restaurant service`);
    d.line('No service charge levied.');
    if (opts.qr && !eco) {
      const unpaid = p.status !== 'paid' && p.status !== 'refunded' && s.upiId;
      d.feed(1).qr(unpaid ? `upi://pay?pa=${s.upiId}&pn=${encodeURIComponent(s.upiName || s.name)}&am=${r2(o.total)}&cu=INR&tr=${o.id}` : o.id).line(unpaid ? 'Scan to pay by UPI' : '');
    }
    d.line('Thank you!');
    if (opts.drawer) d.drawer();
    d.cut();
    return d.bytes();
  }
  function test(width, label) {
    const d = new Doc(width);
    d.align('center').size(2, 2).bold(true).line('Test print').size(1, 1).bold(false).line(label || '').line(new Date().toLocaleString('en-IN')).hr()
      .align('left').lr('Left text', 'Right').lr('A very long dish name that has to wrap onto two lines', '123.45').hr().align('center').line(`${width} characters per line`).cut();
    return d.bytes();
  }
  // text preview of what the printer gets, for the browser dialog and the on-screen preview
  function preview(bytes) {
    let out = '', i = 0;
    while (i < bytes.length) {
      const c = bytes[i];
      if (c === 0x1b || c === 0x1d) { // skip command and its arguments
        const n = bytes[i + 1];
        if (c === 0x1d && n === 0x28) { i += 5 + (bytes[i + 3] | (bytes[i + 4] << 8)); continue; }
        i += c === 0x1b ? ({ 0x40: 2, 0x61: 3, 0x45: 3, 0x64: 3, 0x70: 5 }[n] || 2) : ({ 0x21: 3, 0x56: 4 }[n] || 3); continue;
      }
      out += c === 0x0a ? '\n' : String.fromCharCode(c); i++;
    }
    return out.replace(/\n{3,}$/, '\n');
  }

  /* ---------- transports ---------- */
  const BT_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb'];
  async function usbOpen(dev) {
    await dev.open(); if (!dev.configuration) await dev.selectConfiguration(1);
    for (const itf of dev.configuration.interfaces) for (const alt of itf.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (ep) { await dev.claimInterface(itf.interfaceNumber); if (alt.alternateSetting) await dev.selectAlternateInterface(itf.interfaceNumber, alt.alternateSetting); return { kind: 'usb', dev, ep: ep.endpointNumber, name: dev.productName || 'USB printer' }; }
    }
    throw new Error('This USB device has no printer output');
  }
  async function serialOpen(port, baud) { await port.open({ baudRate: baud || 9600 }); const info = port.getInfo ? port.getInfo() : {}; return { kind: 'serial', port, name: `Serial printer${info.usbProductId ? ' ' + info.usbProductId.toString(16) : ''}` }; }
  async function btOpen(dev) {
    const srv = await dev.gatt.connect();
    for (const svc of await srv.getPrimaryServices()) for (const ch of await svc.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) return { kind: 'bluetooth', dev, ch, name: dev.name || 'Bluetooth printer' };
    }
    throw new Error('No writable channel on this Bluetooth device');
  }
  // asks the browser to pick a device (needs a tap); remembers its kind for this slot
  async function connect(slot) {
    const c = cfg[slot]; let h;
    if (c.type === 'usb') h = await usbOpen(await navigator.usb.requestDevice({ filters: [] }));
    else if (c.type === 'serial') h = await serialOpen(await navigator.serial.requestPort(), c.baud);
    else if (c.type === 'bluetooth') h = await btOpen(await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES }));
    else return null;
    conn[slot] = h; save({ ...cfg, [slot]: { ...c, label: h.name } });
    return h;
  }
  // after a reload, USB and serial printers the browser already allowed reconnect without asking
  async function reconnect(slot) {
    const c = cfg[slot];
    try {
      if (c.type === 'usb' && navigator.usb) { const ds = await navigator.usb.getDevices(); const dev = ds.find((x) => (x.productName || 'USB printer') === c.label) || ds[0]; if (dev) conn[slot] = await usbOpen(dev); }
      if (c.type === 'serial' && navigator.serial) { const ps = await navigator.serial.getPorts(); if (ps[0]) conn[slot] = await serialOpen(ps[0], c.baud); }
      if (c.type === 'bluetooth' && navigator.bluetooth && navigator.bluetooth.getDevices) { const ds = await navigator.bluetooth.getDevices(); const dev = ds.find((x) => x.name === c.label); if (dev) conn[slot] = await btOpen(dev); }
    } catch (e) { conn[slot] = null; }
    return conn[slot];
  }
  async function write(slot, bytes) {
    const c = cfg[slot];
    if (c.type === 'network') {
      const url = `${c.bridge.replace(/\/$/, '')}/print?host=${encodeURIComponent(c.host)}&port=${encodeURIComponent(c.port || 9100)}`;
      const r = await fetch(url, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!r.ok) throw new Error((await r.text()) || 'The print bridge refused the job');
      return;
    }
    if (c.type === 'browser') return browserPrint(preview(bytes));
    let h = conn[slot] || (await reconnect(slot));
    if (!h) throw new Error('Printer not connected. Open Printers and tap Connect.');
    try {
      if (h.kind === 'usb') { for (let i = 0; i < bytes.length; i += 4096) await h.dev.transferOut(h.ep, bytes.slice(i, i + 4096)); }
      else if (h.kind === 'serial') { const w = h.port.writable.getWriter(); try { await w.write(bytes); } finally { w.releaseLock(); } }
      else if (h.kind === 'bluetooth') {
        if (!h.dev.gatt.connected) h = conn[slot] = await btOpen(h.dev);
        const n = h.chunk || 100;
        for (let i = 0; i < bytes.length; i += n) {
          const part = bytes.slice(i, i + n);
          try { if (h.ch.properties.writeWithoutResponse) await h.ch.writeValueWithoutResponse(part); else await h.ch.writeValue(part); }
          catch (e) { if (n > 20) { h.chunk = 20; return write(slot, bytes.slice(i)); } throw e; }
          await new Promise((r) => setTimeout(r, 15));
        }
      }
    } catch (e) { conn[slot] = null; throw e; }
  }
  function browserPrint(textOut) {
    let area = document.getElementById('print-area'); if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
    area.innerHTML = `<pre class="thermal">${UI.esc(textOut)}</pre>`;
    try { window.print(); } catch (e) { /* ignore */ }
    setTimeout(() => { area.innerHTML = ''; }, 1000);
  }
  // the slot that prints kitchen tickets: its own printer, or the bill printer
  const kotSlot = () => (cfg.kot.type === 'same' ? 'bill' : 'kot');
  const ready = (slot) => cfg[slot].type !== 'none' && cfg[slot].type !== 'same';
  async function printKot(o, reprint) {
    const slot = kotSlot(); if (!ready(slot)) return false;
    const c = cfg[slot], data = kot(o, c.width, reprint);
    for (let k = 0; k < (cfg.kot.copies || 1); k++) await write(slot, data);
    return true;
  }
  async function printBill(o, s, extra = {}) {
    if (!ready('bill')) return false;
    const c = cfg.bill, cash = Data.payParts(o).some((x) => x.m === 'cash');
    const data = bill(o, s, c.width, { qr: c.qr, drawer: c.drawer && cash && extra.sale });
    for (let k = 0; k < (c.copies || 1); k++) await write('bill', data);
    return true;
  }
  async function printTest(slot) { const c = cfg[slot]; await write(slot, test(c.width, `${slot === 'bill' ? 'Bill' : 'Kitchen'} printer${c.label ? ', ' + c.label : ''}`)); }
  async function openDrawer() { if (!ready('bill')) return false; await write('bill', new Doc(cfg.bill.width).drawer().bytes()); return true; }
  return {
    get cfg() { return cfg; }, save, support, connect, reconnect, isConnected: (slot) => !!conn[slot], ready, kotSlot,
    printKot, printBill, printTest, openDrawer, kot, bill, preview, ascii, wrap, Doc,
  };
})();
