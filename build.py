import re, sys, json, pathlib
root = pathlib.Path(__file__).parent
order = ['engine.js', 'models.js', 'qr.js', 'data.js', 'ui.js', 'printer.js', 'viewer.js', 'ar.js', 'customer.js', 'staff.js', 'app.js']
js = '\n'.join((root / 'src' / f).read_text() for f in order)
js = js.replace("if (typeof module !== 'undefined') module.exports = QR;", '')
css = (root / 'src' / 'styles.css').read_text()
assert '</script' not in js.lower(), 'closing script tag inside JS'
tpl = (root / 'src' / 'template.html').read_text()
cfg = {}
if (root / 'config.json').exists():
    c = json.loads((root / 'config.json').read_text())
    cfg = {'supabaseUrl': c.get('supabaseUrl', ''), 'supabaseKey': c.get('supabaseKey', '')}
pages = [('index.html', 'customer', 'Kaapi &amp; Marble, menu and ordering'), ('cafe.html', 'cafe', 'Kaapi &amp; Marble, café dashboard'), ('demo.html', 'both', 'Kaapi &amp; Marble, AR menu and café manager')]
(root / 'dist').mkdir(exist_ok=True)
for f, app, title in pages:
    out = tpl.replace('/*TITLE*/', title).replace('/*APP*/', app).replace('/*CSS*/', css).replace('/*CONFIG*/{}', json.dumps(cfg).replace('<', '\\u003c')).replace('/*JS*/', js)
    (root / 'dist' / f).write_text(out)
print('built dist/index.html, dist/cafe.html, dist/demo.html', len(out) // 1024, 'KB each')
