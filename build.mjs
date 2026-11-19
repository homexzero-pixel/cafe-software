// Builds dist/index.html: one self-contained page (CSS + JS inlined). No dependencies.
// Usage: node build.mjs   (same output as: python3 build.py)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
// Order matters: later files use globals defined by earlier ones.
const order = ['engine.js', 'models.js', 'qr.js', 'data.js', 'ui.js', 'viewer.js', 'ar.js', 'customer.js', 'staff.js', 'app.js'];
let js = order.map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n');
js = js.replace("if (typeof module !== 'undefined') module.exports = QR;", '');
if (/<\/script/i.test(js)) throw new Error('A closing script tag inside the JS would break the page');
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');
const cfg = (() => { const f = join(root, 'config.json'); if (!existsSync(f)) return '{}'; const c = JSON.parse(readFileSync(f, 'utf8')); return JSON.stringify({ supabaseUrl: c.supabaseUrl || '', supabaseKey: c.supabaseKey || '' }).replace(/</g, '\\u003c'); })();
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
// Three pages from one source: guests (index.html), staff (cafe.html) and a combined demo (demo.html).
// They share storage, so an order placed on index.html shows up on cafe.html straight away.
const pages = [['index.html', 'customer', 'Kaapi &amp; Marble, menu and ordering'], ['cafe.html', 'cafe', 'Kaapi &amp; Marble, café dashboard'], ['demo.html', 'both', 'Kaapi &amp; Marble, AR menu and café manager']];
mkdirSync(join(root, 'dist'), { recursive: true });
let size = 0;
for (const [file, app, title] of pages) {
  // replacer functions, so "$&"-style sequences in the code are not treated as patterns
  const out = tpl.replace('/*TITLE*/', () => title).replace('/*APP*/', () => app).replace('/*CSS*/', () => css).replace('/*CONFIG*/{}', () => cfg).replace('/*JS*/', () => js);
  writeFileSync(join(root, 'dist', file), out); size = out.length;
}
console.log('built dist/index.html (customers), dist/cafe.html (staff), dist/demo.html (both)', Math.round(size / 1024), 'KB each');
