import assert from "node:assert/strict";
import test from "node:test";
import type { GisLayer, LayerStyle, RasterLayer } from "../components/geo/gis/types";
import {
  buildWorkspaceDocument,
  parseWorkspaceDocument,
  WORKSPACE_SCHEMA,
  WORKSPACE_VERSION,
} from "../components/geo/gis/workspace";

const MAP_ID = "11111111-1111-4111-8111-111111111111";
const VECTOR_ID = "22222222-2222-4222-8222-222222222222";
const RASTER_ID = "33333333-3333-4333-8333-333333333333";

const style: LayerStyle = {
  mode: "single",
  color: "#3f7c5f",
  palette: "categorical",
  ramp: "earth",
  classification: "quantile",
  classes: 5,
  colorBy: null,
  opacity: 0.8,
  strokeWidth: 1,
  size: 6,
  labels: false,
  labelField: null,
};

function vectorLayer(): GisLayer {
  return {
    id: `vector:${MAP_ID}:${VECTOR_ID}`,
    name: "Cobertura",
    geometry: "Polygon",
    geojson: { type: "FeatureCollection", features: [] },
    visible: true,
    loadedAt: 1,
    style,
    zIndex: 4,
    persisted: false,
    workspaceSource: { mapId: MAP_ID, layerId: VECTOR_ID, mapTitle: "Mapa base" },
  };
}

function rasterLayer(): RasterLayer {
  return {
    id: `raster:${MAP_ID}:${RASTER_ID}`,
    name: "Ortofoto",
    status: "processed",
    opacity: 0.65,
    visible: false,
    zIndex: 2,
    bbox: [-91, -1, -90, 0],
    tileUrl: "/ignored/{z}/{x}/{y}.png",
    workspaceSource: { mapId: MAP_ID, layerId: RASTER_ID, mapTitle: "Mapa base" },
  };
}

test("serializa únicamente referencias y presentación del Workspace", () => {
  const document = buildWorkspaceDocument({
    center: [-0.5, -90.5],
    zoom: 9,
    basemap: "satellite",
    vectorLayers: [vectorLayer()],
    rasterLayers: [rasterLayer()],
    exportedAt: "2026-08-14T12:00:00.000Z",
  });

  assert.equal(document.schema, WORKSPACE_SCHEMA);
  assert.equal(document.version, WORKSPACE_VERSION);
  assert.equal(document.layers.length, 2);
  assert.equal(JSON.stringify(document).includes("FeatureCollection"), false);
  assert.equal(JSON.stringify(document).includes("tileUrl"), false);
  assert.deepEqual(parseWorkspaceDocument(document), document);
});

test("rechaza versiones incompatibles y referencias duplicadas", () => {
  const document = buildWorkspaceDocument({
    center: [0, 0], zoom: 7, basemap: "light",
    vectorLayers: [vectorLayer()], rasterLayers: [],
    exportedAt: "2026-08-14T12:00:00.000Z",
  });
  assert.throws(() => parseWorkspaceDocument({ ...document, version: 99 }), /no es compatible/);
  assert.throws(() => parseWorkspaceDocument({ ...document, layers: [document.layers[0], document.layers[0]] }), /duplicada/);
});

test("migra Workspace v1 a v2 sin inventar visualizaciones", () => {
  const document = buildWorkspaceDocument({
    center: [0, 0], zoom: 7, basemap: "light",
    vectorLayers: [vectorLayer()], rasterLayers: [],
    exportedAt: "2026-08-14T12:00:00.000Z",
  });
  const legacy = structuredClone(document) as any;
  legacy.version = 1;
  delete legacy.layers[0].presentation.visualizations;
  const parsed = parseWorkspaceDocument(legacy);
  assert.equal(parsed.version, WORKSPACE_VERSION);
  assert.deepEqual((parsed.layers[0] as any).presentation.visualizations, []);
});

test("conserva recetas de visualización sin serializar datos derivados", () => {
  const layer = vectorLayer();
  const visualizationId = "44444444-4444-4444-8444-444444444444";
  const document = buildWorkspaceDocument({
    center: [0, 0], zoom: 7, basemap: "light", vectorLayers: [layer], rasterLayers: [],
    visualizationsByLayer: {
      [layer.id]: [{
        id: visualizationId, mapId: MAP_ID, layerId: layer.id, type: "sankey", title: "Flujo", position: 0, version: 1,
        bindings: [{ role: "level", field: "origen" }, { role: "level", field: "destino" }], options: {},
      }],
    },
    exportedAt: "2026-08-14T12:00:00.000Z",
  });
  const parsed = parseWorkspaceDocument(document);
  const vector = parsed.layers[0];
  assert.equal(vector.kind, "vector");
  if (vector.kind === "vector") assert.equal(vector.presentation.visualizations[0].id, visualizationId);
  assert.equal(JSON.stringify(document).includes("nodes"), false);
  assert.equal(JSON.stringify(document).includes("links"), false);
});

test("rechaza URLs y campos no permitidos en una referencia importada", () => {
  const document = buildWorkspaceDocument({
    center: [0, 0], zoom: 7, basemap: "light",
    vectorLayers: [vectorLayer()], rasterLayers: [],
    exportedAt: "2026-08-14T12:00:00.000Z",
  });
  const tampered = structuredClone(document) as any;
  tampered.layers[0].source.url = "https://attacker.invalid/data.json";
  assert.throws(() => parseWorkspaceDocument(tampered), /campos no permitidos/);
});
