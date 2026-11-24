/**
 * Astrolabe generator for QCAD (ECMAScript)
 * ==========================================
 *
 * Draws a traditional northern-hemisphere planispheric astrolabe (plate + rete
 * ecliptic + index + limb) from just two inputs:
 *
 *     - diameter of the outermost plate circle (Tropic of Capricorn)
 *     - observer latitude
 *
 * Every component lives on its own layer:
 *
 *     Equator, Tropic_Cancer, Tropic_Capricorn, Horizon, Almucantars,
 *     Twilight (civil / nautical / astronomical, altitude -6/-12/-18),
 *     Unequal_Hours (12 temporal hours of the night), Azimuth,
 *     Analemma (the true Sun at a fixed local mean hour, one figure per hour),
 *     Ecliptic (a single line, the only circle of the band),
 *     Ecliptic_Calendar (365 days / 12 months, outside that line),
 *     Ecliptic_Zodiac (equal zodiac, 1 degree scale, inside that line),
 *     Rete (19 star pointers with their Latin names),
 *     Index (base line + declination scale), Limb (360 degree scale standing
 *     on the Tropic of Capricorn)
 *
 * Run it in QCAD with an open drawing: Misc > Development > Run Script...
 * (or File > Open Script / "Run Script"), then pick this file.
 *
 * ---------------------------------------------------------------------------
 * Mathematics
 * ---------------------------------------------------------------------------
 * Stereographic projection of the celestial sphere from the SOUTH celestial
 * pole onto the equatorial plane; the north celestial pole is the drawing
 * centre (0,0).  A point with polar distance p (= 90 deg - declination) lands
 * at radius
 *
 *         r(p) = R_eq * tan(p / 2)
 *
 * R_eq is fixed by the requested size:  R_capricorn = R_eq * tan(45 + eps/2)
 * (eps = obliquity of the ecliptic), so the Tropic of Capricorn has exactly the
 * requested radius.  Stereographic projection maps every circle of the sphere
 * to a circle, so all curves are drawn as exact circles / arcs:
 *
 *   - Equator / tropics: circles about the centre, r(90), r(90 -/+ eps).
 *   - Almucantar of altitude a: its two intersections with the meridian lie at
 *     signed polar distances (180 - phi - a) and (a - phi); the circle has
 *     these two points as a diameter.  a = 0 is the horizon (centre
 *     R_eq/tan(phi), radius R_eq/sin(phi)); negative altitudes give the
 *     twilight curves.
 *   - Unequal hour k: the circle through the points dividing the night arc of
 *     Capricorn, Equator and Cancer at k/12 (cos H0 = -tan(phi) tan(dec)).
 *   - Azimuth circle: passes through zenith and nadir and the horizon point of
 *     that azimuth (computed with the horizontal -> equatorial transform).
 *   - Analemma for mean hour h: the Sun of each day at declination dec(d) and
 *     hour angle (h - 12) * 15 + EoT(d), the equation of time being the mean
 *     longitude minus the apparent right ascension.
 *   - Ecliptic: circle through the solstice points r(90-eps) and r(90+eps);
 *     the point of ecliptic longitude L is found from
 *     sin(dec) = sin(eps) sin(L), tan(RA) = cos(eps) tan(L).
 *   - Calendar: the Sun's ecliptic longitude for each day (low-precision
 *     solar ephemeris, ~0.01 deg) is placed on the ecliptic.
 *   - Calendar and zodiac share the ecliptic line itself as their common base:
 *     both index the same rays out of the ecliptic centre, the calendar drawn
 *     outwards (Re .. Re + calOut), the zodiac inwards (Re - zodIn .. Re).  No
 *     further circle is drawn for either scale.
 *   - Star: r = R_eq tan((90 - dec)/2) at the rete angle of its right
 *     ascension (RA 0 to +X), so only stars north of -eps fit on the plate.
 *   - Index: declination scale at radii r(90 - dec) along the index edge.
 *
 * Orientation: +Y is the upper meridian (towards the zenith side), +X is
 * west, so the sky turns clockwise.  The rete is drawn with the solstice axis
 * vertical (Cancer at the top, Capricorn at the bottom, Aries on the right).
 */

include("scripts/EAction.js");

(function () {

    // =======================================================================
    // USER PARAMETERS
    // =======================================================================
    var cfg = {
        diameter: 200.0,        // diameter of Tropic of Capricorn (drawing units)
        latitude: 49.2,         // observer latitude, degrees north (1 .. 89)
        askUser: true,          // show input dialogs for diameter / latitude

        obliquity: 23.4393,     // obliquity of the ecliptic, degrees
        almucantarStep: 5,      // degrees between almucantars
        almucantarLabelStep: 10,// label every n degrees of altitude (0 = none)
        azimuthStep: 10,        // degrees between azimuth lines
        twilights: [-6, -12, -18],// solar depressions: civil / nautical / astronomical
        analemmaHours: [12],    // local MEAN hours to draw the analemma for (12 = mean noon)
        calendarYear: 2026,     // reference (non-leap) year for the 365 day calendar

        limbClockwise: true,    // limb 0 deg at top, increasing clockwise
        indexAngle: 60.0,       // index direction (degrees, CCW from +X)
        indexSeparate: false,   // true: draw the index beside the astrolabe

        textFont: "Standard"
    };

    // layer name -> [r, g, b]
    var LAYERS = [
        ["Equator",           [  0, 160,   0]],
        ["Tropic_Cancer",     [220, 120,   0]],
        ["Tropic_Capricorn",  [ 30,  90, 230]],
        ["Horizon",           [220,   0,   0]],
        ["Almucantars",       [  0, 150, 190]],
        ["Twilight",          [ 70,  70, 170]],
        ["Unequal_Hours",     [  0, 120, 100]],
        ["Azimuth",           [150,  60, 200]],
        ["Analemma",          [ 30,  30,  30]],
        ["Ecliptic",          [200, 160,   0]],
        ["Ecliptic_Zodiac",   [190, 100,  20]],
        ["Ecliptic_Calendar", [120, 120,  20]],
        ["Rete",              [150,  20,  60]],
        ["Index",             [230,  40, 140]],
        ["Limb",              [ 90,  90,  90]]
    ];

    // 19 traditional astrolabe stars: Latin name, RA, declination (J2000,
    // degrees).  Source: data/stars.txt; the modern name is in the comment.
    var STARS = [
        ["Canis Maior",           101.2871550, -16.7161167],  // Sirius
        ["Canis Minor",           114.8254167,   5.0247222],  // Procyon
        ["Sinister pes Orionis",   78.6344670,  -8.2016384],  // Rigel
        ["Scapula Orionis",        88.7929392,   7.4070639],  // Betelgeuse
        ["Oculus Tauri",           68.9801626,  16.5093024],  // Aldebaran
        ["Lucida Hydrae",         141.8976804,  -8.6586025],  // Alphard
        ["Cor Leonis",            152.0887967,  11.9672083],  // Regulus
        ["Spica",                 201.2982458, -11.1613194],  // Spica
        ["Cauda Ceti",             10.8973788, -17.9866060],  // Deneb Kaitos
        ["Hircus",                 79.1723271,  45.9979915],  // Capella
        ["Cauda Leonis",          178.7640750,  14.5720583],  // Denebola
        ["Caput Medusae",          47.0413833,  40.9556472],  // Algol
        ["Umbilicus Pegasi",      345.7735542,  15.2052667],  // Markab
        ["Cauda Cigni",           310.3579792,  45.2803389],  // Deneb
        ["Lira",                  279.2355667,  38.7836889],  // Vega
        ["Arcturus",              213.9153000,  19.1824083],  // Arcturus
        ["Aquila",                297.6958292,   8.8683222],  // Altair
        ["Ursa Maior",            206.8851583,  49.3132667],  // Alkaid
        ["Pectus",                 10.1258333,  56.5373611]  // Schedar
    ];

    var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"];
    var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    var PI = Math.PI;
    var TWO_PI = 2 * PI;

    function rad(d) { return d * PI / 180; }
    function deg(r) { return r * 180 / PI; }
    function norm2pi(a) { a = a % TWO_PI; if (a < 0) { a += TWO_PI; } return a; }
    function log(s) { try { qDebug(s); } catch (e) { try { print(s); } catch (e2) { } } }

    // =======================================================================
    // INPUT
    // =======================================================================
    function askNumber(label, def, min, max, decimals) {
        try {
            var v = QInputDialog.getDouble(EAction.getMainWindow(), "Astrolabe", label,
                                           def, min, max, decimals);
            if (typeof v === "number" && isFinite(v)) { return v; }
        } catch (e) { }
        return def;
    }

    if (cfg.askUser) {
        cfg.diameter = askNumber("Diameter of the Tropic of Capricorn:", cfg.diameter, 10, 100000, 2);
        cfg.latitude = askNumber("Latitude (degrees north, 1..89):", cfg.latitude, 1, 89, 4);
    }
    if (!(cfg.diameter > 0) || !(cfg.latitude >= 1 && cfg.latitude <= 89)) {
        throw new Error("Astrolabe: diameter must be > 0 and latitude within 1..89 degrees");
    }

    // =======================================================================
    // GEOMETRY (pure maths, no QCAD calls)
    // =======================================================================
    var eps = cfg.obliquity;
    var phi = cfg.latitude;
    var Rc = cfg.diameter / 2;                       // Tropic of Capricorn
    var Req = Rc / Math.tan(rad(45 + eps / 2));      // Equator
    var Rcan = Req * Math.tan(rad(45 - eps / 2));    // Tropic of Cancer
    var calOut = 0.075 * Rc;                         // calendar reach outside the ecliptic
    var limbW = 0.080 * Rc;                          // depth of the limb's 360 deg scale
    var Rl = Rc + limbW;                             // outer end of the limb scale

    // signed polar distance along the meridian (positive towards +Y) -> Y
    function yOnMeridian(sDeg) { return Req * Math.tan(rad(sDeg) / 2); }

    // equatorial (declination, hour angle) -> plate position
    function plateFromEq(decl, H) {
        var r = Req * Math.tan((PI / 2 - decl) / 2);
        return { x: r * Math.sin(H), y: r * Math.cos(H) };
    }

    // horizontal (altitude, azimuth from south, positive to west; degrees) -> plate
    function plateFromHor(altDeg, azDeg) {
        var h = rad(altDeg), A = rad(azDeg), f = rad(phi);
        var sinD = Math.sin(h) * Math.sin(f) - Math.cos(h) * Math.cos(A) * Math.cos(f);
        var cdsH = Math.cos(h) * Math.sin(A);
        var cdcH = Math.cos(h) * Math.cos(A) * Math.sin(f) + Math.sin(h) * Math.cos(f);
        return plateFromEq(Math.asin(sinD), Math.atan2(cdsH, cdcH));
    }

    // equatorial (RA, declination; degrees) -> plate position in the rete's
    // orientation: RA 0 towards +X (Aries right), RA 90 towards +Y (Cancer up)
    function plateFromRaDec(raDeg, decDeg) {
        return plateFromEq(rad(decDeg), PI / 2 - rad(raDeg));
    }

    // ecliptic longitude (deg) -> plate position, rete turned so Cancer is at +Y
    function plateFromEcliptic(lonDeg) {
        var L = rad(lonDeg), e = rad(eps);
        var decl = Math.asin(Math.sin(e) * Math.sin(L));
        var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
        return plateFromEq(decl, PI / 2 - ra);
    }

    function circleCircle(x1, y1, r1, x2, y2, r2) {
        var dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) { return []; }
        var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        var h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
        var px = x1 + a * dx / d, py = y1 + a * dy / d;
        if (h < 1e-9 * Math.max(r1, 1)) { return [{ x: px, y: py }]; }
        return [{ x: px + h * dy / d, y: py - h * dx / d },
                { x: px - h * dy / d, y: py + h * dx / d }];
    }

    // Sun's ecliptic longitude (deg) for a Julian day (low precision, ~0.01 deg)
    function sunLongitude(jd) {
        var n = jd - 2451545.0;
        var L = 280.460 + 0.9856474 * n;
        var g = rad(357.528 + 0.9856003 * n);
        var lam = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
        lam = lam % 360; if (lam < 0) { lam += 360; }
        return lam;
    }

    // Julian day at 0h UT of a Gregorian date
    function julianDay(y, m, d) {
        if (m <= 2) { y -= 1; m += 12; }
        var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
        return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
    }

    // =======================================================================
    // QCAD DRAWING LAYER
    // =======================================================================
    var di = null;
    try { di = EAction.getDocumentInterface(); } catch (e1) { }
    if (!di) { try { di = EAction.getMainWindow().getDocumentInterface(); } catch (e2) { } }
    if (!di) { throw new Error("Astrolabe: no open drawing - create or open a drawing first"); }
    var doc = di.getDocument();

    function makeLayer(name, c) {
        var color = new RColor(c[0], c[1], c[2]);
        try {
            return new RLayer(doc, name, false, false, color,
                              doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight025, false);
        } catch (e) {
            var l = new RLayer(doc, name);
            l.setColor(color);
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
        op.addObject(entity, false);
        counts[layer] = (counts[layer] || 0) + 1;
    }

    function addLine(layer, x1, y1, x2, y2) {
        put(layer, new RLineEntity(doc, new RLineData(new RVector(x1, y1), new RVector(x2, y2))));
    }

    function addCircle(layer, cx, cy, r) {
        put(layer, new RCircleEntity(doc, new RCircleData(new RVector(cx, cy), r)));
    }

    // counter-clockwise arc from a0 to a1 (radians)
    function addArc(layer, cx, cy, r, a0, a1) {
        put(layer, new RArcEntity(doc, new RArcData(new RVector(cx, cy), r, a0, a1, false)));
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
    // text centred at (x,y), rotated by ang (radians)
    function addText(layer, x, y, h, str, ang) {
        var td = makeTextData(new RVector(x, y), h, String(str), ang);
        if (!td) {
            if (!textWarned) { log("Astrolabe: RTextData signature not supported - labels skipped"); textWarned = true; }
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

    // arc (ccw from a0 by sweep) clipped to the plate boundary (Tropic of Capricorn)
    function addArcClipped(layer, cx, cy, r, a0, sweep) {
        var full = sweep >= TWO_PI - 1e-9;
        var pts = circleCircle(cx, cy, r, 0, 0, Rc);
        if (full && pts.length > 0) {
            a0 = Math.atan2(pts[0].y - cy, pts[0].x - cx);
            sweep = TWO_PI;
        }
        var cuts = [0, sweep];
        for (var i = 0; i < pts.length; i++) {
            var d = norm2pi(Math.atan2(pts[i].y - cy, pts[i].x - cx) - a0);
            if (d > 1e-9 && d < sweep - 1e-9) { cuts.push(d); }
        }
        cuts.sort(function (p, q) { return p - q; });
        for (var k = 0; k + 1 < cuts.length; k++) {
            var s = cuts[k], e = cuts[k + 1];
            var m = a0 + (s + e) / 2;
            var mx = cx + r * Math.cos(m), my = cy + r * Math.sin(m);
            if (Math.sqrt(mx * mx + my * my) <= Rc * (1 + 1e-9)) {
                if (e - s >= TWO_PI - 1e-9) { addCircle(layer, cx, cy, r); }
                else { addArc(layer, cx, cy, r, a0 + s, a0 + e); }
            }
        }
    }

    // =======================================================================
    // 1. EQUATOR AND TROPICS
    // =======================================================================
    addCircle("Equator", 0, 0, Req);
    addCircle("Tropic_Cancer", 0, 0, Rcan);
    addCircle("Tropic_Capricorn", 0, 0, Rc);

    // =======================================================================
    // 2. HORIZON AND ALMUCANTARS
    // =======================================================================
    function almucantar(layer, a) {
        var y1 = yOnMeridian(180 - phi - a);
        var y2 = yOnMeridian(a - phi);
        var r = Math.abs(y1 - y2) / 2;
        if (r < 1e-9) { addCircle(layer, 0, y1, 0.006 * Rc); return; }   // zenith
        addArcClipped(layer, 0, (y1 + y2) / 2, r, 0, TWO_PI);
        return { top: y1, bot: y2 };
    }
    almucantar("Horizon", 0);
    var labelH = 0.016 * Rc;
    for (var a = cfg.almucantarStep; a <= 90 + 1e-9; a += cfg.almucantarStep) {
        var alm = almucantar("Almucantars", a);
        if (cfg.almucantarLabelStep > 0 && alm !== undefined &&
            Math.abs(a / cfg.almucantarLabelStep - Math.round(a / cfg.almucantarLabelStep)) < 1e-9 &&
            a < 90 && alm.top < Rc - 2 * labelH) {
            addText("Almucantars", 1.2 * labelH, alm.top + 0.8 * labelH, labelH, Math.round(a), 0);
        }
    }

    // =======================================================================
    // 2b. TWILIGHT: almucantars of negative altitude (Sun below the horizon)
    // =======================================================================
    // For a < 0 the upper meridian crossing falls outside the plate, so each
    // curve is labelled at its lower crossing, which is always inside it
    // (|y| = Req * tan((phi + |a|) / 2) <= Req * tan(53.5 deg) < Rc).
    for (var ti = 0; ti < cfg.twilights.length; ti++) {
        var tw = almucantar("Twilight", cfg.twilights[ti]);
        if (tw !== undefined) {
            addText("Twilight", 1.2 * labelH, tw.bot - 0.8 * labelH, labelH, cfg.twilights[ti], 0);
        }
    }

    // =======================================================================
    // 2c. UNEQUAL (TEMPORAL) HOURS
    // =======================================================================
    // The night is divided into 12 equal parts on each of Capricorn, Equator
    // and Cancer; the traditional construction then joins the three matching
    // division points with the circle through them (an approximation of the
    // true locus, exact at those three points).  Hour 6 is the lower meridian,
    // where the three points are collinear and the line is straight.
    (function drawUnequalHours() {
        var decs = [-eps, 0, eps];                       // Capricorn, Equator, Cancer
        var nightStart = [], nightArc = [];
        for (var i = 0; i < 3; i++) {
            var c = -Math.tan(rad(phi)) * Math.tan(rad(decs[i]));
            if (Math.abs(c) >= 1) {                      // circumpolar: no sunset/sunrise
                log("Astrolabe: unequal hours skipped - at latitude " + phi +
                    " the declination circle " + decs[i].toFixed(2) + " never rises or sets");
                return;
            }
            nightStart.push(Math.acos(c));               // hour angle of setting
            nightArc.push(TWO_PI - 2 * Math.acos(c));    // night, in hour angle
        }
        // division point k/12 of the night on reference circle i
        function pt(i, k) {
            return plateFromEq(rad(decs[i]), nightStart[i] + k * nightArc[i] / 12);
        }
        function circleThrough(p1, p2, p3) {
            var d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
            if (Math.abs(d) < 1e-9 * Rc * Rc) { return null; }          // collinear
            var s1 = p1.x * p1.x + p1.y * p1.y, s2 = p2.x * p2.x + p2.y * p2.y,
                s3 = p3.x * p3.x + p3.y * p3.y;
            var cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / d;
            var cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / d;
            var r = Math.sqrt((p1.x - cx) * (p1.x - cx) + (p1.y - cy) * (p1.y - cy));
            return (r > 100 * Rc) ? null : { x: cx, y: cy, r: r };      // too flat to be an arc
        }
        for (var k = 1; k <= 11; k++) {
            var pCap = pt(0, k), pEq = pt(1, k), pCan = pt(2, k);
            var c = circleThrough(pCap, pEq, pCan);
            if (!c) { addLine("Unequal_Hours", pCap.x, pCap.y, pCan.x, pCan.y); continue; }
            var aCap = Math.atan2(pCap.y - c.y, pCap.x - c.x);
            var aEq = Math.atan2(pEq.y - c.y, pEq.x - c.x);
            var aCan = Math.atan2(pCan.y - c.y, pCan.x - c.x);
            if (norm2pi(aEq - aCap) < norm2pi(aCan - aCap)) {
                addArc("Unequal_Hours", c.x, c.y, c.r, aCap, aCan);     // ccw through the equator
            } else {
                addArc("Unequal_Hours", c.x, c.y, c.r, aCan, aCap);
            }
        }
        // hour numbers in the middle of each hour cell, half way between the
        // Capricorn and Equator division points - the rim itself is taken by
        // the ecliptic band where it touches Capricorn
        for (var h = 1; h <= 12; h++) {
            var mCap = plateFromEq(rad(decs[0]), nightStart[0] + (h - 0.5) * nightArc[0] / 12);
            var mEq = plateFromEq(rad(decs[1]), nightStart[1] + (h - 0.5) * nightArc[1] / 12);
            var mx = (mCap.x + mEq.x) / 2, my = (mCap.y + mEq.y) / 2;
            addTangentText("Unequal_Hours", mx, my, Math.atan2(my, mx), 0.022 * Rc, h);
        }
    })();

    // =======================================================================
    // 3. AZIMUTH LINES (great circles through zenith and nadir)
    // =======================================================================
    var Z = plateFromHor(90, 0), N = plateFromHor(-90, 0);
    for (var A = 0; A < 360 - 1e-9; A += cfg.azimuthStep) {
        var P = plateFromHor(0, A);
        if (Math.abs(P.x) < 1e-9 * Rc) {
            // meridian: straight line from zenith to the horizon point
            var yEnd = Math.max(-Rc, Math.min(Rc, P.y));
            addLine("Azimuth", 0, Z.y, 0, yEnd);
            continue;
        }
        var cy = (Z.y + N.y) / 2, dz = cy - Z.y;
        var cx = (P.x * P.x + (cy - P.y) * (cy - P.y) - dz * dz) / (2 * P.x);
        var r = Math.sqrt(cx * cx + dz * dz);
        var aZ = Math.atan2(Z.y - cy, Z.x - cx);
        var aP = Math.atan2(P.y - cy, P.x - cx);
        var aN = Math.atan2(N.y - cy, N.x - cx);
        var ccw = norm2pi(aP - aZ);
        if (norm2pi(aN - aZ) < ccw) { addArcClipped("Azimuth", cx, cy, r, aP, norm2pi(aZ - aP)); }
        else { addArcClipped("Azimuth", cx, cy, r, aZ, ccw); }
    }

    // =======================================================================
    // 3b. ANALEMMA: the true Sun at a fixed local MEAN time
    // =======================================================================
    // At mean hour h the mean sun stands at hour angle (h - 12) * 15 deg and
    // the true Sun is ahead of it by the equation of time, so a year of daily
    // positions closes into the figure of eight between the two tropics.
    (function drawAnalemma() {
        // equation of time (deg) = mean longitude - apparent right ascension
        function sunAt(jd) {
            var lam = rad(sunLongitude(jd));
            var L = 280.460 + 0.9856474 * (jd - 2451545.0);
            var ra = deg(Math.atan2(Math.cos(rad(eps)) * Math.sin(lam), Math.cos(lam)));
            return { dec: Math.asin(Math.sin(rad(eps)) * Math.sin(lam)),
                     eot: ((L - ra) % 360 + 540) % 360 - 180 };
        }
        for (var hi = 0; hi < cfg.analemmaHours.length; hi++) {
            var hour = cfg.analemmaHours[hi], Hmean = (hour - 12) * 15;
            var pts = [], marks = [], lowest = null;
            for (var m = 0; m < 12; m++) {
                for (var d = 1; d <= MONTH_DAYS[m]; d++) {
                    var sn = sunAt(julianDay(cfg.calendarYear, m + 1, d) + hour / 24);
                    var pp = plateFromEq(sn.dec, rad(Hmean + sn.eot));
                    pp.r = Math.sqrt(pp.x * pp.x + pp.y * pp.y);
                    pts.push(pp);
                    if (d === 1) { marks.push({ p: pp, name: MONTHS[m].substring(0, 3) }); }
                    if (lowest === null || pp.r < lowest.r) { lowest = pp; }
                }
            }
            for (var i = 0; i < pts.length; i++) {            // closed curve
                var q = pts[(i + 1) % pts.length];
                addLine("Analemma", pts[i].x, pts[i].y, q.x, q.y);
            }
            // first of each month, named in a column east of the figure: the
            // offset is perpendicular to the mean meridian, the same for all
            var thM = PI / 2 - rad(Hmean), offX = -0.09 * Rc * Math.sin(thM),
                offY = 0.09 * Rc * Math.cos(thM);
            for (var k = 0; k < marks.length; k++) {
                var mp = marks[k].p;
                addCircle("Analemma", mp.x, mp.y, 0.006 * Rc);
                addText("Analemma", mp.x + offX, mp.y + offY, 0.014 * Rc, marks[k].name, 0);
            }
            // the mean hour, at the Cancer end, just inside the curve
            var f = (lowest.r - 0.035 * Rc) / lowest.r;
            addText("Analemma", lowest.x * f, lowest.y * f, 0.018 * Rc, hour + "h", 0);
        }
    })();

    // =======================================================================
    // 4. ECLIPTIC with ZODIAC (1 deg) and CALENDAR (365 days) scales
    // =======================================================================
    var eclTop = plateFromEcliptic(90), eclBot = plateFromEcliptic(270);
    var eclCy = (eclTop.y + eclBot.y) / 2;
    var Re = (eclTop.y - eclBot.y) / 2;

    // Both scales sit on the ONE ecliptic line - no extra scale circle: the
    // calendar ticks run outwards from it, the zodiac ticks inwards, so a day
    // and its zodiac degree meet on the same point of the ecliptic.
    var zodIn = 0.080 * Rc;         // zodiac reach inside the ecliptic line (calOut: above)
    addCircle("Ecliptic", 0, eclCy, Re);

    // ray from the ecliptic centre through the point of ecliptic longitude lon
    function eclRay(lon) {
        var p = plateFromEcliptic(lon);
        var ang = Math.atan2(p.y - eclCy, p.x);
        return { ang: ang, cx: Math.cos(ang), cy: Math.sin(ang) };
    }
    function radial(layer, ray, r1, r2) {
        addLine(layer, r1 * ray.cx, eclCy + r1 * ray.cy, r2 * ray.cx, eclCy + r2 * ray.cy);
    }
    function ringText(layer, ray, rho, h, str) {
        addTangentText(layer, rho * ray.cx, eclCy + rho * ray.cy, ray.ang, h, str);
    }

    var signs = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
                 "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
    // zodiac: ticks and labels on the inner side of the ecliptic line
    for (var lon = 0; lon < 360; lon++) {
        var ray = eclRay(lon);
        var len = (lon % 30 === 0) ? 0.030 * Rc :
                  (lon % 10 === 0) ? 0.022 * Rc :
                  (lon % 5 === 0)  ? 0.016 * Rc : 0.010 * Rc;
        radial("Ecliptic_Zodiac", ray, Re, Re - len);
        if (lon % 10 === 0 && lon % 30 !== 0) {
            ringText("Ecliptic_Zodiac", ray, Re - 0.042 * Rc, 0.013 * Rc, lon % 30);
        }
    }
    for (var s = 0; s < 12; s++) {
        ringText("Ecliptic_Zodiac", eclRay(s * 30 + 15), Re - 0.066 * Rc, 0.018 * Rc, signs[s]);
    }

    // calendar: Sun position at 12:00 UT of each day of the reference year
    var sunLon = [];   // per month: array of longitudes
    for (var m = 0; m < 12; m++) {
        var arr = [];
        for (var d = 1; d <= MONTH_DAYS[m]; d++) {
            arr.push(sunLongitude(julianDay(cfg.calendarYear, m + 1, d) + 0.5));
        }
        sunLon.push(arr);
    }
    // calendar: ticks and labels on the outer side of the same line
    for (m = 0; m < 12; m++) {
        for (d = 1; d <= MONTH_DAYS[m]; d++) {
            var rayD = eclRay(sunLon[m][d - 1]);
            var tl = (d === 1)      ? 0.028 * Rc :
                     (d % 10 === 0) ? 0.022 * Rc :
                     (d % 5 === 0)  ? 0.016 * Rc : 0.010 * Rc;
            radial("Ecliptic_Calendar", rayD, Re, Re + tl);
            if (d % 5 === 0 && d <= 25) {
                ringText("Ecliptic_Calendar", rayD, Re + 0.042 * Rc, 0.013 * Rc, d);
            }
        }
        // month name centred between the 1st of this month and the 1st of the next
        var l0 = sunLon[m][0];
        var l1 = sunLon[(m + 1) % 12][0];
        var span = (l1 - l0 + 360) % 360;
        ringText("Ecliptic_Calendar", eclRay(l0 + span / 2), Re + 0.064 * Rc, 0.017 * Rc, MONTHS[m]);
    }

    // =======================================================================
    // 4b. RETE: star pointers
    // =======================================================================
    // A star of declination dec sits at r = Req * tan((90 - dec) / 2), so only
    // stars north of -eps fall inside the Tropic of Capricorn.
    for (var si = 0; si < STARS.length; si++) {
        var star = STARS[si], ps = plateFromRaDec(star[1], star[2]);
        var pr = Math.sqrt(ps.x * ps.x + ps.y * ps.y);
        if (pr > Rc) {
            log("Astrolabe: star " + star[0] + " (dec " + star[2].toFixed(2) +
                ") falls outside the Tropic of Capricorn - skipped");
            continue;
        }
        addCircle("Rete", ps.x, ps.y, 0.009 * Rc);
        // name beside the pointer, pushed away from the crowded rim
        var sgn = (pr > 0.75 * Rc) ? -1 : 1, sa = Math.atan2(ps.y, ps.x);
        var off = 0.028 * Rc;
        addTangentText("Rete", ps.x + sgn * off * Math.cos(sa), ps.y + sgn * off * Math.sin(sa),
                       sa, 0.018 * Rc, star[0]);
    }

    // =======================================================================
    // 5. LIMB: 360 degree scale standing on the Tropic of Capricorn
    // =======================================================================
    // no limb circle: the scale stands on the Tropic of Capricorn and runs outwards
    var dirSign = cfg.limbClockwise ? -1 : 1;
    for (var g = 0; g < 360; g++) {
        var th = PI / 2 + dirSign * rad(g);          // 0 deg at top
        var tlen = (g % 10 === 0) ? 0.035 * Rc : (g % 5 === 0) ? 0.025 * Rc : 0.015 * Rc;
        var ct = Math.cos(th), st = Math.sin(th);
        addLine("Limb", Rc * ct, Rc * st, (Rc + tlen) * ct, (Rc + tlen) * st);
        if (g % 10 === 0) {
            var rr = Rc + (limbW + 0.035 * Rc) / 2;   // between the ticks and the outer end
            addTangentText("Limb", rr * ct, rr * st, th, 0.026 * Rc, g);
        }
    }

    // =======================================================================
    // 6. INDEX with DECLINATION SCALE
    // =======================================================================
    (function drawIndex() {
        var L = Rl;                        // length from pivot
        var ia = rad(cfg.indexAngle);
        var ox = 0, oy = 0;
        if (cfg.indexSeparate) { ia = 0; ox = Rl + 0.25 * Rc; oy = 0; }
        var ca = Math.cos(ia), sa = Math.sin(ia);
        function gx(u, v) { return ox + u * ca - v * sa; }
        function gy(u, v) { return oy + u * sa + v * ca; }
        function line(u1, v1, u2, v2) { addLine("Index", gx(u1, v1), gy(u1, v1), gx(u2, v2), gy(u2, v2)); }

        // no outline: just the base line through the pivot and the scale on it
        line(0, 0, L, 0);

        // declination scale: tick at radius r(dec) = Req * tan((90 - dec)/2)
        var flip = Math.cos(ia) < -1e-9;
        for (var dec = 89; dec >= -89; dec--) {
            var r = Req * Math.tan(rad(90 - dec) / 2);
            if (r > L - 0.015 * Rc) { break; }
            if (r < 0.02 * Rc) { continue; }
            var tl = (dec % 10 === 0) ? 0.030 * Rc : (dec % 5 === 0) ? 0.022 * Rc : 0.012 * Rc;
            line(r, 0, r, tl);
            if (dec % 10 === 0) {
                addText("Index", gx(r, -0.0175 * Rc), gy(r, -0.0175 * Rc), 0.016 * Rc, dec,
                        ia + (flip ? PI : 0));
            }
        }
    })();

    // =======================================================================
    // APPLY
    // =======================================================================
    op.setText("Astrolabe");
    di.applyOperation(op);
    try { di.autoZoom(); } catch (e) { }

    var summary = "Astrolabe: D=" + cfg.diameter + " lat=" + phi +
        "  R_equator=" + Req.toFixed(3) + " R_cancer=" + Rcan.toFixed(3) +
        " R_capricorn=" + Rc.toFixed(3) + " R_limb=" + Rl.toFixed(3);
    log(summary);
    for (var key in counts) { log("  layer " + key + ": " + counts[key] + " entities"); }

    // expose geometry for testing outside QCAD
    if (typeof __ASTROLABE_TEST__ !== "undefined") {
        __ASTROLABE_TEST__.geom = {
            Req: Req, Rcan: Rcan, Rc: Rc, Rl: Rl, Re: Re, calOut: calOut, zodIn: zodIn, limbW: limbW,
            eclCy: eclCy, phi: phi, eps: eps, year: cfg.calendarYear,
            analemmaHours: cfg.analemmaHours,
            plateFromEcliptic: plateFromEcliptic, sunLongitude: sunLongitude, julianDay: julianDay
        };
    }
})();
