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
// replacer functions, so "$&"-style sequences in the code are not treated as patterns
const out = readFileSync(join(root, 'src', 'template.html'), 'utf8').replace('/*CSS*/', () => css).replace('/*JS*/', () => js)
  // optional config.json (Supabase URL + anon key) for your own hosting; see config.example.json
  .replace('/*CONFIG*/{}', () => { const f = join(root, 'config.json'); if (!existsSync(f)) return '{}'; const c = JSON.parse(readFileSync(f, 'utf8')); return JSON.stringify({ supabaseUrl: c.supabaseUrl || '', supabaseKey: c.supabaseKey || '' }).replace(/</g, '\\u003c'); });
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), out);
console.log('built dist/index.html', Math.round(out.length / 1024), 'KB');
