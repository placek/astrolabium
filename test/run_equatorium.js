// Runs equatorium.js against the QCAD mock, rebuilds Ptolemy's construction
// from the Almagest parameters independently, and checks every planet on the
// plate against it.  Writes an SVG preview, optionally of one planet's layers.
// usage: node test/run_equatorium.js [diameter] [planet for the preview] [out.svg]
var fs = require('fs'), os = require('os'), path = require('path');
var mock = require('./qcad_mock.js');

var D = parseFloat(process.argv[2] || 200);
var ONE = process.argv[3] || null;
var out = process.argv[4] || null;

var rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
var fails = 0;
function check(name, ok, info) { if (!ok) { fails++; } console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); }
function norm(a) { return ((a % 360) + 360) % 360; }
function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Ptolemy's parameters, transcribed from the Almagest sexagesimals rather than
// copied from the script; deferent radius 60 for every one of them.
var ALMAGEST = {
  Saturn:  { e: 3 + 25 / 60, r: 6 + 30 / 60,  apogee: 233,   equant: true },
  Jupiter: { e: 2 + 45 / 60, r: 11 + 30 / 60, apogee: 161,   equant: true },
  Mars:    { e: 6,           r: 39 + 30 / 60, apogee: 115.5, equant: true },
  Venus:   { e: 1 + 15 / 60, r: 43 + 10 / 60, apogee: 55,    equant: true },
  Sun:     { e: 2 + 30 / 60, r: 0,            apogee: 65.5,  equant: false }
};
var R60 = 60, MEAN = 60, ANOM = 120;         // the script's default arguments
var NAMES = Object.keys(ALMAGEST);

// the common scale: the planet that reaches furthest from the Earth sets it
var reach = 0;
NAMES.forEach(function (n) { reach = Math.max(reach, ALMAGEST[n].e + R60 + ALMAGEST[n].r); });

// the model, built from the description and not from the script
function model(name, Rlimb) {
  var p = ALMAGEST[name], k = 0.88 * Rlimb / reach;
  var Rdef = R60 * k, ecc = p.e * k, Repi = p.r * k;
  var A = rad(p.apogee), kap = rad(MEAN), ano = rad(ANOM);
  var M = { x: ecc * Math.cos(A), y: ecc * Math.sin(A) };
  var E = p.equant ? { x: 2 * ecc * Math.cos(A), y: 2 * ecc * Math.sin(A) } : M;
  var m = p.equant ? ecc : 0;
  var t = -m * Math.cos(kap) + Math.sqrt(Rdef * Rdef - m * m * Math.sin(kap) * Math.sin(kap));
  var C = { x: E.x + t * Math.cos(A + kap), y: E.y + t * Math.sin(A + kap) };
  var P = Repi > 0 ? { x: C.x + Repi * Math.cos(A + kap + ano), y: C.y + Repi * Math.sin(A + kap + ano) } : C;
  return { k: k, Rdef: Rdef, ecc: ecc, Repi: Repi, M: M, E: E, C: C, P: P,
           lon: norm(deg(Math.atan2(P.y, P.x))) };
}

function runAt(diam) {
  return mock.run(path.join(__dirname, '..', 'equatorium.js'), function () { return diam; });
}
var M0 = runAt(D), ents = M0.ents, G = M0.geom, Rlimb = D / 2;
function on(L, kind) { return ents.filter(function (e) { return e.L === L && (!kind || e.kind === kind); }); }

// --- the plate
var want = ['Limb', 'Earth'];
NAMES.forEach(function (n) { want.push(n + '_Deferent', n + '_Epicycle'); });
check('one plate: two shared layers and two per planet',
      Object.keys(M0.layers).join(',') === want.join(','), Object.keys(M0.layers).join(','));
check('the Earth is at the centre of the plate',
      Math.hypot(on('Earth', 'circle')[0].d.c.x, on('Earth', 'circle')[0].d.c.y) < 1e-12);
var limbT = on('Limb', 'line'), uniErr = 0;
limbT.forEach(function (e) {
  var a = norm(deg(Math.atan2(e.d.a.y, e.d.a.x)));
  uniErr = Math.max(uniErr, Math.abs(a - Math.round(a)));
});
check('the limb carries 360 whole-degree divisions and the twelve signs',
      limbT.length === 360 && uniErr < 1e-9 &&
      on('Limb', 'text').filter(function (e) { return /^[A-Z]/.test(e.d.text); }).length === 12);

// --- every planet, against the independent model
var w = {}, worst = { def: 0, eq: 0, epi: 0, pos: 0, lon: 0, out: 0, ptr: 0 };
var defRadii = [];
NAMES.forEach(function (n) {
  var p = ALMAGEST[n], mo = model(n, Rlimb), LD = n + '_Deferent', LE = n + '_Epicycle';
  w[n] = mo;

  // the construction itself
  worst.def = Math.max(worst.def, Math.abs(dist(mo.C, mo.M) - mo.Rdef));
  worst.eq = Math.max(worst.eq, angDiff(deg(Math.atan2(mo.C.y - mo.E.y, mo.C.x - mo.E.x)),
                                        p.apogee + MEAN));
  if (mo.Repi > 0) {
    worst.epi = Math.max(worst.epi, Math.abs(dist(mo.P, mo.C) - mo.Repi),
      angDiff(deg(Math.atan2(mo.P.y - mo.C.y, mo.P.x - mo.C.x)), p.apogee + MEAN + ANOM));
  }

  // the deferent: a circle of the common radius, about this planet's centre
  var big = on(LD, 'circle').filter(function (e) { return Math.abs(e.d.r - mo.Rdef) < 1e-9; });
  var def = big.filter(function (e) { return dist(e.d.c, mo.M) < 1e-9; });
  check(n + ': the deferent is drawn about its own centre', def.length === 1, big.length + ' big circles');
  if (def.length) { defRadii.push(def[0].d.r); }
  var cm = on(LD, 'circle').filter(function (e) { return e.d.r < 0.02 * Rlimb; });
  check(n + ': the deferent centre is marked', cm.length === 1 && dist(cm[0].d.c, mo.M) < 1e-9);
  if (p.equant) {
    check(n + ': the equant circle shares the deferent radius',
          big.filter(function (e) { return dist(e.d.c, mo.E) < 1e-9; }).length === 1);
    var cross = on(LD, 'line').filter(function (e) {
      return Math.hypot((e.d.a.x + e.d.b.x) / 2 - mo.E.x, (e.d.a.y + e.d.b.y) / 2 - mo.E.y) < 1e-9 &&
             Math.hypot(e.d.b.x - e.d.a.x, e.d.b.y - e.d.a.y) < 0.05 * Rlimb;
    });
    check(n + ': the equant is marked with a cross', cross.length === 2, cross.length + ' strokes');
  }
  if (mo.Repi > 0) {
    var epi = on(LE, 'circle').filter(function (e) { return Math.abs(e.d.r - mo.Repi) < 1e-9; });
    check(n + ': the epicycle stands on the deferent', epi.length === 1 && dist(epi[0].d.c, mo.C) < 1e-9);
  }
  var pm = on(LE, 'circle').filter(function (e) { return Math.abs(e.d.r - 0.012 * Rlimb) < 1e-12; });
  worst.pos = Math.max(worst.pos, dist(pm[pm.length - 1].d.c, mo.P));
  worst.lon = Math.max(worst.lon, angDiff(G.solved[n].lon, mo.lon));

  // the pointers: out of the equant through C, and out of the Earth to the limb
  var ptr = on(LE, 'line').filter(function (e) {
    return Math.hypot(e.d.b.x - e.d.a.x, e.d.b.y - e.d.a.y) > 0.1 * Rlimb;
  });
  var mean = ptr.filter(function (e) { return dist(e.d.a, mo.E) < 1e-9; })[0];
  var dx = mean.d.b.x - mean.d.a.x, dy = mean.d.b.y - mean.d.a.y, L = Math.hypot(dx, dy);
  worst.ptr = Math.max(worst.ptr, Math.abs((mo.C.x - mean.d.a.x) * dy - (mo.C.y - mean.d.a.y) * dx) / L,
                       Math.abs(Math.hypot(mean.d.b.x, mean.d.b.y) - Rlimb));
  var sight = ptr.filter(function (e) { return Math.hypot(e.d.a.x, e.d.a.y) < 1e-12; })[0];
  worst.ptr = Math.max(worst.ptr, angDiff(deg(Math.atan2(sight.d.b.y, sight.d.b.x)), mo.lon),
                       Math.abs(Math.hypot(sight.d.b.x, sight.d.b.y) - Rlimb));
});

check('the epicycle centre rides on the deferent', worst.def < 1e-9, 'max err ' + worst.def.toExponential(2));
check('its motion is uniform about the equant', worst.eq < 1e-9, 'max err ' + worst.eq.toExponential(2) + ' deg');
check('the planet sits on the epicycle at its anomaly', worst.epi < 1e-9, 'max err ' + worst.epi.toExponential(2));
check('each planet is drawn where the model puts it', worst.pos < 1e-9, 'max err ' + worst.pos.toExponential(2));
check('the true longitude is the direction of the planet from the Earth',
      worst.lon < 1e-9, 'max err ' + worst.lon.toExponential(2) + ' deg');
check('the mean pointer passes through the epicycle centre, both reach the limb',
      worst.ptr < 1e-9, 'max err ' + worst.ptr.toExponential(2));

// the fact that lets them share a plate at all
check("every deferent has the same radius, Ptolemy's 60",
      defRadii.length === NAMES.length &&
      Math.max.apply(null, defRadii) - Math.min.apply(null, defRadii) < 1e-12 &&
      Math.abs(defRadii[0] - G.Rdef) < 1e-12,
      defRadii.map(function (r) { return r.toFixed(4); }).join(' '));
console.log('  on a ' + D + ' unit plate every deferent is ' + G.Rdef.toFixed(2) +
            ' units; only these differ:');
NAMES.forEach(function (n) {
  console.log('    ' + (n + '        ').slice(0, 9) + 'apse ' + (ALMAGEST[n].apogee + '    ').slice(0, 5) +
              ' deg   e ' + w[n].ecc.toFixed(2) + '   epicycle ' + ('    ' + w[n].Repi.toFixed(2)).slice(-5) +
              '   -> longitude ' + w[n].lon.toFixed(3) + ' deg');
});

// --- the Sun is a simple eccentric
check('the Sun has no equant and no epicycle',
      on('Sun_Deferent', 'circle').length === 2 &&       // the deferent and its centre
      on('Sun_Epicycle', 'circle').length === 1 &&       // the Sun itself
      dist(G.solved.Sun.E, G.solved.Sun.M) < 1e-12);
check('and the Sun itself rides on the deferent',
      Math.abs(dist(G.solved.Sun.P, G.solved.Sun.M) - G.Rdef) < 1e-9);

// --- nothing may leave the limb
ents.forEach(function (e) {
  var ps = e.kind === 'text' ? [[e.d.pos.x, e.d.pos.y]]
         : e.kind === 'circle' ? [] : [[e.d.a.x, e.d.a.y], [e.d.b.x, e.d.b.y]];
  if (e.kind === 'circle') { worst.out = Math.max(worst.out, Math.hypot(e.d.c.x, e.d.c.y) + e.d.r - Rlimb); }
  ps.forEach(function (q) { worst.out = Math.max(worst.out, Math.hypot(q[0], q[1]) - Rlimb); });
});
check('nothing is drawn outside the limb', worst.out < 1e-9,
      'max overshoot ' + (worst.out / Rlimb).toFixed(4) + ' Rlimb');

// --- the plate scales without changing a single reading
var M2 = runAt(120), lonErr = 0;
NAMES.forEach(function (n) { lonErr = Math.max(lonErr, angDiff(M2.geom.solved[n].lon, G.solved[n].lon)); });
check('the longitudes do not depend on the size of the plate', lonErr < 1e-12,
      'max difference ' + lonErr.toExponential(2) + ' deg');

// --- Mercury and the Moon are refused rather than drawn with the wrong model
var tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'equat-')), 'mercury.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'equatorium.js'), 'utf8')
  .replace('planets: ["Saturn", "Jupiter", "Mars", "Venus", "Sun"]', 'planets: ["Mars", "Mercury"]'));
var refused = false;
try { mock.run(tmp, function () { return D; }); }
catch (e) { refused = /Mercury and the Moon/.test(String(e.message)); }
check('Mercury is refused, not drawn with the wrong model', refused);

// --- layers and weights
check('every layer defaults to hairline',
      M0.layerObjs.length === want.length &&
      M0.layerObjs.every(function (l) { return l.lineweight === M0.g.RLineweight.Weight000; }));
check('no entity carries its own weight',
      ents.every(function (e) { return e.lw === M0.g.RLineweight.WeightByLayer; }), ents.length + ' entities');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');

// SVG preview - the whole plate, or one planet's layers over the shared plate
if (out) {
  var hue = { Saturn: '#46467a', Jupiter: '#8c5a14', Mars: '#aa1e1e', Venus: '#147850', Sun: '#a58200' };
  var col = { Limb: '#555', Earth: '#c80000' };
  NAMES.forEach(function (n) { col[n + '_Deferent'] = hue[n]; col[n + '_Epicycle'] = hue[n]; });
  var shown = ents.filter(function (e) {
    return !ONE || e.L === 'Limb' || e.L === 'Earth' || e.L.indexOf(ONE + '_') === 0;
  });
  var S2 = Rlimb * 1.04, sw = D / 700, svg = [];
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + -S2 + ' ' + -S2 + ' ' + 2 * S2 + ' ' + 2 * S2 +
           '" width="1400" height="1400"><rect x="' + -S2 + '" y="' + -S2 + '" width="' + 2 * S2 +
           '" height="' + 2 * S2 + '" fill="white"/><g transform="scale(1,-1)" fill="none" stroke-width="' + sw + '">');
  shown.forEach(function (e) {
    var c = col[e.L] || '#000', d = e.d;
    if (e.kind === 'line') svg.push('<line x1="' + d.a.x + '" y1="' + d.a.y + '" x2="' + d.b.x + '" y2="' + d.b.y + '" stroke="' + c + '"/>');
    else if (e.kind === 'circle') svg.push('<circle cx="' + d.c.x + '" cy="' + d.c.y + '" r="' + d.r + '" stroke="' + c + '"/>');
    else if (e.kind === 'text') svg.push('<text transform="translate(' + d.pos.x + ' ' + d.pos.y + ') scale(1,-1) rotate(' +
      (-deg(d.ang)) + ')" font-size="' + d.h + '" text-anchor="middle" dominant-baseline="central" fill="' + c +
      '" stroke="none" font-family="sans-serif">' + d.text + '</text>');
  });
  svg.push('</g></svg>');
  fs.writeFileSync(out, svg.join('\n'));
}
process.exit(fails ? 1 : 0);
