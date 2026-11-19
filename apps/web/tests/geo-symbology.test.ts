import assert from "node:assert/strict";
import test from "node:test";
import type { GisLayer, LayerStyle } from "../components/geo/gis/types";
import {
  buildSymbolizer,
  labelAnchor,
  markerSvg,
  parseStyleExtras,
  resolveLabelStyle,
  styleExtras,
} from "../components/geo/gis/symbology";
import { COLOR_RAMPS } from "../components/geo/gis/gis-data";
import { deriveLegend } from "../lib/geo-export-data";
import { parseWorkspaceDocument, buildWorkspaceDocument } from "../components/geo/gis/workspace";

const base: LayerStyle = {
  mode: "single", color: "#3f7c5f", palette: "categorical", ramp: "earth", classification: "quantile",
  classes: 5, colorBy: null, opacity: 0.8, strokeWidth: 1, size: 6, labels: false, labelField: null,
};

function layer(geometry: GisLayer["geometry"], values: unknown[], style: Partial<LayerStyle>, field = "tipo"): GisLayer {
  return {
    id: "l1", name: "Capa", geometry, visible: true, loadedAt: 1, style: { ...base, ...style },
    geojson: {
      type: "FeatureCollection",
      features: values.map((v) => ({
        type: "Feature", properties: { [field]: v },
        geometry: geometry === "Point" ? { type: "Point", coordinates: [-89.5, -0.9] }
          : geometry === "LineString" ? { type: "LineString", coordinates: [[-89.5, -0.9], [-89.4, -0.8]] }
          : { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      })),
    },
  };
}

test("a style without extras draws as before", () => {
  const poly = buildSymbolizer(layer("Polygon", ["a"], {})).symbolFor({ tipo: "a" });
  assert.equal(poly.color, "#3f7c5f");
  assert.equal(poly.strokeColor, "#333333");
  assert.equal(poly.strokeWidth, 1);
  assert.ok(Math.abs(poly.fillOpacity - 0.8 * 0.78) < 1e-9);
  const line = buildSymbolizer(layer("LineString", ["a"], { strokeWidth: 1 })).symbolFor({});
  assert.equal(line.strokeWidth, 2.5);
  const point = buildSymbolizer(layer("Point", ["a"], { size: 6 })).symbolFor({});
  assert.equal(point.size, 12);
  assert.equal(point.strokeColor, "#ffffff");
});

test("palette classes follow first appearance, the same order the map colors them", () => {
  const sym = buildSymbolizer(layer("LineString", ["Secundaria", "Local", "Local", "Principal", "Local"], { mode: "category", colorBy: "tipo", palette: "viridis" }));
  assert.deepEqual(sym.classes.map((c) => [c.key, c.count]), [["Secundaria", 1], ["Local", 3], ["Principal", 1]]);
  assert.equal(sym.symbolFor({ tipo: "Local" }).color, COLOR_RAMPS.viridis[1]);
  assert.equal(sym.classes[1].symbol.color, COLOR_RAMPS.viridis[1]);
});

test("explicit categories set color, outline, width, label; other values fall back", () => {
  const sym = buildSymbolizer(layer("Polygon", ["Agrícola", "Pecuario", "Otro", "Agrícola"], {
    mode: "category", colorBy: "tipo", opacity: 1,
    categories: [
      { value: "Pecuario", color: "#e3c07a", strokeColor: "#a07a2e", fillOpacity: 0.47, label: "Ganadero" },
      { value: "Agrícola", color: "#9bbf63", strokeColor: "#5f7f2e", fillOpacity: 0.47 },
    ],
  }));
  assert.deepEqual(sym.classes.map((c) => [c.label, c.count, Boolean(c.other)]), [["Ganadero", 1, false], ["Agrícola", 2, false], ["Otros valores", 1, true]]);
  const agr = sym.symbolFor({ tipo: "Agrícola" });
  assert.equal(agr.color, "#9bbf63");
  assert.equal(agr.strokeColor, "#5f7f2e");
  assert.equal(agr.fillOpacity, 0.47);
  assert.equal(sym.symbolFor({ tipo: "Otro" }).color, "#b0b0b0");
});

test("numeric values match categories by their text", () => {
  const sym = buildSymbolizer(layer("LineString", [1, 2, 3], {
    mode: "category", colorBy: "orden", opacity: 1,
    categories: [{ value: "1", color: "#008cd2", strokeWidth: 1 }, { value: "3", color: "#008cd2", strokeWidth: 3 }],
  }, "orden"));
  assert.equal(sym.symbolFor({ orden: 3 }).strokeWidth, 3);
  assert.equal(sym.symbolFor({ orden: 2 }).color, "#b0b0b0");
});

test("layer opacity fades explicit fills", () => {
  const sym = buildSymbolizer(layer("Polygon", ["a"], { mode: "category", colorBy: "tipo", opacity: 0.5, categories: [{ value: "a", color: "#ffffff", fillOpacity: 0.4 }] }));
  assert.equal(sym.symbolFor({ tipo: "a" }).fillOpacity, 0.2);
});

test("malformed extras are dropped when drawing and rejected on import", () => {
  const style = { ...base, symbol: { strokeColor: "red; x", dash: "4 2", marker: "star" }, categories: [{ value: "a", color: "<b>" }] } as unknown as LayerStyle;
  const extras = styleExtras(style);
  assert.deepEqual(extras.symbol, { dash: "4 2" });
  assert.deepEqual(extras.categories, [{ value: "a" }]);
  assert.throws(() => parseStyleExtras(style as unknown as Record<string, unknown>, "la capa 1"), /no es válido/);
  assert.throws(() => parseStyleExtras({ symbol: { evil: 1 } }, "la capa 1"), /campos no permitidos/);
});

test("labels: defaults keep the old look; categories can opt out", () => {
  assert.deepEqual(resolveLabelStyle(base), { color: "#1a1a1a", haloColor: "#ffffff", haloWidth: 3, size: 10.5, bold: true, minZoom: null });
  const sym = buildSymbolizer(layer("LineString", ["Índice", "Intermedia"], {
    mode: "category", colorBy: "tipo", categories: [{ value: "Índice", color: "#965523" }, { value: "Intermedia", color: "#be7d46", noLabel: true }],
  }));
  assert.equal(sym.symbolFor({ tipo: "Índice" }).labeled, true);
  assert.equal(sym.symbolFor({ tipo: "Intermedia" }).labeled, false);
});

test("label anchors: centroid of the largest polygon, middle of the longest line", () => {
  const anchor = labelAnchor({ type: "MultiPolygon", coordinates: [
    [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    [[[10, 10], [14, 10], [14, 14], [10, 14], [10, 10]]],
  ] });
  assert.deepEqual(anchor, [12, 12]);
  assert.deepEqual(labelAnchor({ type: "LineString", coordinates: [[0, 0], [1, 1], [2, 2]] }), [1, 1]);
  assert.equal(labelAnchor(null), null);
});

test("markers: triangle with a backdrop circle; values are numbers and hex colors only", () => {
  const sym = buildSymbolizer(layer("Point", ["1"], {
    mode: "category", colorBy: "tipo", opacity: 1,
    categories: [{ value: "1", color: "#f28c28", marker: "triangle", size: 13, strokeColor: "#ffffff", strokeWidth: 2, haloColor: "#ffffff", haloOpacity: 0.67, haloSize: 21 }],
  })).symbolFor({ tipo: "1" });
  const { svg, box } = markerSvg(sym);
  assert.equal(box, 21);
  assert.match(svg, /<circle cx="10.5" cy="10.5" r="10.5" fill="#ffffff" fill-opacity="0.67"\/>/);
  assert.match(svg, /<polygon points="[\d., ]+" fill="#f28c28"/);
});

test("export legend uses the same classes and symbols", () => {
  const l = layer("Polygon", ["b", "a", "b"], { mode: "category", colorBy: "tipo", categories: [{ value: "a", color: "#111111", label: "Clase A" }, { value: "b", color: "#222222" }] });
  const legend = deriveLegend([l], []);
  assert.deepEqual(legend.map((i) => [i.label, i.fillColor, i.detail]), [["Capa · Clase A", "#111111", "1"], ["Capa · b", "#222222", "2"]]);
  assert.equal(legend[0].symbolSpec?.color, "#111111");
});

test("workspace documents keep the extras", () => {
  const l = layer("LineString", ["Vía primaria"], {
    mode: "category", colorBy: "tipo",
    symbol: { dash: "4 2" },
    categories: [{ value: "Vía primaria", color: "#ef5b3b", strokeWidth: 5, casingColor: "#8f2c18", casingWidth: 7 }],
    labelStyle: { color: "#7a0c1c", minZoom: 14 },
  });
  l.id = "vector:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
  l.workspaceSource = { mapId: "11111111-1111-4111-8111-111111111111", layerId: "22222222-2222-4222-8222-222222222222" };
  const doc = buildWorkspaceDocument({ center: [0, 0], zoom: 10, basemap: "light", vectorLayers: [l], rasterLayers: [] });
  const parsed = parseWorkspaceDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(doc)));
  const entry = parsed.layers[0];
  const style = entry.kind === "vector" ? entry.presentation.style : null;
  assert.deepEqual(style?.categories, l.style.categories);
  assert.deepEqual(style?.symbol, { dash: "4 2" });
  assert.deepEqual(style?.labelStyle, { color: "#7a0c1c", minZoom: 14 });
});
