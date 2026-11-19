const fs = require('fs'); const vm = require('vm');
const src = fs.readFileSync(__dirname + '/../src/engine.js', 'utf8') + '\nthis.E3 = E3;';
const ctx = { Math, console, Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Map, Array, Object, Number, parseInt, Infinity, document: {} };
vm.createContext(ctx); vm.runInContext(src, ctx);
const E3 = ctx.E3;
function check(name, g) {
  let bad = 0, tot = 0;
  for (let t = 0; t < g.i.length; t += 3) {
    const [a,b,c] = [g.i[t], g.i[t+1], g.i[t+2]];
    const P = (v) => [g.p[v*3], g.p[v*3+1], g.p[v*3+2]];
    const N = (v) => [g.n[v*3], g.n[v*3+1], g.n[v*3+2]];
    const u = E3.V.sub(P(b), P(a)), w = E3.V.sub(P(c), P(a));
    const fn = E3.V.cross(u, w); if (E3.V.len(fn) < 1e-14) continue;
    const vn = E3.V.add(E3.V.add(N(a), N(b)), N(c));
    tot++; if (E3.V.dot(fn, vn) < 0) bad++;
  }
  console.log((bad ? 'FAIL ' : 'ok   ') + name.padEnd(14), 'tris', tot, 'inverted', bad);
}
check('sphere', E3.sphere(1));
check('dome', E3.dome(1, 0.6));
check('cylinder', E3.cylinder(1, 0.8, 2));
check('puck', E3.puck(1, 0.3, 0.1));
check('torus', E3.torus(1, 0.3));
check('torusArc', E3.torus(1, 0.3, 32, 12, {v0: -0.3, v1: Math.PI + 0.3}));
check('disc', E3.disc(1));
check('plane', E3.plane(1, 1));
check('rbox', E3.roundedBox(1, 0.5, 0.8, 0.1));
const ex = E3.extrude([[0,0],[1,0],[0.5,0.8]], 0.3, {bevel: 0.05});
check('extrude', ex.all);
const ex2 = E3.extrude([[0,0],[0.5,0.8],[1,0]], 0.3, {});
check('extrudeCW', ex2.all);
check('tube', E3.tube((t) => [Math.cos(t*3), t, Math.sin(t*3)], 0.1, 40, 8));
const lt = E3.lathe([[0,0],[1,0],[1,0],[1.2,1],[1.1,1.05],[0.9,0.95],[0,0.2]]);
check('cupLathe', lt);
const d = E3.displace(E3.sphere(1), (x,y,z)=>0.1*E3.noise3(x*3,y*3,z*3)); check('displaced', d);
const m = E3.roundedBox(1,1,1,0.1).apply(E3.M4.S(-1,1,1)); check('mirrored', m);
const sq = E3.tube((t)=>[t,0,0], 0.1, 10, 8, {squash:0.5}); check('tubeSquash', sq);
