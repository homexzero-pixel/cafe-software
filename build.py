import re, sys, json, pathlib
root = pathlib.Path(__file__).parent
order = ['engine.js', 'models.js', 'qr.js', 'data.js', 'ui.js', 'viewer.js', 'ar.js', 'customer.js', 'staff.js', 'app.js']
js = '\n'.join((root / 'src' / f).read_text() for f in order)
js = js.replace("if (typeof module !== 'undefined') module.exports = QR;", '')
css = (root / 'src' / 'styles.css').read_text()
assert '</script' not in js.lower(), 'closing script tag inside JS'
tpl = (root / 'src' / 'template.html').read_text()
cfg = {}
if (root / 'config.json').exists():
    c = json.loads((root / 'config.json').read_text())
    cfg = {'supabaseUrl': c.get('supabaseUrl', ''), 'supabaseKey': c.get('supabaseKey', '')}
out = tpl.replace('/*CSS*/', css).replace('/*CONFIG*/{}', json.dumps(cfg).replace('<', '\\u003c')).replace('/*JS*/', js)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist' / 'index.html').write_text(out)
print('built', len(out) // 1024, 'KB')
