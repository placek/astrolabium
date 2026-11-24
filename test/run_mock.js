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

// 3b. twilight: constant altitude at -6, -12, -18
worst = 0; var tw = {};
curves('Twilight').forEach(function (e) {
  var hs = samples(e).map(function (p) { return inv(p[0], p[1]).h; });
  var m = hs.reduce(function (a, b) { return a + b; }, 0) / hs.length;
  hs.forEach(function (h) { worst = Math.max(worst, Math.abs(h - m)); });
  tw[Math.round(m)] = Math.max(Math.abs(m - Math.round(m)), tw[Math.round(m)] || 0);
});
var twAlts = Object.keys(tw).map(Number).sort(function (a, b) { return a - b; });
check('twilight arcs constant altitude', worst < 1e-8, 'max spread ' + worst.toExponential(2) + ' deg');
check('twilight at -18, -12, -6', twAlts.join(',') === '-18,-12,-6' &&
      twAlts.every(function (a) { return tw[a] < 1e-8; }), 'altitudes: ' + twAlts.join(','));
check('twilight curves clipped to the plate', curves('Twilight').every(function (e) {
  return samples(e).every(function (p) { return Math.hypot(p[0], p[1]) <= D / 2 + 1e-8; }); }));
check('each twilight curve labelled', ents.filter(function (e) { return e.L === 'Twilight' && e.kind === 'text'; })
      .map(function (e) { return Number(e.d.text); }).sort(function (a, b) { return a - b; }).join(',') === '-18,-12,-6');

// 3c. unequal hours: each curve divides the night of Capricorn, Equator and
// Cancer at the same k/12, and lies below the horizon
function decOf(x, y) { return Math.PI / 2 - 2 * Math.atan(Math.hypot(x, y) / G.Req); }
function nightFraction(x, y) {           // 0 at sunset, 1 at sunrise
  var d = decOf(x, y), H0 = Math.acos(-Math.tan(rad(G.phi)) * Math.tan(d));
  var H = Math.atan2(x, y); if (H < 0) { H += 2 * Math.PI; }
  return (H - H0) / (2 * Math.PI - 2 * H0);
}
var hourEnts = ents.filter(function (e) { return e.L === 'Unequal_Hours' && e.kind !== 'text'; });
// above the Arctic circle Capricorn never rises, so the construction is dropped
var hoursPossible = Math.abs(Math.tan(rad(G.phi)) * Math.tan(rad(23.4393))) < 1;
if (!hoursPossible) {
  check('unequal hours dropped above the Arctic circle', ents.filter(function (e) { return e.L === 'Unequal_Hours'; }).length === 0);
} else {
check('11 unequal hour lines', hourEnts.length === 11, hourEnts.length + ' curve(s)');
var ends = {}, radErr = 0, fracErr = 0, eqErr = 0, maxAlt = -90, check_eq = 0;
hourEnts.forEach(function (e) {
  var ps = e.kind === 'line' ? [[e.d.a.x, e.d.a.y], [e.d.b.x, e.d.b.y]]
                             : samples(e).filter(function (p, i, a) { return i === 0 || i === a.length - 1; });
  var k = Math.round(nightFraction(ps[0][0], ps[0][1]) * 12);
  ends[k] = (ends[k] || 0) + 1;
  // ends sit on Capricorn and on the Tropic of Cancer
  var rs = ps.map(function (p) { return Math.hypot(p[0], p[1]); }).sort(function (a, b) { return a - b; });
  radErr = Math.max(radErr, Math.abs(rs[0] - G.Rcan), Math.abs(rs[1] - D / 2));
  ps.forEach(function (p) { fracErr = Math.max(fracErr, Math.abs(nightFraction(p[0], p[1]) * 12 - k)); });
  // where the curve crosses the equator it must divide that night at the same
  // k/12 - solved exactly, not sampled
  var cross = null;
  if (e.kind === 'line') {                       // |p1 + t (p2 - p1)| = Req
    var p1 = [e.d.a.x, e.d.a.y], dx = e.d.b.x - p1[0], dy = e.d.b.y - p1[1];
    var A = dx * dx + dy * dy, B = 2 * (p1[0] * dx + p1[1] * dy), C = p1[0] * p1[0] + p1[1] * p1[1] - G.Req * G.Req;
    var disc = B * B - 4 * A * C;
    if (disc >= 0) { [( -B + Math.sqrt(disc)) / (2 * A), (-B - Math.sqrt(disc)) / (2 * A)].forEach(function (t) {
      if (t >= -1e-9 && t <= 1 + 1e-9) { cross = [p1[0] + t * dx, p1[1] + t * dy]; } }); }
  } else {                                       // |c + r e(t)| = Req  ->  R cos(t - f0) = K
    var c = e.d, R = Math.hypot(c.c.x, c.c.y), f0 = Math.atan2(c.c.y, c.c.x);
    var K = (G.Req * G.Req - R * R - c.r * c.r) / (2 * c.r);
    if (R > 1e-12 && Math.abs(K / R) <= 1) {
      var a1 = c.a1 < c.a0 ? c.a1 + 2 * Math.PI : c.a1;
      [f0 + Math.acos(K / R), f0 - Math.acos(K / R)].forEach(function (t) {
        var tt = c.a0 + (((t - c.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (tt <= a1 + 1e-12) { cross = [c.c.x + c.r * Math.cos(tt), c.c.y + c.r * Math.sin(tt)]; }
      });
    }
  }
  check_eq += cross ? 0 : 1;
  if (cross) { eqErr = Math.max(eqErr, Math.abs(nightFraction(cross[0], cross[1]) * 12 - k)); }
  (e.kind === 'line' ? ps : samples(e)).forEach(function (p) { maxAlt = Math.max(maxAlt, inv(p[0], p[1]).h); });
});
check('one curve per hour 1..11', Object.keys(ends).map(Number).sort(function (a, b) { return a - b; }).join(',') === '1,2,3,4,5,6,7,8,9,10,11');
check('hour curves end on Capricorn and Cancer', radErr < 1e-9, 'max err ' + radErr.toExponential(2));
check('endpoints divide the night exactly', fracErr < 1e-12, 'max err ' + fracErr.toExponential(2) + ' hours');
check('every curve crosses the equator', check_eq === 0, check_eq + ' without a crossing');
check('equator crossing divides the night', eqErr < 1e-9, 'max err ' + eqErr.toExponential(2) + ' hours');
check('hour curves stay below the horizon', maxAlt < 1e-9, 'max altitude ' + maxAlt.toExponential(2) + ' deg');
check('12 hour numbers', ents.filter(function (e) { return e.L === 'Unequal_Hours' && e.kind === 'text'; })
      .map(function (e) { return Number(e.d.text); }).sort(function (a, b) { return a - b; }).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12');
}

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

var limbW_ = G.limbW;
// 7b. one ecliptic line, both scales straddling it: calendar outside, zodiac inside
function bandEnts(L) { return ents.filter(function (e) { return e.L === L; }); }
function rEcl(x, y) { return Math.hypot(x, y - G.eclCy); }
function radii(e) {
  var r1 = rEcl(e.d.a.x, e.d.a.y), r2 = rEcl(e.d.b.x, e.d.b.y);
  return { lo: Math.min(r1, r2), hi: Math.max(r1, r2) };
}
// no extra scale ring: the Ecliptic circle is the only curve of the whole band
var ringR = ['Ecliptic', 'Ecliptic_Zodiac', 'Ecliptic_Calendar'].reduce(function (a, L) {
  return a.concat(curves(L).map(function (e) { return e.d.r; })); }, []);
check('the ecliptic line is the only band circle', ringR.length === 1 && Math.abs(ringR[0] - G.Re) < 1e-9,
      'radii ' + ringR.map(function (r) { return r.toFixed(3); }).join(', '));

var cBase = 0, cOut = 0;
bandEnts('Ecliptic_Calendar').filter(function (e) { return e.kind === 'line'; }).forEach(function (e) {
  var r = radii(e); cBase = Math.max(cBase, Math.abs(r.lo - G.Re)); cOut = Math.max(cOut, r.hi - G.Re);
});
check('calendar ticks start on the ecliptic line', cBase < 1e-9, 'max err ' + cBase.toExponential(2));
check('calendar ticks run outwards only', cOut > 0 && cOut <= G.calOut + 1e-9, 'max reach ' + (cOut / (D / 2)).toFixed(3) + ' Rc');
var zBase = 0, zIn = 0;
bandEnts('Ecliptic_Zodiac').filter(function (e) { return e.kind === 'line'; }).forEach(function (e) {
  var r = radii(e); zBase = Math.max(zBase, Math.abs(r.hi - G.Re)); zIn = Math.max(zIn, G.Re - r.lo);
});
check('zodiac ticks start on the ecliptic line', zBase < 1e-9, 'max err ' + zBase.toExponential(2));
check('zodiac ticks run inwards only', zIn > 0 && zIn <= G.zodIn + 1e-9, 'max reach ' + (zIn / (D / 2)).toFixed(3) + ' Rc');
// the two scales never cross to the wrong side of the line
var sideErr = 0;
bandEnts('Ecliptic_Calendar').forEach(function (e) {
  var rs = e.kind === 'text' ? [rEcl(e.d.pos.x, e.d.pos.y)] : [radii(e).lo, radii(e).hi];
  rs.forEach(function (r) { sideErr = Math.max(sideErr, G.Re - r); });
});
bandEnts('Ecliptic_Zodiac').forEach(function (e) {
  var rs = e.kind === 'text' ? [rEcl(e.d.pos.x, e.d.pos.y)] : [radii(e).lo, radii(e).hi];
  rs.forEach(function (r) { sideErr = Math.max(sideErr, r - G.Re); });
});
check('calendar outside / zodiac inside the line', sideErr < 1e-9, 'max crossing ' + sideErr.toExponential(2));
// the calendar leans past the plate edge where the ecliptic touches Capricorn,
// into the annulus the limb scale now occupies
var over = 0, clash = [];
bandEnts('Ecliptic_Calendar').forEach(function (e) {
  var ps = e.kind === 'text' ? [[e.d.pos.x, e.d.pos.y]] : [[e.d.a.x, e.d.a.y], [e.d.b.x, e.d.b.y]];
  ps.forEach(function (p) {
    var d = Math.hypot(p[0], p[1]) - D / 2;
    if (d > 0) { over = Math.max(over, d); clash.push(((90 - deg(Math.atan2(p[1], p[0]))) + 360) % 360); }
  });
});
console.log('  calendar reaches ' + (over / (D / 2)).toFixed(3) + ' Rc past Capricorn, over the limb scale (' +
            (limbW_ / (D / 2)).toFixed(3) + ' Rc deep) between limb ' +
            Math.round(Math.min.apply(null, clash)) + ' and ' + Math.round(Math.max.apply(null, clash)) + ' deg');

// 7c. limb: a bare scale standing on the Tropic of Capricorn
check('limb has no circle', curves('Limb').length === 0, curves('Limb').length + ' circle(s)');
var lBase = 0, lOut = 0;
ents.filter(function (e) { return e.L === 'Limb' && e.kind === 'line'; }).forEach(function (e) {
  var r1 = Math.hypot(e.d.a.x, e.d.a.y), r2 = Math.hypot(e.d.b.x, e.d.b.y);
  lBase = Math.max(lBase, Math.abs(Math.min(r1, r2) - D / 2));
  lOut = Math.max(lOut, Math.max(r1, r2) - D / 2);
});
check('limb ticks stand on the Tropic of Capricorn', lBase < 1e-9, 'max err ' + lBase.toExponential(2));
check('limb ticks run outwards only', lOut > 0 && lOut <= limbW_ + 1e-9, 'max reach ' + (lOut / (D / 2)).toFixed(3) + ' Rc');
var limbOut = Math.max.apply(null, ents.filter(function (e) { return e.L === 'Limb'; }).map(function (e) {
  return e.kind === 'text' ? Math.hypot(e.d.pos.x, e.d.pos.y) + e.d.h / 2
       : Math.max(Math.hypot(e.d.a.x, e.d.a.y), Math.hypot(e.d.b.x, e.d.b.y)); }));
check('limb scale fits inside Rl', limbOut <= G.Rl + 1e-9, 'outermost limb ink ' + (limbOut / (D / 2)).toFixed(3) + ' Rc');

// 7c. index: nothing but a base line and the declination scale on it
check('index has no outline curves', curves('Index').length === 0, curves('Index').length + ' circle/arc(s)');
var idxLines = ents.filter(function (e) { return e.L === 'Index' && e.kind === 'line'; });
var len = function (e) { return Math.hypot(e.d.b.x - e.d.a.x, e.d.b.y - e.d.a.y); };
var long_ = idxLines.filter(function (e) { return len(e) > 0.05 * G.Rl; });
check('exactly one base line', long_.length === 1, long_.length + ' long line(s)');
check('base line runs from the pivot to the limb', long_.length === 1 &&
      Math.min(Math.hypot(long_[0].d.a.x, long_[0].d.a.y), Math.hypot(long_[0].d.b.x, long_[0].d.b.y)) < 1e-9 &&
      Math.abs(len(long_[0]) - G.Rl) < 1e-9);
// every other line is a scale tick standing on the base line, all on one side
var ia = Math.atan2(long_[0].d.b.y - long_[0].d.a.y, long_[0].d.b.x - long_[0].d.a.x);
var off = function (p) { return -p.x * Math.sin(ia) + p.y * Math.cos(ia); };
var ticks = idxLines.filter(function (e) { return e !== long_[0]; });
check('scale ticks stand on the base line', ticks.every(function (e) {
  return Math.min(Math.abs(off(e.d.a)), Math.abs(off(e.d.b))) < 1e-9; }), ticks.length + ' ticks');
check('scale ticks all on one side', ticks.every(function (e) {
  return Math.max(off(e.d.a), off(e.d.b)) > -1e-9; }));

// 7d. rete: every star of data/stars.txt drawn at r = Req tan((90-dec)/2) and
// at a plate angle equal to its right ascension, labelled with its Latin name
var starRows = fs.readFileSync(path.join(__dirname, '..', 'data', 'stars.txt'), 'utf8')
  .split('\n').filter(function (l) { return /^\|/.test(l) && !/^\|-/.test(l) && !/Right Ascension/.test(l); })
  .map(function (l) { var c = l.replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); });
                      return { name: c[0], ra: parseFloat(c[1]), dec: parseFloat(c[2]) }; });
var reteDots = ents.filter(function (e) { return e.L === 'Rete' && e.kind === 'circle'; });
var reteText = ents.filter(function (e) { return e.L === 'Rete' && e.kind === 'text'; });
check('19 stars read from data/stars.txt', starRows.length === 19, starRows.length + ' rows');
check('one pointer and one name per star', reteDots.length === starRows.length && reteText.length === starRows.length,
      reteDots.length + ' pointers, ' + reteText.length + ' names');
var posErr = 0, missing = [], labelErr = [];
starRows.forEach(function (st) {
  var r = G.Req * Math.tan(rad(90 - st.dec) / 2);         // independent of the script
  var x = r * Math.cos(rad(st.ra)), y = r * Math.sin(rad(st.ra));
  var dot = reteDots.filter(function (e) { return Math.hypot(e.d.c.x - x, e.d.c.y - y) < 1e-6; })[0];
  if (!dot) { missing.push(st.name); return; }
  posErr = Math.max(posErr, Math.hypot(dot.d.c.x - x, dot.d.c.y - y));
  var lab = reteText.filter(function (e) { return e.d.text === st.name; })[0];
  if (!lab || Math.hypot(lab.d.pos.x - x, lab.d.pos.y - y) > 0.03 * (D / 2) + 1e-9) { labelErr.push(st.name); }
});
check('every star at its catalogue position', missing.length === 0, 'missing: ' + missing.join(', '));
check('star positions exact', posErr < 1e-9, 'max err ' + posErr.toExponential(2));
check('every star labelled with its old name', labelErr.length === 0, 'wrong/far: ' + labelErr.join(', '));
check('all star pointers inside Capricorn', reteDots.every(function (e) {
  return Math.hypot(e.d.c.x, e.d.c.y) + e.d.r <= D / 2; }));

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
  var col = { Equator: '#00a000', Tropic_Cancer: '#dc7800', Tropic_Capricorn: '#1e5ae6', Horizon: '#dc0000', Almucantars: '#0096be', Twilight: '#4646aa', Unequal_Hours: '#007864', Azimuth: '#963cc8', Ecliptic: '#c8a000', Ecliptic_Zodiac: '#be6414', Ecliptic_Calendar: '#787814', Rete: '#96143c', Index: '#e6288c', Limb: '#555' };
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
