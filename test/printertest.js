// ESC/POS layouts: widths, wrapping and the bytes a printer needs
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, Date, Intl, JSON, Object, Array, Number, String, Map, Set, Promise, setTimeout, clearTimeout, queueMicrotask, Uint8Array, encodeURIComponent, unescape, window: {}, document: {}, navigator: {}, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
vm.runInContext(rd('data.js') + rd('printer.js') + '\nthis.Data = Data; this.Printer = Printer;', ctx);
const { Data: D, Printer: P } = ctx;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const s = D.SETTINGS;
const lines = [{ id: 'cappuccino', name: 'Cappuccino', price: 265, qty: 2, opts: ['Large', 'Extra shot'], note: 'extra hot' }, { id: 'samosa', name: 'Punjabi Samosa, 2 pc', price: 70, qty: 1 }];
const o = Object.assign({ id: 'KM-1043', inv: 'KM/26-27/1043', createdAt: Date.now(), table: 4, type: 'dine-in', items: lines, rate: 5, pay: { method: 'split', status: 'paid', parts: [{ m: 'cash', a: 30000 }, { m: 'upi', a: 33000 }] } }, D.bill(lines, { rate: 5 }));
for (const w of [32, 48]) {
  const t = P.preview(P.bill(o, s, w, { qr: true, drawer: true }));
  ok(t.split('\n').every((l) => l.length <= w), `bill fits ${w} characters a line`);
  ok(/TAX INVOICE/.test(t) && /CGST @2.5%/.test(t) && /FSSAI/.test(t) && /SAC 996331/.test(t) && /No service charge/.test(t), `bill (${w}) has invoice, GST, FSSAI and SAC lines`);
  ok(/Cash 300.00 \+ UPI 330.00/.test(t), `bill (${w}) shows the split payment`);
  ok(P.preview(P.kot(o, w)).split('\n').every((l) => l.length <= w), `KOT fits ${w} characters a line`);
}
const kb = P.kot(o, 48), kt = P.preview(kb);
ok(/KM-1043/.test(kt) && /2 x Cappuccino/.test(kt) && /Large, Extra shot/.test(kt) && /Note: extra hot/.test(kt) && /Table 4/.test(kt), 'KOT lists items, choices, notes and table');
const bb = Array.from(P.bill(o, s, 48, { drawer: true }));
ok(bb[0] === 0x1b && bb[1] === 0x40, 'starts with ESC @');
ok(bb.join(',').includes([0x1d, 0x56, 0x42].join(',')), 'ends with a paper cut');
ok(bb.join(',').includes([0x1b, 0x70, 0x00].join(',')), 'kicks the cash drawer when asked');
ok(P.ascii('₹1,234 × 2 – “café”') === 'Rs.1,234 x 2 - "cafe"', 'rupee sign and accents become printable ASCII');
const eo = Object.assign({ id: 'ZO-456789', extId: '5123456789', channel: 'zomato', eco: true, type: 'delivery', createdAt: Date.now(), items: lines, rate: 0, pay: { method: 'online', status: 'paid' } }, D.bill(lines, { rate: 0 }));
const et = P.preview(P.bill(eo, s, 48, { qr: true }));
ok(/ORDER SUMMARY/.test(et) && !/CGST @/.test(et) && /paid by Zomato\s+under section 9\(5\)/.test(et) && /Zomato order/.test(et), 'app order bill: no café GST, says the app pays it');
if (fails) { console.log(fails + ' failed'); process.exit(1); }
