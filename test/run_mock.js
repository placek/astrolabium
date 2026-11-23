// Runs astrolabe.js against a minimal mock of the QCAD API, verifies the
// geometry independently and writes an SVG preview.
// usage: node test/run_mock.js <diameter> <latitude> [out.svg]
var fs = require('fs'), vm = require('vm'), path = require('path');
var D = parseFloat(process.argv[2] || 200), LAT = parseFloat(process.argv[3] || 50);
var out = process.argv[4] || null;

var ents = [], layers = {}, nextId = 1;
function V(x, y) { this.x = x; this.y = y; }
function Ent(kind, d) { this.kind = kind; this.d = d; this.layer = null; }
Ent.prototype.setLayerId = function (id) { this.layer = id; };
var g = {
  __ASTROLABE_TEST__: {},
  include: function () {},
  qDebug: function (s) { console.log(s); },
  RVector: V,
  RColor: function (r, gg, b) { this.c = [r, gg, b]; },
  RLineweight: { Weight025: 1 },
  RS: { VAlignMiddle: 1, HAlignCenter: 1, LeftToRight: 1, Exact: 1 },
  RLayer: function (doc, name) { this.name = name; },
  RLineData: function (a, b) { this.a = a; this.b = b; },
  RCircleData: function (c, r) { this.c = c; this.r = r; },
  RArcData: function (c, r, a0, a1, rev) { this.c = c; this.r = r; this.a0 = a0; this.a1 = a1; },
  RTextData: function (pos, p2, h, w, va, ha, dd, ls, lf, text, font) {
    var a = arguments; this.pos = pos; this.h = h; this.text = text;
    // accept only the 15-arg signature (without fontFile) to exercise the fallback
    if (a.length === 16) throw new Error('bad signature');
    this.ang = a[13];
  },
  RLineEntity: function (doc, d) { return new Ent('line', d); },
  RCircleEntity: function (doc, d) { return new Ent('circle', d); },
  RArcEntity: function (doc, d) { return new Ent('arc', d); },
  RTextEntity: function (doc, d) { return new Ent('text', d); },
  RAddObjectOperation: function () {
    this.objs = [];
    this.addObject = function (o) { this.objs.push(o); };
    this.setText = function () {};
  },
  QInputDialog: { getDouble: function (p, t, l, def) { return /Diameter/.test(l) ? D : LAT; } },
  EAction: {
    getMainWindow: function () { return {}; },
    getDocumentInterface: function () {
      return {
        getDocument: function () {
          return { hasLayer: function (n) { return !!layers[n]; },
                   getLayerId: function (n) { return layers[n] || (layers[n] = nextId++); },
                   getLinetypeId: function () { return 0; } };
        },
        applyOperation: function (op) {
          op.objs.forEach(function (o) {
            if (o.name) { layers[o.name] = nextId++; }
            else { ents.push(o); }
          });
        },
        autoZoom: function () {}
      };
    }
  }
};
g.RLayer.prototype.setColor = function () {};
vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'astrolabe.js'), 'utf8'), g);
var G = g.__ASTROLABE_TEST__.geom;
var layerName = {}; Object.keys(layers).forEach(function (n) { layerName[layers[n]] = n; });
ents.forEach(function (e) { e.L = layerName[e.layer]; });

var rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
var fails = 0;
function check(name, ok, info) { if (!ok) { fails++; } console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); }

// inverse stereographic: plate -> (altitude, azimuth from south, west positive)
function inv(x, y) {
  var r = Math.hypot(x, y), p = 2 * Math.atan(r / G.Req), d = Math.PI / 2 - p, H = Math.atan2(x, y), f = rad(G.phi);
  var h = Math.asin(Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H));
  var A = Math.atan2(Math.cos(d) * Math.sin(H), Math.sin(f) * Math.cos(d) * Math.cos(H) - Math.cos(f) * Math.sin(d));
  return { h: deg(h), A: deg(A) };
}
function samples(e) {
  var c = e.d.c, r = e.d.r, a0 = e.kind === 'circle' ? 0 : e.d.a0, a1 = e.kind === 'circle' ? 2 * Math.PI : e.d.a1, s = [];
  if (a1 < a0) a1 += 2 * Math.PI;
  for (var i = 0; i <= 40; i++) { var a = a0 + (a1 - a0) * i / 40; s.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); }
  return s;
}
function curves(L) { return ents.filter(function (e) { return e.L === L && (e.kind === 'arc' || e.kind === 'circle'); }); }

// 1. circles
var rr = function (L) { return curves(L)[0].d.r; };
check('equator radius', Math.abs(rr('Equator') - G.Req) < 1e-9);
check('capricorn radius = D/2', Math.abs(rr('Tropic_Capricorn') - D / 2) < 1e-9);
check('cancer radius', Math.abs(rr('Tropic_Cancer') - G.Req * Math.tan(rad(45 - 23.4393 / 2))) < 1e-9);

// 2. horizon: altitude 0 along every sample
var worst = 0;
curves('Horizon').forEach(function (e) { samples(e).forEach(function (p) { worst = Math.max(worst, Math.abs(inv(p[0], p[1]).h)); }); });
check('horizon altitude == 0', worst < 1e-9, 'max err ' + worst.toExponential(2) + ' deg');

// 3. almucantars: constant altitude, multiple of step
worst = 0; var alts = {};
curves('Almucantars').filter(function (e) { return e.d.r > 0.01 * D / 2; }).forEach(function (e) {
  var hs = samples(e).map(function (p) { return inv(p[0], p[1]).h; });
  var m = hs.reduce(function (a, b) { return a + b; }, 0) / hs.length;
  hs.forEach(function (h) { worst = Math.max(worst, Math.abs(h - m)); });
  alts[Math.round(m)] = Math.max(Math.abs(m - Math.round(m / 5) * 5), alts[Math.round(m)] || 0);
});
check('almucantars constant altitude', worst < 1e-8, 'max spread ' + worst.toExponential(2) + ' deg');
check('almucantars at multiples of 5', Math.max.apply(null, Object.keys(alts).map(function (k) { return alts[k]; })) < 1e-8, 'altitudes: ' + Object.keys(alts).sort(function (a, b) { return a - b; }).join(','));

// 4. azimuth: constant azimuth along arc; multiples of 10; lines
worst = 0; var azs = {};
curves('Azimuth').forEach(function (e) {
  var as = samples(e).filter(function (p) { return inv(p[0], p[1]).h < 89.99; }).map(function (p) { return inv(p[0], p[1]).A; });
  as.forEach(function (a) { worst = Math.max(worst, Math.abs(((a - as[0] + 540) % 360) - 180)); });
  var A = ((as[0] % 360) + 360) % 360; azs[Math.round(A)] = Math.abs(A - Math.round(A / 10) * 10);
});
check('azimuth arcs constant azimuth', worst < 1e-8, 'max spread ' + worst.toExponential(2) + ' deg');
check('azimuth arcs at multiples of 10', Math.max.apply(null, Object.keys(azs).map(function (k) { return azs[k]; })) < 1e-8);
console.log('  azimuth arcs: ' + curves('Azimuth').length + ' + ' + ents.filter(function (e) { return e.L === 'Azimuth' && e.kind === 'line'; }).length + ' straight');

// 5. everything inside Capricorn circle
var out_ = 0;
['Horizon', 'Almucantars', 'Azimuth'].forEach(function (L) {
  curves(L).forEach(function (e) { samples(e).forEach(function (p) { out_ = Math.max(out_, Math.hypot(p[0], p[1]) - D / 2); }); });
});
check('clipped to plate', out_ < 1e-8, 'max overshoot ' + out_.toExponential(2));

// 6. ecliptic: all 360 longitudes lie on one circle; tangent to both tropics
var e0 = curves('Ecliptic')[0].d; worst = 0;
for (var L = 0; L < 360; L += 0.5) { var p = G.plateFromEcliptic(L); worst = Math.max(worst, Math.abs(Math.hypot(p.x - e0.c.x, p.y - e0.c.y) - e0.r)); }
check('ecliptic is the circle through every longitude', worst < 1e-9, 'max err ' + worst.toExponential(2));
check('ecliptic tangent to tropics', Math.abs(e0.c.y + e0.r - G.Rcan) < 1e-9 && Math.abs(e0.c.y - e0.r + D / 2) < 1e-9);

// 7. calendar sanity: Sun longitude at equinoxes/solstices of 2026
var jd = function (m, d, h) { return G.julianDay(2026, m, d) + h / 24; };
var lon = function (m, d, h) { return G.sunLongitude(jd(m, d, h)); };
check('Mar equinox 2026-03-20 14:46 UT -> ~0', Math.abs(((lon(3, 20, 14.77) + 180) % 360) - 180) < 0.05, lon(3, 20, 14.77).toFixed(3));
check('Jun solstice 2026-06-21 08:24 UT -> ~90', Math.abs(lon(6, 21, 8.4) - 90) < 0.05, lon(6, 21, 8.4).toFixed(3));
check('Dec solstice 2026-12-21 20:50 UT -> ~270', Math.abs(lon(12, 21, 20.83) - 270) < 0.05, lon(12, 21, 20.83).toFixed(3));

// 8. counts
function n(L, k) { return ents.filter(function (e) { return e.L === L && (!k || e.kind === k); }).length; }
console.log('  zodiac ticks (lines): ' + n('Ecliptic_Zodiac', 'line') + ', calendar lines: ' + n('Ecliptic_Calendar', 'line') + ', limb lines: ' + n('Limb', 'line'));
check('360 zodiac ticks', n('Ecliptic_Zodiac', 'line') === 360);
check('365 calendar ticks', n('Ecliptic_Calendar', 'line') === 365);
check('360 limb ticks', n('Limb', 'line') === 360);
check('texts created', n('Ecliptic_Calendar', 'text') > 12 && n('Limb', 'text') === 36);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');

// SVG preview
if (out) {
  var col = { Equator: '#00a000', Tropic_Cancer: '#dc7800', Tropic_Capricorn: '#1e5ae6', Horizon: '#dc0000', Almucantars: '#0096be', Azimuth: '#963cc8', Ecliptic: '#c8a000', Ecliptic_Zodiac: '#be6414', Ecliptic_Calendar: '#787814', Index: '#e6288c', Limb: '#555', Axes: '#aaa', Pole: '#333' };
  var S = G.Rl * 1.08, sw = D / 700, svg = [];
  svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + -S + ' ' + -S + ' ' + 2 * S + ' ' + 2 * S + '" width="1400" height="1400"><rect x="' + -S + '" y="' + -S + '" width="' + 2 * S + '" height="' + 2 * S + '" fill="white"/><g transform="scale(1,-1)" fill="none" stroke-width="' + sw + '">');
  ents.forEach(function (e) {
    var c = col[e.L] || '#000', d = e.d;
    if (e.kind === 'line') svg.push('<line x1="' + d.a.x + '" y1="' + d.a.y + '" x2="' + d.b.x + '" y2="' + d.b.y + '" stroke="' + c + '"/>');
    else if (e.kind === 'circle') svg.push('<circle cx="' + d.c.x + '" cy="' + d.c.y + '" r="' + d.r + '" stroke="' + c + '"/>');
    else if (e.kind === 'arc') {
      var a1 = d.a1; if (a1 < d.a0) a1 += 2 * Math.PI; var sweep = a1 - d.a0;
      svg.push('<path d="M' + (d.c.x + d.r * Math.cos(d.a0)) + ' ' + (d.c.y + d.r * Math.sin(d.a0)) + ' A' + d.r + ' ' + d.r + ' 0 ' + (sweep > Math.PI ? 1 : 0) + ' 1 ' + (d.c.x + d.r * Math.cos(a1)) + ' ' + (d.c.y + d.r * Math.sin(a1)) + '" stroke="' + c + '"/>');
    } else if (e.kind === 'text') {
      svg.push('<text transform="translate(' + d.pos.x + ' ' + d.pos.y + ') scale(1,-1) rotate(' + (-deg(d.ang)) + ')" font-size="' + d.h + '" text-anchor="middle" dominant-baseline="central" fill="' + c + '" stroke="none" font-family="sans-serif">' + d.text + '</text>');
    }
  });
  svg.push('</g></svg>');
  fs.writeFileSync(out, svg.join('\n'));
}
process.exit(fails ? 1 : 0);
