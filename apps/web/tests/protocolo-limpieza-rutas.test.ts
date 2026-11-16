import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureCollection, LineString, Point } from "geojson";
import { destination, points } from "../lib/protocolo-limpieza/acumulacion";
import { DISTANCIA_ICONOS, guiaIcono, iconosApartados } from "../lib/protocolo-limpieza/acomodoIconos";
import { cajaGirada, colocarEtiquetas, posicionesAlrededor, puntoEnLinea } from "../lib/protocolo-limpieza/colocarEtiquetas";
import {
  CAPAS_RUTAS,
  cargarRutas,
  colorPunto,
  escalaMapa,
  ESTILO_TRAMOS,
  lineaDeRuta,
  MOTIVO_RUTAS_ERROR,
  MOTIVO_RUTAS_SIN_ACCESO,
  nombresDelPunto,
  simboloTramo,
  ubicacionesDePuntos,
} from "../lib/protocolo-limpieza/rutasGeoportal";

// The routes of the maps come from the Geoportal's map "Gestión de residuos y desechos de Santa
// Cruz - Rutas" (capas_residuos_scx_shapefile.zip), drawn with the zip's QGIS style.

const punto = (Nombre: string, lon: number, lat: number) => ({
  type: "Feature" as const, properties: { Nombre }, geometry: { type: "Point" as const, coordinates: [lon, lat] },
});
// The seven points of puntos_rutas_scx, as the layer names them.
const PUNTOS: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [
    punto("Acopio temporal", -90.32006, -0.73965),
    punto("Patio contenedores SCX", -90.32225, -0.74334),
    punto("Relleno sanitario SCX", -90.35527, -0.5839),
    punto("Muelle de Itabaca", -90.28034, -0.48762),
    punto("Patio contenedores GYE", -79.8851, -2.23895),
    punto("Sitio de gestión de residuos", -80.81137, -2.23716),
    punto("Puerto GYE", -79.88623, -2.22736),
  ],
};
const tramo = (ruta: string, grupo: string, modo: string, coordinates: number[][]) => ({
  type: "Feature" as const, properties: { ruta, grupo, modo }, geometry: { type: "LineString" as const, coordinates },
});
const TRAMOS: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [
    tramo("R3", "Flujo principal", "Vial", [[-90.32225, -0.74334], [-90.28034, -0.48762]]),
    tramo("R4", "Flujo principal", "Marítimo y fluvial", [[-90.28034, -0.48762], [-85, -1.5], [-79.88623, -2.22736]]),
    tramo("R2.1", "Ramal al relleno", "Vial", [[-90.32006, -0.73965], [-90.35527, -0.5839]]),
  ],
};

test("each map point takes its place in the layer by the name the protocol gives it", () => {
  const u = ubicacionesDePuntos(PUNTOS, [...points.map((p) => p.id), destination.id]);
  assert.deepEqual(Object.fromEntries(u), {
    R2: [-0.73965, -90.32006],
    "R2.1": [-0.5839, -90.35527],
    R3: [-0.74334, -90.32225],
    R4: [-0.48762, -90.28034],
    R5: [-2.22736, -79.88623],
    // R6 starts at "Patio GYE", the "Patio contenedores GYE" where R5 ends.
    R6: [-2.23895, -79.8851],
    gestion: [-2.23716, -80.81137],
  });
  // The urban zone of R1 is not in the layer: it keeps its own place.
  assert.equal(u.has("R1"), false);
  assert.deepEqual(nombresDelPunto("R4"), ["Muelle de Itabaca", "Muelle de Itabaca"]);
  assert.deepEqual(nombresDelPunto("R6"), ["Patio GYE", "Patio contenedores GYE"]);
  assert.deepEqual(nombresDelPunto("otro"), []);
});

test("names match whatever the case or accents", () => {
  const u = ubicacionesDePuntos({ type: "FeatureCollection", features: [punto("SITIO DE GESTION DE RESIDUOS", -80.8, -2.2)] }, ["gestion"]);
  assert.deepEqual(u.get("gestion"), [-2.2, -80.8]);
});

test("the segments take the rules of tramos_residuos.qml, in its order", () => {
  assert.equal(simboloTramo({ grupo: "Flujo principal", modo: "Vial" }), "principal");
  assert.equal(simboloTramo({ grupo: "Flujo principal", modo: "Marítimo y fluvial" }), "maritimo");
  assert.equal(simboloTramo({ grupo: "Ramal al relleno", modo: "Vial" }), "ramal");
  assert.equal(simboloTramo({ grupo: "Otro", modo: "Aéreo" }), null, "no rule: not drawn, as in QGIS");
  // Millimetres at 96 dpi: 1 mm lines, 4-1.4-0.9-1.4 mm dashes; the sea one 1.1 mm, dotted.
  assert.deepEqual(ESTILO_TRAMOS.principal, { leyenda: "Ruta principal hacia Guayaquil", color: "#17a893", ancho: 3.78, guiones: [15.12, 5.29, 3.4, 5.29] });
  assert.deepEqual(ESTILO_TRAMOS.maritimo.guiones, [4.16, 7.18]);
  assert.equal(ESTILO_TRAMOS.ramal.color, "#f59e0b");
  assert.equal(colorPunto("Relleno sanitario SCX"), "#f59e0b");
  assert.equal(colorPunto("PUERTO GYE"), "#6657d9");
  assert.equal(colorPunto("Muelle de Itabaca"), "#17a893");
});

test("the R4 line, as [lat, lon], carries the ship from Itabaca to the port of Guayaquil", () => {
  const r4 = lineaDeRuta(TRAMOS, "R4")!;
  assert.deepEqual(r4[0], [-0.48762, -90.28034]);
  assert.deepEqual(r4[r4.length - 1], [-2.22736, -79.88623]);
  assert.equal(lineaDeRuta(TRAMOS, "R1"), null);
});

test("the neighbourhood labels show from 1:60.000 inwards", () => {
  assert.ok(escalaMapa(-0.74, 13) > 60000);
  assert.ok(escalaMapa(-0.74, 13.5) <= 60000);
});

test("the routes are read through the Geoportal and never throw", async () => {
  const pedidas: string[] = [];
  const fuente = {
    fetchLayers: async (mapId: string) => {
      assert.equal(mapId, CAPAS_RUTAS.mapId);
      return [{ id: CAPAS_RUTAS.tramos, dataRevision: 2 }, { id: CAPAS_RUTAS.puntos, dataRevision: null }];
    },
    fetchLayerData: async (_mapId: string, layerId: string, revision?: number) => {
      pedidas.push(`${layerId}@${revision}`);
      const extra = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } };
      return (layerId === CAPAS_RUTAS.tramos ? { ...TRAMOS, features: [...TRAMOS.features, extra] } : PUNTOS) as FeatureCollection;
    },
  };
  const lista = await cargarRutas(fuente);
  assert.equal(lista.estado, "lista");
  assert.deepEqual(pedidas.sort(), [`${CAPAS_RUTAS.puntos}@1`, `${CAPAS_RUTAS.tramos}@2`].sort());
  if (lista.estado === "lista") {
    assert.equal(lista.datos.tramos.features.length, 3, "only lines are routes");
    assert.equal(lista.datos.puntos.features.length, 7);
  }

  const sinCapa = await cargarRutas({ ...fuente, fetchLayers: async () => [{ id: CAPAS_RUTAS.tramos }] });
  assert.deepEqual(sinCapa, { estado: "no-disponible", motivo: MOTIVO_RUTAS_SIN_ACCESO });
  const prohibido = await cargarRutas({ ...fuente, fetchLayers: async () => { throw Object.assign(new Error("x"), { status: 404 }); } });
  assert.deepEqual(prohibido, { estado: "no-disponible", motivo: MOTIVO_RUTAS_SIN_ACCESO });
  const caido = await cargarRutas({ ...fuente, fetchLayerData: async () => { throw new Error("red"); } });
  assert.deepEqual(caido, { estado: "error", motivo: MOTIVO_RUTAS_ERROR });
});

test("a label takes the first free position of the .qml (TR, TL, BR, BL, R, L) or is hidden", () => {
  const vista = { x: 0, y: 0, w: 400, h: 300 };
  const alrededor = posicionesAlrededor(200, 150, 60, 14, 9, 6);
  assert.equal(alrededor.length, 6);
  // Top right first: its bottom-left corner up and to the right of the symbol.
  assert.ok(alrededor[0].x > 200 && alrededor[0].y + alrededor[0].h < 150);
  // An icon over the top right sends it to the top left.
  const icono = { x: 205, y: 100, w: 44, h: 44 };
  assert.equal(colocarEtiquetas([{ id: "a", posiciones: alrededor }], [icono], vista).get("a"), 1);
  // The first label wins; the second, with the same single place, is hidden.
  const unica = [{ x: 10, y: 10, w: 50, h: 12 }];
  const elegidas = colocarEtiquetas([{ id: "a", posiciones: unica }, { id: "b", posiciones: unica }], [], vista);
  assert.deepEqual(Array.from(elegidas.keys()), ["a"]);
  // Outside the view: hidden.
  assert.equal(colocarEtiquetas([{ id: "c", posiciones: [{ x: 390, y: 10, w: 50, h: 12 }] }], [], vista).size, 0);
});

test("a route label sits along the line, turned to stay upright", () => {
  const medio = puntoEnLinea([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 0.5)!;
  assert.deepEqual([medio.x, medio.y, medio.angulo], [100, 0, 0]);
  const hacia = puntoEnLinea([{ x: 100, y: 0 }, { x: 0, y: 0 }], 0.25)!;
  assert.deepEqual([hacia.x, hacia.angulo], [75, 0], "a line drawn leftwards is not upside down");
  const vertical = cajaGirada(50, 50, 40, 10, 90);
  assert.deepEqual([Math.round(vertical.w), Math.round(vertical.h)], [10, 40]);
  assert.equal(puntoEnLinea([{ x: 1, y: 1 }], 0.5), null);
});

test("an icon sits on its point while it has room; those that would touch another move aside", () => {
  // Zoomed out: R1, R2 and R3 a few pixels apart in Puerto Ayora, R4 far away.
  const lejos = iconosApartados([{ id: "R1", x: 300, y: 400 }, { id: "R2", x: 290, y: 392 }, { id: "R3", x: 288, y: 404 }, { id: "R4", x: 320, y: 120 }]);
  assert.deepEqual(Array.from(lejos).sort(), ["R1", "R2", "R3"]);
  // Zoomed in: R1 now has room, R2 and R3 still touch.
  const cerca = iconosApartados([{ id: "R1", x: 600, y: 500 }, { id: "R2", x: 420, y: 300 }, { id: "R3", x: 400, y: 340 }]);
  assert.deepEqual(Array.from(cerca).sort(), ["R2", "R3"]);
  assert.equal(iconosApartados([{ id: "a", x: 0, y: 0 }, { id: "b", x: DISTANCIA_ICONOS, y: 0 }]).size, 0, "just touching is room enough");
  // The leader runs from the icon back to the edge of the point's symbol.
  const guia = guiaIcono(30, 40, 9.45);
  assert.equal(Math.round(guia.largo * 100) / 100, 40.55);
  assert.equal(Math.round(guia.angulo), -127);
  assert.equal(guiaIcono(3, 4, 9.45).largo, 0);
});
