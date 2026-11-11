import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection } from "geojson";
import {
  CAPA_BARRIOS_SANTA_CRUZ,
  MOTIVO_ERROR,
  MOTIVO_SIN_ACCESO,
  cargarBarrios,
  claveBarrio,
  colorLimpieza,
  gradienteLimpieza,
  nombreBarrio,
  nombresBarrios,
  revisionVigente,
  type FuenteCapasGeoportal,
  type ManifiestoCapa,
} from "../lib/protocolo-limpieza/barrios";

const { mapId, layerId } = CAPA_BARRIOS_SANTA_CRUZ;

const cuadrado = [[[-90.31, -0.75], [-90.3, -0.75], [-90.3, -0.74], [-90.31, -0.74], [-90.31, -0.75]]];

const coleccion: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { Nombre_Bar: "PUNTA ESTRADA" }, geometry: { type: "Polygon", coordinates: cuadrado } },
    { type: "Feature", properties: { Nombre_Bar: "LA FORTUNA" }, geometry: { type: "MultiPolygon", coordinates: [cuadrado] } },
    { type: "Feature", properties: { Nombre_Bar: "suelto" }, geometry: { type: "Point", coordinates: [-90.3, -0.74] } },
    { type: "Feature", properties: { Nombre_Bar: "sin geometría" }, geometry: null as never },
  ],
};

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function fuente(opciones: {
  manifiestos?: ManifiestoCapa[] | (() => Promise<ManifiestoCapa[]>);
  datos?: unknown | (() => Promise<unknown>);
}): FuenteCapasGeoportal & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    async fetchLayers(id) {
      llamadas.push(`layers ${id}`);
      const m = opciones.manifiestos ?? [{ id: layerId, dataRevision: 1 }];
      return typeof m === "function" ? m() : m;
    },
    async fetchLayerData(id, capa, revision) {
      llamadas.push(`data ${id} ${capa} ${revision}`);
      const d = "datos" in opciones ? opciones.datos : coleccion;
      return (typeof d === "function" ? await (d as () => Promise<unknown>)() : d) as FeatureCollection;
    },
  };
}

test("reads the layer's current revision through the Geoportal and keeps only its areas", async () => {
  const origen = fuente({ manifiestos: [{ id: "otra", dataRevision: 9 }, { id: layerId, dataRevision: 3 }] });
  const resultado = await cargarBarrios(origen);

  assert.equal(resultado.estado, "lista");
  if (resultado.estado !== "lista") return;
  assert.equal(resultado.revision, 3);
  assert.deepEqual(origen.llamadas, [`layers ${mapId}`, `data ${mapId} ${layerId} 3`]);
  assert.deepEqual(
    resultado.datos.features.map((f) => f.properties?.Nombre_Bar),
    ["PUNTA ESTRADA", "LA FORTUNA"],
  );
});

test("a layer without a recorded revision is read as revision 1", () => {
  assert.equal(revisionVigente({ id: layerId }), 1);
  assert.equal(revisionVigente({ id: layerId, dataRevision: null }), 1);
  assert.equal(revisionVigente({ id: layerId, dataRevision: 0 }), 1);
  assert.equal(revisionVigente({ id: layerId, dataRevision: 2.5 }), 1);
  assert.equal(revisionVigente({ id: layerId, dataRevision: 4 }), 4);
});

test("a map the reader may not see (the geo API answers 404) leaves the map without neighbourhoods", async () => {
  for (const status of [401, 403, 404]) {
    const resultado = await cargarBarrios(fuente({ manifiestos: () => Promise.reject(httpError(status)) }));
    assert.deepEqual(resultado, { estado: "no-disponible", motivo: MOTIVO_SIN_ACCESO }, `status ${status}`);
  }
});

test("a layer deleted from the map is reported as unavailable, not as an error", async () => {
  const origen = fuente({ manifiestos: [{ id: "otra-capa", dataRevision: 1 }] });
  const resultado = await cargarBarrios(origen);
  assert.deepEqual(resultado, { estado: "no-disponible", motivo: MOTIVO_SIN_ACCESO });
  assert.deepEqual(origen.llamadas, [`layers ${mapId}`], "no data request for a layer that is not there");
});

test("a server or storage failure becomes an error state instead of throwing", async () => {
  const caido = await cargarBarrios(fuente({ datos: () => Promise.reject(httpError(500)) }));
  assert.deepEqual(caido, { estado: "error", motivo: MOTIVO_ERROR });

  const red = await cargarBarrios(fuente({ manifiestos: () => Promise.reject(new TypeError("Failed to fetch")) }));
  assert.deepEqual(red, { estado: "error", motivo: MOTIVO_ERROR });
});

test("a response that is not a FeatureCollection is an error", async () => {
  for (const datos of [null, {}, { type: "Feature" }, { type: "FeatureCollection", features: "x" }]) {
    const resultado = await cargarBarrios(fuente({ datos }));
    assert.deepEqual(resultado, { estado: "error", motivo: MOTIVO_ERROR });
  }
});

test("the tooltip shows the name exactly as the Geoportal stores it", () => {
  assert.equal(nombreBarrio({ Nombre_Bar: "CENTRAL (Puerto Ayora)" }), "CENTRAL (Puerto Ayora)");
  assert.equal(nombreBarrio({ Nombre_Bar: "  LAS NINFAS " }), "LAS NINFAS");
  assert.equal(nombreBarrio({ Nombre_Bar: "   " }), null);
  assert.equal(nombreBarrio({ Nombre_Bar: null }), null);
  assert.equal(nombreBarrio({ Id: 0 }), null);
  assert.equal(nombreBarrio(null), null);
  assert.equal(nombreBarrio({ NOMBRES: "Bellavista" }, "NOMBRES"), "Bellavista");
});

test("a reported neighbourhood finds its polygon whatever the case, accents or spacing", () => {
  assert.equal(claveBarrio("LAS ORQUIDEAS"), claveBarrio("Las Orquídeas"));
  assert.equal(claveBarrio("  Los   Túneles 1 "), claveBarrio("LOS TUNELES 1"));
  assert.equal(claveBarrio("CENTRAL (Puerto Ayora)"), "central (puerto ayora)");
  assert.notEqual(claveBarrio("LOS TUNELES 1"), claveBarrio("LOS TUNELES 2"));
});

test("the form's options are the layer's neighbourhoods, once each and in order", () => {
  const nombres = nombresBarrios({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { Nombre_Bar: "PUNTA ESTRADA" }, geometry: { type: "Polygon", coordinates: cuadrado } },
      { type: "Feature", properties: { Nombre_Bar: "LA FORTUNA" }, geometry: { type: "Polygon", coordinates: cuadrado } },
      // The same neighbourhood split in two polygons is offered once.
      { type: "Feature", properties: { Nombre_Bar: "La Fortuna" }, geometry: { type: "Polygon", coordinates: cuadrado } },
      { type: "Feature", properties: { Nombre_Bar: "  " }, geometry: { type: "Polygon", coordinates: cuadrado } },
    ],
  });
  assert.deepEqual(nombres, ["LA FORTUNA", "PUNTA ESTRADA"]);
});

test("cleaning colours a neighbourhood from red at 0 % to lime at 100 %, through orange and yellow", () => {
  assert.deepEqual(
    [0, 25, 50, 75, 100].map((p) => colorLimpieza(p).fillColor),
    // Halfway is amber, not the muddy brown of a straight RGB mix of red and lime.
    ["rgb(220, 38, 38)", "rgb(218, 97, 32)", "rgb(213, 158, 29)", "rgb(200, 209, 25)", "rgb(132, 204, 22)"],
  );
  // The same opacity all along: a clean neighbourhood shows as clearly as a dirty one.
  for (const p of [0, 33, 100]) assert.equal(colorLimpieza(p).fillOpacity, 0.6);
  // Out of range values are held to the scale.
  assert.deepEqual(colorLimpieza(-20), colorLimpieza(0));
  assert.deepEqual(colorLimpieza(140), colorLimpieza(100));
  assert.deepEqual(colorLimpieza(Number.NaN), colorLimpieza(0));
});

test("the legend gradient is sampled from the same scale as the map", () => {
  assert.equal(
    gradienteLimpieza(2),
    "linear-gradient(90deg, rgba(220, 38, 38, 0.6) 0%, rgba(213, 158, 29, 0.6) 50%, rgba(132, 204, 22, 0.6) 100%)",
  );
});
