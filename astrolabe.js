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
 *     Analemma (the true Sun at a fixed local mean hour, one figure per hour,
 *     stepped and marked by ecliptic longitude, named by the zodiac signs),
 *     Ecliptic (a single line, the only circle of the band),
 *     Ecliptic_Calendar (365 days / 12 months, outside that line),
 *     Ecliptic_Zodiac (equal zodiac, 1 degree scale, inside that line),
 *     Ecliptic_Moon (29 1/2 days of the synodic month, deeper inside),
 *     Rete (19 star pointers with their Latin names),
 *     Index (base line + declination scale), Limb (360 degree scale standing
 *     on the Tropic of Capricorn)
 *
 * and a second, printable layout of the same three scales in the historical
 * manner - concentric rings, one resolution per ring, the finest against the
 * scale's base line:
 *
 *     Print_Zodiac (the rete's only scale, rings inwards from the ecliptic
 *     line, with the Aries 0 mark), Print_Limb (1 / 5 / 10 degree rings on
 *     Capricorn), Print_Moon, Print_Longitude and Print_Calendar (the mater's
 *     band outside the limb, graduated in ecliptic longitude about the pole),
 *     Print_Index (the same as parallel bands beside the fiducial line)
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
 *   - Lunar scale: a tick every 360 / 29.530588 = 12.1907 deg of ecliptic
 *     longitude, the Moon's daily gain on the Sun; counted from the Sun's
 *     date mark it gives the Moon's mean longitude (no absolute meaning).
 *   - Star: r = R_eq tan((90 - dec)/2) at the rete angle of its right
 *     ascension (RA 0 to +X), so only stars north of -eps fit on the plate.
 *   - Index: declination scale at radii r(90 - dec) along the index edge.
 *   - Printable layout: the same divisions, drawn from one ring of their
 *     track to the next instead of as free ticks on a single line, and
 *     lettered in cfg.printFont rather than cfg.textFont.
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
        synodicMonth: 29.530588,// days from new moon to new moon (lunar scale)
        almucantarStep: 5,      // degrees between almucantars
        almucantarLabelStep: 10,// label every n degrees of altitude (0 = none)
        azimuthStep: 10,        // degrees between azimuth lines
        twilights: [-6, -12, -18],// solar depressions: civil / nautical / astronomical
        analemmaHours: [12],    // local MEAN hours to draw the analemma for (12 = mean noon)
        calendarYear: 2026,     // reference (non-leap) year for the 365 day calendar

        limbClockwise: true,    // limb 0 deg at top, increasing clockwise
        indexAngle: 60.0,       // index direction (degrees, CCW from +X)
        indexSeparate: false,   // true: draw the index beside the astrolabe

        textFont: "Standard",   // font of the working layers
        printFont: "Pfeffer Simpelgotisch"  // font of the Print_* layers
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
        ["Ecliptic_Moon",     [100, 120, 160]],
        ["Rete",              [150,  20,  60]],
        ["Index",             [230,  40, 140]],
        ["Limb",              [ 90,  90,  90]],
        ["Print_Calendar",    [ 25, 100,  60]],
        ["Print_Longitude",   [ 55,  75, 105]],
        ["Print_Zodiac",      [ 10,  95, 115]],
        ["Print_Moon",        [ 75,  90, 150]],
        ["Print_Limb",        [ 50,  50,  50]],
        ["Print_Index",       [140,  40,  40]]
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
    var MONTHS_LA = ["Ianuarius", "Februarius", "Martius", "Aprilis", "Maius",
                     "Iunius", "Iulius", "Augustus", "September", "October",
                     "November", "December"];        // printable layout
    var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra",
                 "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

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
    var outerW = 0.140 * Rc;                         // the mater's band outside the limb
    var Rout = Rl + outerW;                          // outermost circle of the drawing

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

    // every layer defaults to hairline (0.00 mm): the plotter or printer decides
    // the stroke, not the drawing
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
        // nothing carries its own weight, so the layer's hairline always wins
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

    // counter-clockwise arc from a0 to a1 (radians)
    function addArc(layer, cx, cy, r, a0, a1) {
        put(layer, new RArcEntity(doc, new RArcData(new RVector(cx, cy), r, a0, a1, false)));
    }

    function makeTextData(pos, h, str, ang, font) {
        var variants = [
            function () {
                return new RTextData(pos, pos, h, 0, RS.VAlignMiddle, RS.HAlignCenter,
                    RS.LeftToRight, RS.Exact, 1.0, str, font, "", false, false, ang, true);
            },
            function () {
                return new RTextData(pos, pos, h, 0, RS.VAlignMiddle, RS.HAlignCenter,
                    RS.LeftToRight, RS.Exact, 1.0, str, font, false, false, ang, true);
            }
        ];
        for (var i = 0; i < variants.length; i++) {
            try { return variants[i](); } catch (e) { }
        }
        return null;
    }

    var textWarned = false;
    // text centred at (x,y), rotated by ang (radians); the printable layout is
    // lettered in its own face
    function addText(layer, x, y, h, str, ang) {
        var font = (layer.indexOf("Print_") === 0) ? cfg.printFont : cfg.textFont;
        var td = makeTextData(new RVector(x, y), h, String(str), ang, font);
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

    // A band of concentric tracks about (cx, cy) - the historical way of laying
    // out a scale: bounds[] are the ring radii from the base line outwards (or
    // inwards), and track i, between bounds[i] and bounds[i+1], carries its own
    // set of division angles, the finest next to the base line.  Each track may
    // name its divisions, centred in the ring.
    function labelAt(labels, a) {
        for (var i = 0; i < labels.length; i++) {
            if (Math.abs(labels[i].a - a) < 1e-9) { return true; }
        }
        return false;
    }

    function ringBand(layer, cx, cy, bounds, tracks, skipFirstCircle) {
        for (var i = skipFirstCircle ? 1 : 0; i < bounds.length; i++) {
            addCircle(layer, cx, cy, bounds[i]);
        }
        for (i = 0; i < tracks.length; i++) {
            var r1 = bounds[i], r2 = bounds[i + 1], t = tracks[i], k, a;
            var rm = (r1 + r2) / 2, half = (t.labels ? 1.3 * t.textH : 0) / 2;
            function ray(ra, rb, ang) {
                addLine(layer, cx + ra * Math.cos(ang), cy + ra * Math.sin(ang),
                               cx + rb * Math.cos(ang), cy + rb * Math.sin(ang));
            }
            for (k = 0; k < t.angles.length; k++) {
                a = t.angles[k];
                // a division that carries a number is broken where the number sits
                if (half > 0 && labelAt(t.labels, a)) {
                    ray(r1, rm + (r1 > r2 ? half : -half), a);
                    ray(rm + (r1 > r2 ? -half : half), r2, a);
                } else {
                    ray(r1, r2, a);
                }
            }
            if (!t.labels) { continue; }
            for (k = 0; k < t.labels.length; k++) {
                a = t.labels[k].a;
                addTangentText(layer, cx + rm * Math.cos(a), cy + rm * Math.sin(a),
                               a, t.textH, t.labels[k].s);
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
    // the true Sun is ahead of it by the equation of time, so a year of solar
    // positions closes into the figure of eight between the two tropics.  It
    // is stepped and marked by the Sun's ECLIPTIC LONGITUDE, not by the
    // calendar: a division every degree, a tick every fifth and tenth, and the
    // name of each sign where the Sun enters it.
    (function drawAnalemma() {
        // equation of time (deg) = mean longitude - apparent right ascension
        function sunAt(jd) {
            var lam = rad(sunLongitude(jd));
            var L = 280.460 + 0.9856474 * (jd - 2451545.0);
            var ra = deg(Math.atan2(Math.cos(rad(eps)) * Math.sin(lam), Math.cos(lam)));
            return { dec: Math.asin(Math.sin(rad(eps)) * Math.sin(lam)),
                     eot: ((L - ra) % 360 + 540) % 360 - 180 };
        }
        // the instant the Sun reaches a longitude: it never moves backwards, so
        // a bisection over the year finds it
        var jdY = julianDay(cfg.calendarYear, 1, 1), lonY = sunLongitude(jdY);
        function jdOfLon(lon) {
            var t = ((lon - lonY) % 360 + 360) % 360;
            var a = jdY, b = jdY + 365.2422 - 0.001;
            for (var i = 0; i < 50; i++) {
                var mid = (a + b) / 2;
                if (((sunLongitude(mid) - lonY) % 360 + 360) % 360 < t) { a = mid; } else { b = mid; }
            }
            return (a + b) / 2;
        }
        var sun = [];                                   // one entry per degree
        for (var lo = 0; lo < 360; lo++) { sun.push(sunAt(jdOfLon(lo))); }

        for (var hi = 0; hi < cfg.analemmaHours.length; hi++) {
            var hour = cfg.analemmaHours[hi], Hmean = (hour - 12) * 15;
            var pts = [], lowest = null;
            for (lo = 0; lo < 360; lo++) {
                var pp = plateFromEq(sun[lo].dec, rad(Hmean + sun[lo].eot));
                pp.r = Math.sqrt(pp.x * pp.x + pp.y * pp.y);
                pts.push(pp);
                if (lowest === null || pp.r < lowest.r) { lowest = pp; }
            }
            var n = pts.length;
            for (var i = 0; i < n; i++) {                   // closed curve
                var q = pts[(i + 1) % n];
                addLine("Analemma", pts[i].x, pts[i].y, q.x, q.y);
            }
            // every fifth degree of longitude, a tick across the curve, longer
            // every tenth; the thirtieths are left to the sign marks
            for (i = 0; i < n; i++) {
                if (i % 5 !== 0 || i % 30 === 0) { continue; }
                var pv = pts[(i + n - 1) % n], nx = pts[(i + 1) % n];
                var tx = nx.x - pv.x, ty = nx.y - pv.y, tl = Math.sqrt(tx * tx + ty * ty);
                if (tl < 1e-12) { continue; }
                var half = ((i % 10 === 0) ? 0.017 : 0.012) * Rc / 2;
                var ux = -ty / tl * half, uy = tx / tl * half;   // across the curve
                addLine("Analemma", pts[i].x - ux, pts[i].y - uy, pts[i].x + ux, pts[i].y + uy);
            }
            // where the Sun enters each sign: a dot, and the sign abbreviated
            // beside it - set across the figure, on the side that point is
            // already on, so the name stays with its own mark
            var thM = PI / 2 - rad(Hmean);
            var px = -Math.sin(thM), py = Math.cos(thM);    // across the figure
            for (var sg = 0; sg < 12; sg++) {
                var mp = pts[sg * 30];
                addCircle("Analemma", mp.x, mp.y, 0.006 * Rc);
                var off = ((mp.x * px + mp.y * py >= 0) ? 1 : -1) * 0.028 * Rc;
                addText("Analemma", mp.x + off * px, mp.y + off * py, 0.016 * Rc,
                        SIGNS[sg].substring(0, 3), 0);
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
        ringText("Ecliptic_Zodiac", eclRay(s * 30 + 15), Re - 0.066 * Rc, 0.018 * Rc, SIGNS[s]);
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
    // 4c. LUNAR SCALE: the 29 1/2 days of the synodic month
    // =======================================================================
    // The Moon gains 360 / 29.530588 = 12.1907 deg of ecliptic longitude on the
    // Sun each day, so counting these divisions from the Sun's date mark gives
    // its mean place.  Only the count from the Sun means anything - never the
    // absolute division - so the scale carries no numbers and is read by the
    // length of its ticks (every fifth and tenth longer).  The origin is put at
    // 0 deg Aries; the wider gap before it is the half day the month leaves over.
    var moonStep = 360 / cfg.synodicMonth;
    var moonTop = Re - 0.084 * Rc;              // clear of the zodiac sign names
    for (var mday = 0; mday < cfg.synodicMonth; mday++) {
        var mlen = (mday % 10 === 0) ? 0.026 * Rc :
                   (mday % 5 === 0)  ? 0.020 * Rc : 0.014 * Rc;
        radial("Ecliptic_Moon", eclRay(mday * moonStep), moonTop, moonTop - mlen);
    }

    // =======================================================================
    // 4d. PRINT_ZODIAC: the rete's only scale, as rings
    // =======================================================================
    // The rete has to leave the tympanum visible, so it carries the zodiac
    // alone - 1 deg, 5 deg with numbers, signs - 0.074 Rc deep inwards from the
    // ecliptic line, hiding a tenth of the plate instead of a fifth.  The
    // calendar and the Moon sit outside the limb instead (section 5c).
    (function printZodiac() {
        var z1 = [], z5 = [], z5Lab = [], zSign = [], zSignLab = [];
        for (var lo = 0; lo < 360; lo++) {
            var az = eclRay(lo).ang;
            z1.push(az);
            if (lo % 5 === 0) { z5.push(az); }
            if (lo % 10 === 0 && lo % 30 !== 0) { z5Lab.push({ a: az, s: lo % 30 }); }
            if (lo % 30 === 0) { zSign.push(az); }
        }
        for (var sg = 0; sg < 12; sg++) { zSignLab.push({ a: eclRay(sg * 30 + 15).ang, s: SIGNS[sg] }); }
        ringBand("Print_Zodiac", 0, eclCy,
                 [Re, Re - 0.018 * Rc, Re - 0.044 * Rc, Re - 0.074 * Rc],
                 [{ angles: z1 },
                  { angles: z5, labels: z5Lab, textH: 0.013 * Rc },
                  { angles: zSign, labels: zSignLab, textH: 0.017 * Rc }], true);

        // Start of the zodiac: Aries 0, where the ecliptic crosses the equator.
        // Every ring already has a division on this ray, so only the stub
        // outside the ecliptic line is added - the one mark that crosses the
        // line, and the origin every reading is counted from.
        var aries = eclRay(0);
        radial("Print_Zodiac", aries, Re, Re + 0.030 * Rc);
        ringText("Print_Zodiac", aries, Re + 0.046 * Rc, 0.020 * Rc, 0);
    })();

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
    // 5b. PRINT_LIMB: 1 / 5 / 10 degree rings standing on Capricorn
    // =======================================================================
    (function printLimb() {
        var deg1 = [], deg5 = [], deg10 = [], lab = [];
        for (var g2 = 0; g2 < 360; g2++) {
            var th2 = PI / 2 + dirSign * rad(g2);
            deg1.push(th2);
            if (g2 % 5 === 0) { deg5.push(th2); }
            if (g2 % 10 === 0) { deg10.push(th2); lab.push({ a: th2, s: g2 }); }
        }
        ringBand("Print_Limb", 0, 0,
                 [Rc, Rc + 0.022 * Rc, Rc + 0.044 * Rc, Rl],
                 [{ angles: deg1 },
                  { angles: deg5 },
                  { angles: deg10, labels: lab, textH: 0.018 * Rc }], false);
    })();

    // =======================================================================
    // 5c. THE MATER'S OUTER BAND: calendar, longitude and Moon
    // =======================================================================
    // Outside the limb, graduated in ecliptic LONGITUDE measured about the pole
    // (0 at +X, increasing counter-clockwise, as on the rete): the Moon's
    // 29 1/2 days, the signs, the degrees within them, the days of the year and
    // their months.  A date is read off as a sign and a degree and then found
    // on the rete's zodiac, counting from the Aries 0 mark.  The transfer is by
    // value and not by bearing: the longitude of a point and its right
    // ascension differ by up to 2.47 deg, which is 2.5 days of solar motion.
    (function printOuterBand() {
        var moonO = [], signO = [], signLabO = [], d5 = [], d5Lab = [], d1 = [];
        for (var lo = 0; lo < 360; lo++) {
            d1.push(rad(lo));
            if (lo % 5 === 0) { d5.push(rad(lo)); }
            if (lo % 10 === 0 && lo % 30 !== 0) { d5Lab.push({ a: rad(lo), s: lo % 30 }); }
            if (lo % 30 === 0) { signO.push(rad(lo)); }
        }
        for (var sg = 0; sg < 12; sg++) { signLabO.push({ a: rad(sg * 30 + 15), s: SIGNS[sg] }); }
        for (var mk = 0; mk < cfg.synodicMonth; mk++) { moonO.push(rad(mk * moonStep)); }

        var dayO = [], monDivO = [], monLabO = [];
        for (var mm = 0; mm < 12; mm++) {
            for (var dd = 1; dd <= MONTH_DAYS[mm]; dd++) {
                dayO.push(rad(sunLon[mm][dd - 1]));
                if (dd === 1) { monDivO.push(rad(sunLon[mm][dd - 1])); }
            }
            var l0 = sunLon[mm][0], l1 = sunLon[(mm + 1) % 12][0];
            monLabO.push({ a: rad(l0 + ((l1 - l0 + 360) % 360) / 2), s: MONTHS_LA[mm] });
        }

        // each scale owns the rings it adds; the limb already drew Rl
        ringBand("Print_Moon", 0, 0, [Rl, Rl + 0.022 * Rc],
                 [{ angles: moonO }], true);
        ringBand("Print_Longitude", 0, 0,
                 [Rl + 0.022 * Rc, Rl + 0.052 * Rc, Rl + 0.078 * Rc, Rl + 0.094 * Rc],
                 [{ angles: signO, labels: signLabO, textH: 0.017 * Rc },
                  { angles: d5, labels: d5Lab, textH: 0.013 * Rc },
                  { angles: d1 }], true);
        ringBand("Print_Calendar", 0, 0,
                 [Rl + 0.094 * Rc, Rl + 0.112 * Rc, Rout],
                 [{ angles: dayO },
                  { angles: monDivO, labels: monLabO, textH: 0.017 * Rc }], true);
    })();

    // =======================================================================
    // 6. INDEX with DECLINATION SCALE
    // =======================================================================
    // where the rule lies, shared by the working and the printed layout
    function indexFrame() {
        var f = { L: Rl, ia: rad(cfg.indexAngle), ox: 0, oy: 0 };
        if (cfg.indexSeparate) { f.ia = 0; f.ox = Rl + 0.25 * Rc; }
        return f;
    }

    (function drawIndex() {
        var fr = indexFrame(), L = fr.L, ia = fr.ia, ox = fr.ox, oy = fr.oy;
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
    // 6b. PRINT_INDEX: the declination scale as parallel bands
    // =======================================================================
    // The straight-line form of the ringed band: the fiducial line takes the
    // place of the base circle, with the 1 / 5 / 10 degree tracks stacked
    // beside it, finest against the line.  No outline, as on the working rule.
    (function printIndex() {
        var fr = indexFrame(), L = fr.L, ia = fr.ia, ox = fr.ox, oy = fr.oy;
        var ca = Math.cos(ia), sa = Math.sin(ia);
        function gx(u, v) { return ox + u * ca - v * sa; }
        function gy(u, v) { return oy + u * sa + v * ca; }
        function line(u1, v1, u2, v2) {
            addLine("Print_Index", gx(u1, v1), gy(u1, v1), gx(u2, v2), gy(u2, v2));
        }
        var bounds = [0, 0.022 * Rc, 0.044 * Rc, 0.080 * Rc];   // across the rule
        var flip = Math.cos(ia) < -1e-9;
        var uMin = 1e30, uMax = -1e30, decs = [];
        for (var dec = 89; dec >= -89; dec--) {
            var r = Req * Math.tan(rad(90 - dec) / 2);
            if (r > L - 0.015 * Rc) { break; }
            if (r < 0.02 * Rc) { continue; }
            decs.push({ dec: dec, u: r });
            uMin = Math.min(uMin, r); uMax = Math.max(uMax, r);
        }
        line(0, 0, L, 0);                                  // fiducial, full length
        for (var b = 1; b < bounds.length; b++) { line(uMin, bounds[b], uMax, bounds[b]); }
        for (var i = 0; i < decs.length; i++) {
            var d = decs[i].dec, u = decs[i].u;
            var top = (d % 10 === 0) ? bounds[3] : (d % 5 === 0) ? bounds[2] : bounds[1];
            line(u, 0, u, top);
            if (d % 10 === 0) {
                var vm = (bounds[2] + bounds[3]) / 2;
                addText("Print_Index", gx(u, vm), gy(u, vm), 0.016 * Rc, d, ia + (flip ? PI : 0));
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
            synodicMonth: cfg.synodicMonth, moonTop: moonTop, Rout: Rout,
            analemmaHours: cfg.analemmaHours,
            plateFromEcliptic: plateFromEcliptic, sunLongitude: sunLongitude, julianDay: julianDay
        };
    }
})();
