// Exports the starter settings, menu and stock as database write operations.
// Usage: PORTAL_URL=https://your-site.example node tools/export-seed.js  -> tools/out/*.json
const fs = require('fs'), vm = require('vm');
const ctx = { console, Math, Date, Intl, JSON, Object, Array, Number, String, Map, Set, Promise, setTimeout, clearTimeout, queueMicrotask, Infinity, window: {}, document: {}, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, parseInt };
vm.createContext(ctx);
const path = require('path'); const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
vm.runInContext(rd('engine.js') + rd('data.js') + '\nthis.Data = Data;', ctx);
const D = ctx.Data;
const settings = Object.assign({}, D.SETTINGS, { portalUrl: process.env.PORTAL_URL || '', _saved: true });
const at = Date.now();
const menuOps = [{ op: 'set', path: 'cafe/settings', data: settings }].concat(D.defaultMenu().map(({ id, ...rest }) => ({ op: 'set', path: 'menu/' + id, data: rest })));
const stockOps = D.defaultStock(at).map(({ id, ...rest }) => ({ op: 'set', path: 'stock/' + id, data: rest }));
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'seed_menu.json'), JSON.stringify(menuOps, null, 1));
fs.writeFileSync(path.join(__dirname, 'out', 'seed_stock.json'), JSON.stringify(stockOps, null, 1));
console.log(menuOps.length, stockOps.length, JSON.stringify(menuOps).length, JSON.stringify(stockOps).length);
