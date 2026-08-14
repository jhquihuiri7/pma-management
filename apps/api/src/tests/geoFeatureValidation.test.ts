import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import type { GeoLayerAttributeSchema } from "@pma/types/geo";
import {
  assertValidAttributeSchema,
  inferAttributeSchema,
  validateAndBuildFeature,
} from "../modules/geo/featureValidation.js";

const collection: FeatureCollection = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    id: "e59f0910-c470-4c35-9dd7-133f967f9f60",
    geometry: { type: "Point", coordinates: [-90.3, -0.7] },
    properties: { CODE: "GAL2026_001", DATE: "2026-08-01", COUNT: 2 },
  }],
};

test("infers a conservative schema from every feature", () => {
  const schema = inferAttributeSchema(collection);
  assert.deepEqual(schema.fields.map((field) => [field.key, field.type]), [
    ["CODE", "string"], ["DATE", "date"], ["COUNT", "integer"],
  ]);
  assert.equal(schema.fields.every((field) => field.unique === false), true);
});

test("builds a point feature, normalizes values and derives coordinates", () => {
  const schema = pointSchema();
  const feature = validateAndBuildFeature({
    featureId: "f4085549-aeee-4790-b667-c3b3752a42c4",
    properties: { CODE: "GAL2026_002", DATE: "2026-08-14", COUNT: "3" },
    geometry: { type: "Point", coordinates: [-90.4, -0.8] },
    geometryType: "Point",
    schema,
    existingFeatures: collection.features,
  });
  assert.equal(feature.properties?.COUNT, 3);
  assert.equal(feature.properties?.LATITUDE, -0.8);
  assert.equal(feature.properties?.YEAR, 2026);
});

test("rejects duplicate values, unknown fields and invalid geometry", () => {
  const schema = pointSchema();
  assert.throws(() => validateAndBuildFeature({
    featureId: crypto.randomUUID(),
    properties: { CODE: "GAL2026_001", DATE: "2026-08-14", COUNT: 1 },
    geometry: { type: "Point", coordinates: [-90.4, -0.8] },
    geometryType: "Point",
    schema,
    existingFeatures: collection.features,
  }), /único/);
  assert.throws(() => validateAndBuildFeature({
    featureId: crypto.randomUUID(),
    properties: { CODE: "GAL2026_002", DATE: "2026-08-14", COUNT: 1, EXTRA: "x" },
    geometry: { type: "Point", coordinates: [-90.4, -0.8] },
    geometryType: "Point",
    schema,
    existingFeatures: collection.features,
  }), /no pertenece/);
  assert.throws(() => validateAndBuildFeature({
    featureId: crypto.randomUUID(),
    properties: { CODE: "GAL2026_002", DATE: "2026-08-14", COUNT: 1 },
    geometry: { type: "Point", coordinates: [-190, -0.8] },
    geometryType: "Point",
    schema,
    existingFeatures: collection.features,
  }), /fuera de EPSG/);
});

test("rejects a self-intersecting polygon", () => {
  assert.throws(() => validateAndBuildFeature({
    featureId: crypto.randomUUID(),
    properties: {},
    geometry: { type: "Polygon", coordinates: [[[-90, -1], [-89, 0], [-90, 0], [-89, -1], [-90, -1]]] },
    geometryType: "Polygon",
    schema: { version: 1, fields: [], geometry: { maxVertices: 100 } },
    existingFeatures: [],
  }), /cruza consigo mismo/);
});

function pointSchema(): GeoLayerAttributeSchema {
  return assertValidAttributeSchema({
    version: 1,
    geometry: { maxVertices: 10, extent: [-92, -2, -89, 1] },
    fields: [
      { key: "CODE", label: "Código", type: "string", required: true, unique: true, maxLength: 30 },
      { key: "DATE", label: "Fecha", type: "date", required: true },
      { key: "COUNT", label: "Cantidad", type: "integer", required: true, min: 0 },
      { key: "LATITUDE", label: "Latitud", type: "number", required: true, readOnly: true, derived: { kind: "latitude" } },
      { key: "YEAR", label: "Año", type: "integer", required: true, readOnly: true, derived: { kind: "yearFromDate", sourceField: "DATE" } },
    ],
  });
}
