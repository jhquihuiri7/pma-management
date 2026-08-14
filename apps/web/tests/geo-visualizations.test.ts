import assert from "node:assert/strict";
import test from "node:test";
import type { Feature } from "geojson";
import type { GeoVisualizationDraft } from "@pma/types/geo";
import { inferSchema } from "../components/geo/gis/charts";
import { transformVisualization } from "../components/geo/gis/chart-transform";
import { validateVisualization } from "../components/geo/gis/chart-config";

const features: Feature[] = [
  { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { isla: "Santa Cruz", canton: "A", area: 10, activo: true } },
  { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: { isla: "Santa Cruz", canton: "B", area: 20, activo: false, fecha: "2026-01-01" } },
  { type: "Feature", geometry: { type: "Point", coordinates: [2, 2] }, properties: { isla: "Isabela", canton: "A", area: 5, activo: true, fecha: "2026-02-01" } },
];

test("el perfil usa la unión de propiedades y reconoce booleanos", () => {
  const schema = inferSchema(features);
  assert.equal(schema.find((column) => column.key === "fecha")?.nullCount, 1);
  assert.equal(schema.find((column) => column.key === "activo")?.type, "boolean");
  assert.equal(schema.find((column) => column.key === "area")?.type, "numeric");
});

test("agrupa una dimensión y suma una medida", () => {
  const draft: GeoVisualizationDraft = {
    type: "bar", title: "Área por isla", position: 0, version: 1,
    bindings: [
      { role: "dimension", field: "isla" },
      { role: "measure", field: "area", aggregation: "sum" },
    ],
    options: { sort: "desc", topN: 10 },
  };
  assert.deepEqual(validateVisualization(draft, inferSchema(features)), []);
  const data = transformVisualization(features, draft);
  assert.equal(data.kind, "category");
  if (data.kind === "category") assert.deepEqual(data.rows.map(({ label, value }) => ({ label, value })), [
    { label: "Santa Cruz", value: 30 }, { label: "Isabela", value: 5 },
  ]);
});

test("Sankey agrega cada transición y separa nodos por nivel", () => {
  const draft: GeoVisualizationDraft = {
    type: "sankey", title: "Flujo", position: 0, version: 1,
    bindings: [{ role: "level", field: "isla" }, { role: "level", field: "canton" }, { role: "weight", field: "area", aggregation: "sum" }],
    options: {},
  };
  const data = transformVisualization(features, draft);
  assert.equal(data.kind, "sankey");
  if (data.kind === "sankey") {
    assert.equal(data.nodes.length, 4);
    assert.equal(data.links.reduce((sum, link) => sum + link.value, 0), 35);
  }
});
