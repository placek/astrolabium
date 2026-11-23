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
 *     Equator, Tropic_Cancer, Tropic_Capricorn, Horizon, Almucantars, Azimuth,
 *     Ecliptic, Ecliptic_Zodiac (equal zodiac, 1 degree scale),
 *     Ecliptic_Calendar (365 days / 12 months), Index (with declination
 *     scale), Limb (360 degree scale outside the plate), Axes, Pole
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
 *     R_eq/tan(phi), radius R_eq/sin(phi)).
 *   - Azimuth circle: passes through zenith and nadir and the horizon point of
 *     that azimuth (computed with the horizontal -> equatorial transform).
 *   - Ecliptic: circle through the solstice points r(90-eps) and r(90+eps);
 *     the point of ecliptic longitude L is found from
 *     sin(dec) = sin(eps) sin(L), tan(RA) = cos(eps) tan(L).
 *   - Calendar: the Sun's ecliptic longitude for each day (low-precision
 *     solar ephemeris, ~0.01 deg) is placed on the ecliptic.
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
        latitude: 50.0,         // observer latitude, degrees north (1 .. 89)
        askUser: true,          // show input dialogs for diameter / latitude

        obliquity: 23.4393,     // obliquity of the ecliptic, degrees
        almucantarStep: 5,      // degrees between almucantars
        almucantarLabelStep: 10,// label every n degrees of altitude (0 = none)
        azimuthStep: 10,        // degrees between azimuth lines
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
        ["Azimuth",           [150,  60, 200]],
        ["Ecliptic",          [200, 160,   0]],
        ["Ecliptic_Zodiac",   [190, 100,  20]],
        ["Ecliptic_Calendar", [120, 120,  20]],
        ["Index",             [230,  40, 140]],
        ["Limb",              [ 90,  90,  90]],
        ["Axes",              [140, 140, 140]],
        ["Pole",              [ 60,  60,  60]]
    ];

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
    var Rl = Rc * 1.10;                              // outer edge of the limb

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
    // 1. EQUATOR, TROPICS, POLE, AXES
    // =======================================================================
    addCircle("Equator", 0, 0, Req);
    addCircle("Tropic_Cancer", 0, 0, Rcan);
    addCircle("Tropic_Capricorn", 0, 0, Rc);
    addCircle("Pole", 0, 0, 0.012 * Rc);
    addLine("Axes", 0, -Rc, 0, Rc);
    addLine("Axes", -Rc, 0, Rc, 0);

    // =======================================================================
    // 2. HORIZON AND ALMUCANTARS
    // =======================================================================
    function almucantar(layer, a) {
        var y1 = yOnMeridian(180 - phi - a);
        var y2 = yOnMeridian(a - phi);
        var r = Math.abs(y1 - y2) / 2;
        if (r < 1e-9) { addCircle(layer, 0, y1, 0.006 * Rc); return; }   // zenith
        addArcClipped(layer, 0, (y1 + y2) / 2, r, 0, TWO_PI);
        return y1;
    }
    almucantar("Horizon", 0);
    var labelH = 0.016 * Rc;
    for (var a = cfg.almucantarStep; a <= 90 + 1e-9; a += cfg.almucantarStep) {
        var yTop = almucantar("Almucantars", a);
        if (cfg.almucantarLabelStep > 0 && yTop !== undefined &&
            Math.abs(a / cfg.almucantarLabelStep - Math.round(a / cfg.almucantarLabelStep)) < 1e-9 &&
            a < 90 && yTop < Rc - 2 * labelH) {
            addText("Almucantars", 1.2 * labelH, yTop + 0.8 * labelH, labelH, Math.round(a), 0);
        }
    }

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
    // 4. ECLIPTIC with ZODIAC (1 deg) and CALENDAR (365 days) scales
    // =======================================================================
    var eclTop = plateFromEcliptic(90), eclBot = plateFromEcliptic(270);
    var eclCy = (eclTop.y + eclBot.y) / 2;
    var Re = (eclTop.y - eclBot.y) / 2;
    addCircle("Ecliptic", 0, eclCy, Re);

    var zodiacW = 0.09 * Rc, calW = 0.075 * Rc;
    var Rz = Re - zodiacW;          // inner edge of zodiac ring
    var Rcal = Rz - calW;           // inner edge of calendar ring
    addCircle("Ecliptic_Zodiac", 0, eclCy, Rz);
    addCircle("Ecliptic_Calendar", 0, eclCy, Rcal);

    // point at radius rho on the ray from the ecliptic centre through longitude lon
    function eclRay(lon) {
        var p = plateFromEcliptic(lon);
        return { ang: Math.atan2(p.y - eclCy, p.x), cx: Math.cos(Math.atan2(p.y - eclCy, p.x)),
                 cy: Math.sin(Math.atan2(p.y - eclCy, p.x)) };
    }
    function radial(layer, ray, rOuter, rInner) {
        addLine(layer, rOuter * ray.cx, eclCy + rOuter * ray.cy, rInner * ray.cx, eclCy + rInner * ray.cy);
    }
    function ringText(layer, ray, rho, h, str) {
        addTangentText(layer, rho * ray.cx, eclCy + rho * ray.cy, ray.ang, h, str);
    }

    var signs = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
                 "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
    for (var lon = 0; lon < 360; lon++) {
        var ray = eclRay(lon);
        var len = (lon % 30 === 0) ? zodiacW :
                  (lon % 10 === 0) ? 0.030 * Rc :
                  (lon % 5 === 0)  ? 0.020 * Rc : 0.012 * Rc;
        radial("Ecliptic_Zodiac", ray, Re, Re - len);
        if (lon % 10 === 0 && lon % 30 !== 0) {
            ringText("Ecliptic_Zodiac", ray, Re - 0.045 * Rc, 0.014 * Rc, lon % 30);
        }
    }
    for (var s = 0; s < 12; s++) {
        ringText("Ecliptic_Zodiac", eclRay(s * 30 + 15), Re - 0.072 * Rc, 0.020 * Rc, signs[s]);
    }

    // calendar: Sun position at 12:00 UT of each day of the reference year
    var months = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"];
    var mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var sunLon = [];   // per month: array of longitudes
    for (var m = 0; m < 12; m++) {
        var arr = [];
        for (var d = 1; d <= mdays[m]; d++) {
            arr.push(sunLongitude(julianDay(cfg.calendarYear, m + 1, d) + 0.5));
        }
        sunLon.push(arr);
    }
    for (m = 0; m < 12; m++) {
        for (d = 1; d <= mdays[m]; d++) {
            var rayD = eclRay(sunLon[m][d - 1]);
            var tl = (d === 1)      ? calW :
                     (d % 10 === 0) ? 0.026 * Rc :
                     (d % 5 === 0)  ? 0.020 * Rc : 0.012 * Rc;
            radial("Ecliptic_Calendar", rayD, Rz, Rz - tl);
            if (d % 5 === 0 && d <= 25) {
                ringText("Ecliptic_Calendar", rayD, Rz - 0.040 * Rc, 0.013 * Rc, d);
            }
        }
        // month name centred between the 1st of this month and the 1st of the next
        var l0 = sunLon[m][0];
        var l1 = sunLon[(m + 1) % 12][0];
        var span = (l1 - l0 + 360) % 360;
        ringText("Ecliptic_Calendar", eclRay(l0 + span / 2), Rz - 0.062 * Rc, 0.017 * Rc, months[m]);
    }

    // =======================================================================
    // 5. LIMB: 360 degree scale outside the plate
    // =======================================================================
    addCircle("Limb", 0, 0, Rl);
    var dirSign = cfg.limbClockwise ? -1 : 1;
    for (var g = 0; g < 360; g++) {
        var th = PI / 2 + dirSign * rad(g);          // 0 deg at top
        var tlen = (g % 10 === 0) ? 0.035 * Rc : (g % 5 === 0) ? 0.025 * Rc : 0.015 * Rc;
        var ct = Math.cos(th), st = Math.sin(th);
        addLine("Limb", Rl * ct, Rl * st, (Rl - tlen) * ct, (Rl - tlen) * st);
        if (g % 10 === 0) {
            var rr = Rc + 0.045 * Rc;
            addTangentText("Limb", rr * ct, rr * st, th, 0.028 * Rc, g);
        }
    }

    // =======================================================================
    // 6. INDEX with DECLINATION SCALE
    // =======================================================================
    (function drawIndex() {
        var w = 0.07 * Rc;                 // strip width, centre line = scale edge
        var L = Rl;                        // length from pivot
        var ia = rad(cfg.indexAngle);
        var ox = 0, oy = 0;
        if (cfg.indexSeparate) { ia = 0; ox = Rl + 0.25 * Rc + w / 2; oy = 0; }
        var ca = Math.cos(ia), sa = Math.sin(ia);
        function gx(u, v) { return ox + u * ca - v * sa; }
        function gy(u, v) { return oy + u * sa + v * ca; }
        function line(u1, v1, u2, v2) { addLine("Index", gx(u1, v1), gy(u1, v1), gx(u2, v2), gy(u2, v2)); }

        // outline: two long edges, flat tip, rounded pivot end, pivot hole
        line(0, w / 2, L, w / 2);
        line(0, -w / 2, L, -w / 2);
        line(L, -w / 2, L, w / 2);
        addArc("Index", ox, oy, w / 2, ia + PI / 2, ia + 3 * PI / 2);
        addCircle("Index", ox, oy, 0.012 * Rc);
        line(0, 0, L, 0);                  // fiducial (scale) line through the pivot

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
            Req: Req, Rcan: Rcan, Rc: Rc, Rl: Rl, Re: Re, eclCy: eclCy, phi: phi,
            plateFromEcliptic: plateFromEcliptic, sunLongitude: sunLongitude, julianDay: julianDay
        };
    }
})();
