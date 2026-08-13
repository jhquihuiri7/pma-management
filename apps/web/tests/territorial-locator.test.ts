import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerritoryProjection,
  selectTerritory,
  territoryContainsPoint,
  territoryPath,
  type TerritoryFeature,
} from "../components/geo/export/territorial-geometry";

function square(code: string, name: string, west: number, south: number): TerritoryFeature {
  return {
    code,
    name,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [west, south],
        [west + 1, south],
        [west + 1, south + 1],
        [west, south + 1],
        [west, south],
      ]],
    },
  };
}

const westTerritory = square("01", "OESTE", -2, -1);
const eastTerritory = square("02", "ESTE", 0, -1);

test("identifica el territorio que contiene el centro del mapa", () => {
  const point = { longitude: 0.5, latitude: -0.5 };
  assert.equal(territoryContainsPoint(eastTerritory, point), true);
  assert.equal(territoryContainsPoint(westTerritory, point), false);
  assert.equal(
    selectTerritory([westTerritory, eastTerritory], point)?.code,
    "02",
  );
});

test("usa el límite más cercano cuando la vista está sobre el mar", () => {
  const selected = selectTerritory(
    [westTerritory, eastTerritory],
    { longitude: -0.25, latitude: -0.5 },
  );
  assert.equal(selected?.code, "02");
});

test("la extensión visible aporta muestras para resolver el territorio", () => {
  const selected = selectTerritory(
    [westTerritory, eastTerritory],
    { longitude: -0.5, latitude: -0.5 },
    { west: -0.1, east: 0.8, south: -0.8, north: -0.2 },
  );
  assert.equal(selected?.code, "02");
});

test("genera una ruta SVG finita y ajustada al lienzo", () => {
  const projection = createTerritoryProjection(
    [westTerritory, eastTerritory],
    240,
    130,
  );
  assert.ok(projection);
  const path = territoryPath(eastTerritory, projection.project);
  assert.match(path, /^M/);
  assert.match(path, /Z$/);
  assert.equal(path.includes("NaN"), false);
  assert.equal(path.includes("Infinity"), false);
});
