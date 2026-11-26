/**
 * Ptolemaic equatorium generator for QCAD (ECMAScript)
 * =====================================================
 *
 * Draws the main components of an equatorium - the instrument that solves
 * Ptolemy's planetary model by construction instead of by arithmetic - with
 * every planet on the one plate.
 *
 * All of them can share a plate because Ptolemy normalises every deferent to
 * radius 60: at a common scale the five deferents are the same circle, and the
 * planets differ only in where the apse line points, how far off-centre their
 * two centres lie, and how large the epicycle is.  The Earth stays at the
 * centre of the plate so that the limb, which is read along a line from the
 * Earth, stays concentric with it.
 *
 * Two layers are shared:
 *
 *     Limb (the zodiac it is all read against), Earth (the centre of the world)
 *
 * and each planet has two of its own, so freezing layers is how the instrument
 * is set to one planet:
 *
 *     <planet>_Deferent  the fixed frame: apse line, deferent circle, the
 *                        deferent centre (drawn as a small circle), the equant
 *                        (drawn as a cross) and the equant circle graduated in
 *                        mean centre
 *     <planet>_Epicycle  the moving part: the epicycle graduated in anomaly,
 *                        the planet, and the three pointers
 *
 * Run it in QCAD with an open drawing: Misc > Development > Run Script...
 *
 * ---------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------------
 * The Earth O is the centre of the world.  The deferent, of radius R, is drawn
 * about a centre M displaced from O by the eccentricity e towards the apogee.
 * The equant E lies a further e beyond M, so M bisects OE.  The epicycle
 * centre C rides on the deferent, but its motion is uniform as seen from E -
 * that is Ptolemy's equant, and the whole instrument exists to resolve it:
 *
 *     O = (0, 0)
 *     M = e  u(A),  E = 2e u(A)          u(x) = (cos x, sin x), A = apogee
 *     C = E + t u(A + k),  t = -e cos k + sqrt(R^2 - e^2 sin^2 k)
 *     P = C + r u(A + k + a)
 *
 * k (the mean centre) is counted from the apogee about E, a (the anomaly) from
 * the epicycle's mean apogee, which is the direction E -> C produced.  The
 * planet's true longitude is then simply the direction of P seen from O.
 *
 * The Sun has no equant and no epicycle: a simple eccentric, so E = M, r = 0
 * and the Sun itself rides on the deferent.
 *
 * The scale is common to all of them, set by the planet that reaches furthest
 * from the Earth (Mars, at e + R + r = 105;30), so the relative sizes on the
 * plate are Ptolemy's own.
 *
 * Parameters are Ptolemy's own, with the deferent radius 60 (Almagest IX-XI);
 * sexagesimal fractions are given in the table as decimals.  The apogee
 * longitudes are those Ptolemy derived for his own epoch.
 *
 * NOT drawn: Mercury, whose deferent centre itself travels on a small circle,
 * and the Moon, which needs the crank and the prosneusis point.  Neither is
 * the simple equant model below, and drawing them with it would be wrong.
 */

include("scripts/EAction.js");

(function () {

    // =======================================================================
    // USER PARAMETERS
    // =======================================================================
    var cfg = {
        diameter: 200.0,        // diameter of the zodiac limb (drawing units)
        planets: ["Saturn", "Jupiter", "Mars", "Venus", "Sun"],   // all on one plate
        meanMotus: 60.0,        // mean centre k: degrees from the apogee, about the equant
        anomaly: 120.0,         // degrees round the epicycle from its mean apogee
        args: {},               // per planet, e.g. Mars: { mean: 210, anom: 95 }
        askUser: true,          // show an input dialog for the diameter

        textFont: "Standard"
    };

    // Ptolemy's parameters, deferent radius 60 (Almagest IX-XI; the Sun III).
    //   e       eccentricity, O to the deferent centre (half of O to the equant)
    //   r       epicycle radius
    //   apogee  longitude of the apogee in Ptolemy's day
    // The sexagesimals are written as fractions, not rounded decimals, so that
    // nothing is lost between the comment and the number.
    var PLANETS = {
        "Saturn":  { e: 3 + 25 / 60, r:  6 + 30 / 60, apogee: 233,   equant: true },  // 3;25  6;30
        "Jupiter": { e: 2 + 45 / 60, r: 11 + 30 / 60, apogee: 161,   equant: true },  // 2;45  11;30
        "Mars":    { e: 6,           r: 39 + 30 / 60, apogee: 115.5, equant: true },  // 6;0   39;30
        "Venus":   { e: 1 + 15 / 60, r: 43 + 10 / 60, apogee:  55,   equant: true },  // 1;15  43;10
        "Sun":     { e: 2 + 30 / 60, r:  0,           apogee:  65.5, equant: false }  // 2;30, simple eccentric
    };

    // layer name -> [r, g, b]; each planet gets a dark frame and a lighter
    // moving part in its own hue
    var PLANET_COLOUR = {
        "Saturn":  [[ 70,  70, 110], [125, 125, 175]],
        "Jupiter": [[140,  90,  20], [200, 150,  60]],
        "Mars":    [[170,  30,  30], [220,  90,  70]],
        "Venus":   [[ 20, 120,  80], [ 70, 180, 130]],
        "Sun":     [[165, 130,   0], [225, 185,  40]]
    };
    var LAYERS = [
        ["Limb",      [ 90,  90,  90]],
        ["Earth",     [200,   0,   0]]
    ];

    var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
                 "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

    var PI = Math.PI;
    var DEFERENT_R = 60;                             // Ptolemy's unit of length

    function rad(d) { return d * PI / 180; }
    function deg(r) { return r * 180 / PI; }
    function log(s) { try { qDebug(s); } catch (e) { try { print(s); } catch (e2) { } } }

    // =======================================================================
    // INPUT
    // =======================================================================
    if (cfg.askUser) {
        try {
            var v = QInputDialog.getDouble(EAction.getMainWindow(), "Equatorium",
                                           "Diameter of the zodiac limb:", cfg.diameter,
                                           10, 100000, 2);
            if (typeof v === "number" && isFinite(v)) { cfg.diameter = v; }
        } catch (e) { }
    }
    for (var ci = 0; ci < cfg.planets.length; ci++) {
        if (!PLANETS[cfg.planets[ci]]) {
            throw new Error("Equatorium: no model for " + cfg.planets[ci] +
                            " - Mercury and the Moon need more than the equant model; " +
                            "choose among Saturn, Jupiter, Mars, Venus, Sun");
        }
    }
    if (!(cfg.diameter > 0)) { throw new Error("Equatorium: diameter must be > 0"); }
    for (ci = 0; ci < cfg.planets.length; ci++) {
        LAYERS.push([cfg.planets[ci] + "_Deferent", PLANET_COLOUR[cfg.planets[ci]][0]]);
        LAYERS.push([cfg.planets[ci] + "_Epicycle", PLANET_COLOUR[cfg.planets[ci]][1]]);
    }

    // =======================================================================
    // GEOMETRY (pure maths, no QCAD calls)
    // =======================================================================
    var Rlimb = cfg.diameter / 2;
    function u(ang) { return { x: Math.cos(ang), y: Math.sin(ang) }; }
    function pt(o, d, t) { return { x: o.x + t * d.x, y: o.y + t * d.y }; }

    // One scale for the whole plate, set by the planet that reaches furthest
    // from the Earth: no planet ever gets beyond e + R + r.
    var reach = 0;
    for (var ri = 0; ri < cfg.planets.length; ri++) {
        var q = PLANETS[cfg.planets[ri]];
        reach = Math.max(reach, q.e + DEFERENT_R + q.r);
    }
    var k = 0.88 * Rlimb / reach;                    // Ptolemy's units -> drawing
    var Rdef = DEFERENT_R * k;                       // the same for every planet

    // Ptolemy's construction for one planet, at its own two arguments
    function solve(name) {
        var p = PLANETS[name], given = cfg.args[name] || {};
        var kapDeg = (given.mean === undefined) ? cfg.meanMotus : given.mean;
        var anoDeg = (given.anom === undefined) ? cfg.anomaly : given.anom;
        var ecc = p.e * k, Repi = p.r * k;
        var A = rad(p.apogee), kap = rad(kapDeg), ano = rad(anoDeg);
        var uA = u(A);
        var M = { x: ecc * uA.x, y: ecc * uA.y };                  // deferent centre
        var E = p.equant ? { x: 2 * ecc * uA.x, y: 2 * ecc * uA.y } : M;
        var m = p.equant ? ecc : 0;                  // the equant to the deferent centre
        var dir = u(A + kap);
        var t = -m * Math.cos(kap) +
                Math.sqrt(Rdef * Rdef - m * m * Math.sin(kap) * Math.sin(kap));
        var C = pt(E, dir, t);                                     // epicycle centre
        var P = (Repi > 0) ? pt(C, u(A + kap + ano), Repi) : C;    // the planet
        return { name: name, pl: p, ecc: ecc, Repi: Repi, A: A, kap: kap, ano: ano,
                 uA: uA, dir: dir, M: M, E: E, C: C, P: P,
                 meanDeg: kapDeg, anomDeg: anoDeg,
                 lon: (deg(Math.atan2(P.y, P.x)) + 360) % 360 };
    }

    // =======================================================================
    // QCAD DRAWING LAYER
    // =======================================================================
    var di = null;
    try { di = EAction.getDocumentInterface(); } catch (e1) { }
    if (!di) { try { di = EAction.getMainWindow().getDocumentInterface(); } catch (e2) { } }
    if (!di) { throw new Error("Equatorium: no open drawing - create or open a drawing first"); }
    var doc = di.getDocument();

    // every layer defaults to hairline (0.00 mm), as in astrolabe.js
    function makeLayer(name, c) {
        var color = new RColor(c[0], c[1], c[2]);
        try {
            return new RLayer(doc, name, false, false, color,
                              doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight000, false);
        } catch (e) {
            var l = new RLayer(doc, name);
            l.setColor(color);
            if (l.setLineweight) { l.setLineweight(RLineweight.Weight000); }
            return l;
        }
    }

    (function createLayers() {
        var op = new RAddObjectOperation();
        var any = false;
        for (var i = 0; i < LAYERS.length; i++) {
            if (!doc.hasLayer(LAYERS[i][0])) {
                op.addObject(makeLayer(LAYERS[i][0], LAYERS[i][1]), false);
                any = true;
            }
        }
        if (any) { di.applyOperation(op); }
    })();

    var layerIds = {};
    for (var li = 0; li < LAYERS.length; li++) {
        layerIds[LAYERS[li][0]] = doc.getLayerId(LAYERS[li][0]);
    }

    var op = new RAddObjectOperation();
    var counts = {};

    function put(layer, entity) {
        entity.setLayerId(layerIds[layer]);
        if (entity.setLineweight) { entity.setLineweight(RLineweight.WeightByLayer); }
        op.addObject(entity, false);
        counts[layer] = (counts[layer] || 0) + 1;
    }

    function addLine(layer, x1, y1, x2, y2) {
        put(layer, new RLineEntity(doc, new RLineData(new RVector(x1, y1), new RVector(x2, y2))));
    }

    function addCircle(layer, cx, cy, r) {
        put(layer, new RCircleEntity(doc, new RCircleData(new RVector(cx, cy), r)));
    }

    function makeTextData(pos, h, str, ang) {
        var variants = [
            function () {
                return new RTextData(pos, pos, h, 0, RS.VAlignMiddle, RS.HAlignCenter,
                    RS.LeftToRight, RS.Exact, 1.0, str, cfg.textFont, "", false, false, ang, true);
            },
            function () {
                return new RTextData(pos, pos, h, 0, RS.VAlignMiddle, RS.HAlignCenter,
                    RS.LeftToRight, RS.Exact, 1.0, str, cfg.textFont, false, false, ang, true);
            }
        ];
        for (var i = 0; i < variants.length; i++) {
            try { return variants[i](); } catch (e) { }
        }
        return null;
    }

    var textWarned = false;
    function addText(layer, x, y, h, str, ang) {
        var td = makeTextData(new RVector(x, y), h, String(str), ang);
        if (!td) {
            if (!textWarned) { log("Equatorium: RTextData signature not supported - labels skipped"); textWarned = true; }
            return;
        }
        put(layer, new RTextEntity(doc, td));
    }

    // text laid tangentially around a circle, always readable
    function addTangentText(layer, x, y, posAngle, h, str) {
        var a = posAngle - PI / 2;
        if (Math.sin(posAngle) < 0) { a += PI; }
        addText(layer, x, y, h, str, a);
    }

    // a tick of length len standing on the circle (cx, cy, r) at angle ang,
    // running outwards if len is positive and inwards if it is negative
    function tick(layer, cx, cy, r, ang, len) {
        var c = Math.cos(ang), s = Math.sin(ang);
        addLine(layer, cx + r * c, cy + r * s, cx + (r + len) * c, cy + (r + len) * s);
    }

    // =======================================================================
    // 1. LIMB and EARTH: shared by every planet on the plate
    // =======================================================================
    // Centred on the Earth, 0 of Aries towards +X, longitude counter-clockwise.
    addCircle("Limb", 0, 0, Rlimb);
    for (var lo = 0; lo < 360; lo++) {
        var a = rad(lo);
        tick("Limb", 0, 0, Rlimb, a,
             -((lo % 10 === 0) ? 0.035 : (lo % 5 === 0) ? 0.025 : 0.015) * Rlimb);
        if (lo % 10 === 0 && lo % 30 !== 0) {
            var rn = Rlimb - 0.052 * Rlimb;
            addTangentText("Limb", rn * Math.cos(a), rn * Math.sin(a), a, 0.020 * Rlimb, lo % 30);
        }
    }
    for (var sg = 0; sg < 12; sg++) {
        var am = rad(sg * 30 + 15), rs = Rlimb - 0.082 * Rlimb;
        addTangentText("Limb", rs * Math.cos(am), rs * Math.sin(am), am, 0.026 * Rlimb, SIGNS[sg]);
    }

    // the centre of the world, which every planet is seen from
    addCircle("Earth", 0, 0, 0.012 * Rlimb);
    addLine("Earth", -0.03 * Rlimb, 0, 0.03 * Rlimb, 0);
    addLine("Earth", 0, -0.03 * Rlimb, 0, 0.03 * Rlimb);
    addText("Earth", 0, -0.055 * Rlimb, 0.026 * Rlimb, "Earth", 0);

    // =======================================================================
    // 2. ONE PLANET: its frame, its epicycle, and the three pointers
    // =======================================================================
    // The centres crowd the middle of the plate - Venus's eccentricity is one
    // part in 48 of the deferent - so they are told apart by shape rather than
    // by labels: the deferent centre is a small circle, the equant a cross.
    // Each planet's name is written at the apogee end of its own apse line.
    function drawPlanet(s) {
        var LD = s.name + "_Deferent", LE = s.name + "_Epicycle";

        // apse line, apogee to perigee, named at the apogee end
        addLine(LD, -Rlimb * s.uA.x, -Rlimb * s.uA.y, Rlimb * s.uA.x, Rlimb * s.uA.y);
        var rn2 = Rlimb - 0.125 * Rlimb;
        addTangentText(LD, rn2 * s.uA.x, rn2 * s.uA.y, s.A, 0.024 * Rlimb, s.name);

        // the deferent and its centre
        addCircle(LD, s.M.x, s.M.y, Rdef);
        addCircle(LD, s.M.x, s.M.y, 0.008 * Rlimb);

        if (s.pl.equant) {
            // the equant, a cross, and the circle its uniform motion is counted on
            var c = 0.013 * Rlimb;
            addLine(LD, s.E.x - c, s.E.y - c, s.E.x + c, s.E.y + c);
            addLine(LD, s.E.x - c, s.E.y + c, s.E.x + c, s.E.y - c);
            addCircle(LD, s.E.x, s.E.y, Rdef);
            for (var mg = 0; mg < 360; mg += 5) {
                var ag = s.A + rad(mg);
                tick(LD, s.E.x, s.E.y, Rdef, ag, ((mg % 10 === 0) ? 0.022 : 0.014) * Rlimb);
                if (mg % 30 === 0) {
                    var rg = Rdef + 0.040 * Rlimb;
                    addTangentText(LD, s.E.x + rg * Math.cos(ag), s.E.y + rg * Math.sin(ag),
                                   ag, 0.018 * Rlimb, mg);
                }
            }
        }

        // the epicycle, graduated in anomaly from its mean apogee - which is
        // the ray out of the equant that found it
        if (s.Repi > 0) {
            addCircle(LE, s.C.x, s.C.y, s.Repi);
            addCircle(LE, s.C.x, s.C.y, 0.008 * Rlimb);
            for (var an = 0; an < 360; an += 5) {
                var aa = s.A + s.kap + rad(an);
                tick(LE, s.C.x, s.C.y, s.Repi, aa, -((an % 10 === 0) ? 0.022 : 0.014) * Rlimb);
                if (an % 30 === 0) {
                    var ra = s.Repi - 0.042 * Rlimb;
                    addTangentText(LE, s.C.x + ra * Math.cos(aa), s.C.y + ra * Math.sin(aa),
                                   aa, 0.016 * Rlimb, an);
                }
            }
        }

        // the planet
        addCircle(LE, s.P.x, s.P.y, 0.012 * Rlimb);
        addText(LE, s.P.x, s.P.y + 0.038 * Rlimb, 0.024 * Rlimb, s.name, 0);

        // The mean centre, out of the equant and on to the limb.  It has to
        // follow the ray from the equant - the limb point at the same angle
        // seen from the Earth is a different point, and a pointer drawn to it
        // would miss the epicycle centre it carries.
        var ed = s.E.x * s.dir.x + s.E.y * s.dir.y;
        var sl = -ed + Math.sqrt(Rlimb * Rlimb - (s.E.x * s.E.x + s.E.y * s.E.y) + ed * ed);
        addLine(LE, s.E.x, s.E.y, s.E.x + sl * s.dir.x, s.E.y + sl * s.dir.y);
        // the epicycle radius, centre to planet
        if (s.Repi > 0) { addLine(LE, s.C.x, s.C.y, s.P.x, s.P.y); }
        // the sight line: the Earth to the planet, produced to the zodiac
        var tl = rad(s.lon);
        addLine(LE, 0, 0, Rlimb * Math.cos(tl), Rlimb * Math.sin(tl));
    }

    var solved = [];
    for (var di2 = 0; di2 < cfg.planets.length; di2++) {
        var sol = solve(cfg.planets[di2]);
        solved.push(sol);
        drawPlanet(sol);
    }

    // =======================================================================
    // APPLY
    // =======================================================================
    op.setText("Equatorium");
    di.applyOperation(op);
    try { di.autoZoom(); } catch (e) { }

    log("Equatorium: limb D=" + cfg.diameter + "  R_deferent=" + Rdef.toFixed(3) +
        " (the same for every planet)  Ptolemy's units x " + k.toFixed(4));
    for (var si = 0; si < solved.length; si++) {
        var so = solved[si];
        log("  " + (so.name + "       ").slice(0, 8) + " apogee " + so.pl.apogee +
            ", mean centre " + so.meanDeg + ", anomaly " + so.anomDeg +
            "  ->  longitude " + so.lon.toFixed(3) + " deg" +
            "   (e=" + so.ecc.toFixed(2) + " r=" + so.Repi.toFixed(2) + ")");
    }
    for (var key in counts) { log("  layer " + key + ": " + counts[key] + " entities"); }

    // expose geometry for testing outside QCAD
    if (typeof __EQUATORIUM_TEST__ !== "undefined") {
        var byName = {};
        for (si = 0; si < solved.length; si++) { byName[solved[si].name] = solved[si]; }
        __EQUATORIUM_TEST__.geom = {
            Rlimb: Rlimb, Rdef: Rdef, scale: k, reach: reach,
            DEFERENT_R: DEFERENT_R, planets: cfg.planets, solved: byName
        };
    }
})();
