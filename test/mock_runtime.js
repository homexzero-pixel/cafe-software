// In-memory stand-in for the artifact runtime: claude.use('db' | 'user' | 'downloads')
(() => {
  const store = new Map(); const listeners = new Set(); let ver = 0;
  const segs = (p) => p.split('/').filter(Boolean);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const snapDoc = (path) => { const d = store.get(path); return { id: segs(path).pop(), exists: !!d, data: () => (d ? clone(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const notify = () => setTimeout(() => { for (const l of [...listeners]) l(); }, 5);
  function query(col, filters = [], ob = null, lim = null) {
    const q = {
      where: (f, op, v) => query(col, [...filters, [f, op, v]], ob, lim),
      orderBy: (f, dir = 'asc') => query(col, filters, [f, dir], lim),
      limit: (n) => query(col, filters, ob, n),
      run() {
        const n = segs(col).length + 1;
        let docs = [...store.keys()].filter((k) => k.startsWith(col + '/') && segs(k).length === n).map(snapDoc);
        const cmp = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
        for (const [f, op, v] of filters) docs = docs.filter((d) => cmp[op](d.data()[f], v));
        if (ob) docs.sort((a, b) => { const x = a.data()[ob[0]], y = b.data()[ob[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (ob[1] === 'desc' ? -1 : 1); });
        else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
        if (lim) docs = docs.slice(0, lim);
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
      },
      get: async () => q.run(),
      onSnapshot(next, err) { const l = () => next(q.run()); listeners.add(l); setTimeout(l, 20); return () => listeners.delete(l); },
    };
    return q;
  }
  function docRef(path) {
    if (segs(path).length % 2) throw new TypeError('doc path needs even segments: ' + path);
    return {
      id: segs(path).pop(), path,
      get: async () => snapDoc(path),
      set: async (d) => { if (typeof d !== 'object' || Array.isArray(d)) throw { code: 'invalid_argument' }; store.set(path, clone(d)); window.__writes = (window.__writes || 0) + 1; notify(); },
      update: async (d) => { if (!store.has(path)) throw { code: 'invalid_argument', message: 'missing' }; const cur = store.get(path); const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], b[k]); else a[k] = clone(b[k]); } }; merge(cur, d); notify(); },
      delete: async () => { store.delete(path); notify(); },
      acquire: async () => ({ acquired: true, version: ++ver }),
      onSnapshot(next) { const l = () => next(snapDoc(path)); listeners.add(l); setTimeout(l, 20); return () => listeners.delete(l); },
      collection: (sub) => collRef(path + '/' + sub),
    };
  }
  function collRef(path) { if (segs(path).length % 2 === 0) throw new TypeError('collection path needs odd segments: ' + path); const q = query(path); return Object.assign(q, { path, doc: (id) => docRef(path + '/' + (id || Math.random().toString(36).slice(2))), add: async (d) => { const r = docRef(path + '/' + Math.random().toString(36).slice(2)); await r.set(d); return r; } }); }
  const db = Object.freeze({ doc: docRef, collection: collRef });
  window.__store = store;
  window.claude = { use: async (n) => { await new Promise((r) => setTimeout(r, 120)); if (n === 'db') return db; if (n === 'user') return { id: async () => 'u_owner', canEdit: async () => true, isOwner: async () => true }; if (n === 'downloads') return { save: async ({ filename, data }) => { window.__saved = [filename, String(data).length]; return { status: 'saved' }; } }; return null; } };
})();
