// A minimal mock of the QCAD API, shared by the verification harnesses.
// run(scriptFile, answer, answerItem) executes a QCAD script against it and
// hands back everything it drew.  `answer(label)` supplies the numbers and
// `answerItem(label, items)` the choices the script asks for through
// QInputDialog.
var fs = require('fs'), vm = require('vm');

function run(scriptFile, answer, answerItem) {
  var ents = [], layers = {}, layerObjs = [], nextId = 1;
  function V(x, y) { this.x = x; this.y = y; }
  function Ent(kind, d) { this.kind = kind; this.d = d; this.layer = null; this.lw = undefined; }
  Ent.prototype.setLayerId = function (id) { this.layer = id; };
  Ent.prototype.setLineweight = function (w) { this.lw = w; };
  var g = {
    __ASTROLABE_TEST__: {},
    __EQUATORIUM_TEST__: {},
    include: function () {},
    qDebug: function (s) { console.log(s); },
    RVector: V,
    RColor: function (r, gg, b) { this.c = [r, gg, b]; },
    RLineweight: { Weight000: 0, Weight025: 25, WeightByLayer: -1 },
    RS: { VAlignMiddle: 1, HAlignCenter: 1, LeftToRight: 1, Exact: 1 },
    RLayer: function (doc, name) { this.name = name; this.lineweight = arguments[6]; },
    RLineData: function (a, b) { this.a = a; this.b = b; },
    RCircleData: function (c, r) { this.c = c; this.r = r; },
    RArcData: function (c, r, a0, a1, rev) { this.c = c; this.r = r; this.a0 = a0; this.a1 = a1; },
    RTextData: function (pos, p2, h, w, va, ha, dd, ls, lf, text, font) {
      var a = arguments; this.pos = pos; this.h = h; this.text = text; this.font = font;
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
    QInputDialog: {
      getDouble: function (p, t, label, def) { return answer(label, def); },
      getItem: function (p, t, label, items, cur) {
        return answerItem ? answerItem(label, items) : items[cur];
      }
    },
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
              if (o.name) { layers[o.name] = nextId++; layerObjs.push(o); }
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
  vm.runInContext(fs.readFileSync(scriptFile, 'utf8'), g);

  var layerName = {};
  Object.keys(layers).forEach(function (n) { layerName[layers[n]] = n; });
  ents.forEach(function (e) { e.L = layerName[e.layer]; });
  return { ents: ents, layers: layers, layerObjs: layerObjs, g: g,
           geom: g.__ASTROLABE_TEST__.geom || g.__EQUATORIUM_TEST__.geom };
}

module.exports = { run: run };
