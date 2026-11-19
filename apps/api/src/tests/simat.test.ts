// SIMAT-GAL: parsers (with fixtures captured from the live sources on
// 2026-11-17), rolling rain windows and the rain risk scale (with the sea
// raising one level). Pure functions only: no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SimatCriterio, SimatEstacion, SimatNivelMar, SimatSerieLluvia } from "@pma/types";
import { parseTablaInocar } from "../modules/simat/conectores/inocar.js";
import { parseTablaIoc } from "../modules/simat/conectores/ioc.js";
import { parseMetar } from "../modules/simat/conectores/metar.js";
import { parseCsvFcd } from "../modules/simat/conectores/fcd.js";
import { instanteInamhi } from "../modules/simat/conectores/inamhiInventario.js";
import { construirSerie, type LecturaLluvia } from "../modules/simat/ventanas.js";
import { construirCriterio, evaluar, puertoCoincideIsla } from "../modules/simat/riesgo.js";
import { evaluarMarea, monitoreoPuerto } from "../modules/simat/marea.js";
import { fechaGalapagos, instanteGalapagos, islaDeCoordenada } from "../modules/simat/geografia.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "simat");
const leer = (nombre: string, encoding: BufferEncoding = "utf-8") => readFileSync(join(fixtures, nombre), encoding);

// ── Parsers ──────────────────────────────────────────────────────────────────

test("INOCAR: reads 3 days × 4 tides with date, time, height and phase", () => {
  const mareas = parseTablaInocar(leer("inocar-santa-cruz.html", "latin1"));
  assert.equal(mareas.length, 12);
  assert.deepEqual(mareas[0], { fecha: "2026-11-16", hora: "00:53", valor: 0.64, fase: "Bajamar" });
  assert.deepEqual(mareas[1], { fecha: "2026-11-16", hora: "06:45", valor: 1.39, fase: "Pleamar" });
  assert.equal(mareas[11].fecha, "2026-11-18");
});

test("IOC: reads the ras(m) column in UTC and drops readings after the clock", () => {
  const html = leer("ioc-santa-cruz.html");
  const todas = parseTablaIoc(html, new Date("2026-11-18T00:00:00Z"));
  assert.equal(todas.length, 6);
  assert.equal(todas[0].instante.toISOString(), "2026-11-17T03:06:00.000Z");
  assert.equal(todas[0].valor, 2.406);
  // Rows whose battery/switch cells are blank still count (same column count).
  assert.equal(todas[1].valor, 2.401);
  const antes = parseTablaIoc(html, new Date("2026-11-17T04:00:00Z"));
  assert.equal(antes.length, 3);
  assert.throws(() => parseTablaIoc("<table><tr><td>x</td></tr></table>", new Date()), /RAS/);
});

test("METAR: temperature, wind (kt → km/h), QNH and the day/time in UTC", () => {
  const ahora = new Date("2026-11-17T15:56:00Z");
  const l = parseMetar("SEST 171500Z 17008KT 9999 FEW016 BKN100 29/26 Q1010 RMK A2984", ahora)!;
  assert.equal(l.instante.toISOString(), "2026-11-17T15:00:00.000Z");
  assert.equal(l.tempC, 29);
  assert.equal(l.vientoDir, 170);
  assert.equal(l.vientoKmh, 14.8);
  assert.equal(l.presionHpa, 1010);
  // A report from the 31st read on the 1st belongs to the previous month.
  const rollover = parseMetar("SEST 312300Z VRB02KT M01/M03 Q1012", new Date("2026-11-01T00:30:00Z"))!;
  assert.equal(rollover.instante.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(rollover.vientoDir, null);
  assert.equal(rollover.tempC, -1);
});

test("FCD: daily precipitation, skipping blanks; schema change is an error", () => {
  const csv = [
    "observation_date,min_air_temp,max_air_temp,mean_air_temp,sea_temp,humidity,precipitation,sunshine_hours,clouds",
    "2026-06-01,21.0,31.7,26.3,26.3,93,0.00,5.7,5",
    "2026-06-02,21.5,31.1,26.2,26.5,93,1.40,0.7,6",
    "2026-06-03,21.7,31.3,26.1,26.3,95,,4.7,6",
  ].join("\n");
  const filas = parseCsvFcd(csv);
  assert.equal(filas.length, 2);
  assert.equal(filas[1].mm, 1.4);
  assert.equal(filas[1].fecha.toISOString(), "2026-06-02T00:00:00.000Z");
  assert.throws(() => parseCsvFcd("fecha,lluvia\n2026-06-01,1"), /esquema/);
});

test("INAMHI: a wall clock mislabeled -05:00 that lands in the future is read as UTC", () => {
  const ahora = Date.parse("2026-11-17T15:56:00Z");
  assert.equal(new Date(instanteInamhi("2026-11-17T15:00:00-05:00", ahora)).toISOString(), "2026-11-17T15:00:00.000Z");
  // A label that is plausible as written is kept as written.
  assert.equal(new Date(instanteInamhi("2026-11-17T09:00:00-05:00", ahora)).toISOString(), "2026-11-17T14:00:00.000Z");
});

test("Galápagos time and island classification", () => {
  assert.equal(instanteGalapagos("2026-11-17T09:36:02.000").toISOString(), "2026-11-17T15:36:02.000Z");
  assert.equal(fechaGalapagos(new Date("2026-11-18T05:00:00Z")), "2026-11-17");
  assert.equal(islaDeCoordenada(-0.489962, -90.2808), "Santa Cruz"); // IERSE Militar (Baltra side)
  assert.equal(islaDeCoordenada(-0.904058, -89.614308), "San Cristóbal");
  assert.equal(islaDeCoordenada(-0.961111, -90.95675), "Isabela");
  assert.equal(islaDeCoordenada(-1.266667, -90.483333), "Floreana");
});

// ── Rain windows ─────────────────────────────────────────────────────────────

function lecturas(fin: string, cada: number, valores: number[], fuente = "IERSE"): LecturaLluvia[] {
  const t = Date.parse(fin);
  return valores.map((valor, i) => ({
    instante: new Date(t - i * cada * 60_000),
    valor,
    calidad: "válido" as const,
    fuente,
  }));
}

test("windows add readings inside them and report mm/h", () => {
  // 12 readings every 5 min ending at 15:55: 1 mm each in the last 30 min.
  const serie = construirSerie("X", lecturas("2026-11-17T15:55:00Z", 5, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0]), 5);
  const v30 = serie.windows.find((w) => w.minutes === 30)!;
  assert.equal(v30.total, 6);
  assert.equal(v30.intensity, 12);
  const v60 = serie.windows.find((w) => w.minutes === 60)!;
  assert.equal(v60.total, 6);
  assert.equal(v60.intensity, 6);
  assert.equal(serie.latest?.time, "2026-11-17T15:55:00.000Z");
});

test("a window with gaps is incomplete instead of understating the rain", () => {
  // Only 7 of the 12 expected readings in the last hour.
  const serie = construirSerie("X", lecturas("2026-11-17T15:55:00Z", 5, [2, 2, 2, 2, 2, 2, 2]), 5);
  const v60 = serie.windows.find((w) => w.minutes === 60)!;
  assert.equal(v60.total, null);
  assert.equal(v60.reason, "Serie incompleta");
  assert.equal(serie.windows.find((w) => w.minutes === 30)!.total, 12);
});

test("mixed sources or an invalid reading void the window; coarse stations skip short windows", () => {
  const mezcla = [...lecturas("2026-11-17T15:55:00Z", 5, [1, 1, 1]), ...lecturas("2026-11-17T15:40:00Z", 5, [1, 1, 1], "OTRA")];
  assert.equal(construirSerie("X", mezcla, 5).windows.find((w) => w.minutes === 30)!.total, null);
  const invalida = lecturas("2026-11-17T15:55:00Z", 5, [1, 1, 1, 1, 1, 1]);
  invalida[2] = { ...invalida[2], calidad: "sospechoso" };
  assert.equal(construirSerie("X", invalida, 5).windows.find((w) => w.minutes === 30)!.total, null);
  const horaria = construirSerie("X", lecturas("2026-11-17T15:00:00Z", 60, [1]), 60);
  assert.equal(horaria.windows.find((w) => w.minutes === 30)!.reason, "Resolución insuficiente");
});

// ── Risk scale ───────────────────────────────────────────────────────────────

const ESTACION: SimatEstacion = {
  id: "IERSE-n_glps06", fuente: "IERSE", codigo: "n_glps06", nombre: "Militar", isla: "Santa Cruz",
  lat: -0.49, lon: -90.28, altitud: null, pasoMin: 5, propietario: "IERSE", estado: "Operativo",
  activa: true, variables: ["precipitacion"], ultimoDato: [], actualizadoEn: "2026-11-17T15:55:00Z",
};

const CRITERIO: SimatCriterio = {
  id: "c1", estacion: ESTACION.id, isla: "Santa Cruz", puerto: "Isla Santa Cruz", datum: "MLWS",
  sector: "Malecón", respaldo: "Estudio de drenaje", ventanaMin: 60, vigenciaMin: 60, desfaseMin: 30,
  lluvia: { vigilancia: 5, preparacion: 15, respuesta: 25 }, marM: 2, estadoValidacion: "validado",
  alertasPublicas: false, activo: true, actualizadoPor: "técnico", actualizadoEn: "2026-11-17T15:00:00Z",
};

function lluvia(intensidad: number, fin = "2026-11-17T15:55:00Z"): SimatSerieLluvia {
  return {
    estacion: ESTACION.id, paso: 5,
    windows: [{ minutes: 60, total: intensidad, intensity: intensidad, valid: 12, expected: 12, reason: "Completo" }],
    recent: [],
    latest: { time: fin, value: 1, quality: "válido", source: "IERSE" },
  };
}

function mar(valor: number, calidad = "validado", instante = "2026-11-17T15:50:00.000Z"): SimatNivelMar[] {
  return [{
    id: "m1", puerto: "Isla Santa Cruz", tipo: "Nivel observado", instante, horaPublicada: false,
    valor, unidad: "m", referencia: "MLWS", fase: null, calidad, fuente: "MANUAL",
  }];
}

const RELOJ = new Date("2026-11-17T16:00:00Z");

test("scale: rain thresholds give the level and a high sea raises it one step", () => {
  assert.equal(evaluar(CRITERIO, ESTACION, lluvia(2), mar(1), RELOJ).nivel, "Normal");
  assert.equal(evaluar(CRITERIO, ESTACION, lluvia(5), mar(1), RELOJ).nivel, "Vigilancia");
  assert.equal(evaluar(CRITERIO, ESTACION, lluvia(15), mar(1), RELOJ).nivel, "Preparación");
  assert.equal(evaluar(CRITERIO, ESTACION, lluvia(30), mar(1), RELOJ).nivel, "Respuesta");
  const subeMar = evaluar(CRITERIO, ESTACION, lluvia(2), mar(2.5), RELOJ);
  assert.equal(subeMar.nivel, "Vigilancia");
  assert.equal(subeMar.nivelLluvia, "Normal");
  assert.equal(subeMar.marAlto, true);
  assert.deepEqual(subeMar.motivos, []);
  // The sea cannot go past the top of the scale.
  assert.equal(evaluar(CRITERIO, ESTACION, lluvia(30), mar(2.5), RELOJ).nivel, "Respuesta");
  // Without a sea threshold the sea is ignored.
  const sinMar = evaluar({ ...CRITERIO, marM: null }, ESTACION, lluvia(16), [], RELOJ);
  assert.equal(sinMar.nivel, "Preparación");
  assert.equal(sinMar.marAlto, null);
  assert.deepEqual(sinMar.avisos, []);
});

test("scale: rain is required; missing sea data only leaves the rain level", () => {
  const vieja = evaluar(CRITERIO, ESTACION, lluvia(15, "2026-11-17T13:00:00Z"), mar(2.5), RELOJ);
  assert.equal(vieja.nivel, null);
  assert.equal(vieja.nivelOrientativo, null);
  assert.match(vieja.motivos.join(" "), /lluvia está fuera de vigencia/);

  const preliminar = evaluar(CRITERIO, ESTACION, lluvia(15), mar(2.5, "Dato preliminar sin control de calidad"), RELOJ);
  assert.equal(preliminar.nivel, "Preparación");
  assert.equal(preliminar.marAlto, null);
  assert.match(preliminar.avisos.join(" "), /calidad validada/);

  const otroDatum = evaluar({ ...CRITERIO, datum: "NMM" }, ESTACION, lluvia(15), mar(2.5), RELOJ);
  assert.equal(otroDatum.nivel, "Preparación");
  assert.match(otroDatum.avisos.join(" "), /datum configurado/);

  const sinEstacion = evaluar({ ...CRITERIO, estacion: null }, undefined, null, mar(2.5), RELOJ);
  assert.equal(sinEstacion.nivelOrientativo, null);
  assert.match(sinEstacion.motivos.join(" "), /no tiene estación/);
});

test("scale: an inactive (experimental) criterion is only indicative", () => {
  const experimental = evaluar({ ...CRITERIO, activo: false, estadoValidacion: "experimental" }, ESTACION, lluvia(26), mar(1), RELOJ);
  assert.equal(experimental.nivel, null);
  assert.equal(experimental.nivelOrientativo, "Respuesta");
  assert.match(experimental.motivos.join(" "), /experimentales/);
});

test("criteria: window compatible with the station and port on its island", () => {
  const base = {
    puerto: "Isla Santa Cruz", datum: "MLWS", sector: "Malecón", respaldo: "Estudio",
    ventanaMin: 60, vigenciaMin: 60, desfaseMin: 30, lluvia: { vigilancia: 5, preparacion: 15, respuesta: 25 },
    marM: 2 as number | null, estadoValidacion: "experimental" as const, alertasPublicas: false, activo: true,
  };
  assert.equal(construirCriterio(base, ESTACION).ventanaMin, 60);
  assert.throws(() => construirCriterio({ ...base, ventanaMin: 90 }, ESTACION), /compatible/);
  assert.throws(() => construirCriterio({ ...base, ventanaMin: 30 }, { ...ESTACION, pasoMin: 60 }), /compatible/);
  assert.throws(() => construirCriterio({ ...base, puerto: "Puerto Villamil" }, ESTACION), /isla de la estación/);
  assert.throws(() => construirCriterio({ ...base, lluvia: { vigilancia: -1, preparacion: 15, respuesta: 25 } }, ESTACION), /lluvia_vigilancia/);
  assert.throws(() => construirCriterio({ ...base, lluvia: { vigilancia: 5, preparacion: 30, respuesta: 25 } }, ESTACION), /menor a mayor/);
  assert.equal(construirCriterio({ ...base, marM: null }, ESTACION).marM, null);
  // Without a station the island comes from the port.
  const isabela = construirCriterio({ ...base, puerto: "Puerto Villamil", ventanaMin: 60 }, null);
  assert.equal(isabela.isla, "Isabela");
  assert.equal(isabela.estacion, null);
  assert.throws(() => construirCriterio({ ...base, puerto: "Puerto Inventado" }, null), /inventario/);
  assert.ok(puertoCoincideIsla("Baltra", "Santa Cruz"));
  assert.ok(!puertoCoincideIsla("Baltra", "San Cristóbal"));
});

// ── Tide monitoring (port of evaluar_marea) ──────────────────────────────────

test("evaluar_marea: every state in the same order as the Python original", () => {
  const ahora = new Date("2026-11-18T16:00:00Z");
  const base = {
    predichaM: 1.2, observadaM: 1.35, fechaObservacion: "2026-11-18T15:30:00Z",
    datumPredicho: "MLWS", datumObservado: "MLWS", fechaPrediccion: "2026-11-18T15:40:00Z",
  };
  assert.deepEqual(evaluarMarea({ ...base, predichaM: null }, ahora), { estado: "SIN_PREDICCION", anomaliaMarM: null });
  assert.deepEqual(evaluarMarea({ ...base, observadaM: null }, ahora), { estado: "SOLO_PREDICCION", mareaPredichaM: 1.2, anomaliaMarM: null });
  assert.equal(evaluarMarea({ ...base, datumObservado: "Referencia instrumental sin datum publicado" }, ahora).estado, "DATUM_INCOMPATIBLE");
  assert.equal(evaluarMarea({ ...base, fechaObservacion: "2026-11-18T15:30:00" }, ahora).estado, "HORA_SIN_ZONA");
  assert.equal(evaluarMarea({ ...base, fechaObservacion: "2026-11-18T13:00:00Z" }, ahora).estado, "DATO_NO_VIGENTE");
  assert.equal(evaluarMarea({ ...base, fechaObservacion: "2026-11-18T16:05:00Z" }, ahora).estado, "DATO_NO_VIGENTE");
  assert.equal(evaluarMarea({ ...base, fechaPrediccion: "2026-11-18T15:40:00" }, ahora).estado, "HORA_SIN_ZONA");
  assert.equal(evaluarMarea({ ...base, fechaPrediccion: null }, ahora).estado, "SIN_HORA_PREDICCION");
  assert.equal(evaluarMarea({ ...base, fechaPrediccion: "2026-11-18T16:10:00Z" }, ahora).estado, "DATOS_DESFASADOS");
  assert.deepEqual(evaluarMarea(base, ahora), {
    estado: "MONITOREO_VALIDO", mareaPredichaM: 1.2, mareaObservadaM: 1.35, anomaliaMarM: 0.15,
    datum: "MLWS", alertaInundacion: false, umbralInundacionValidado: false,
  });
});

test("tide monitoring of a port: curve at the observation time, compatible datum first", () => {
  const pred = (instante: string, valor: number, fase: string): SimatNivelMar => ({
    id: instante, puerto: "Isla Santa Cruz", tipo: "Predicción astronómica", instante, horaPublicada: true,
    valor, unidad: "m", referencia: "MLWS", fase, calidad: "Predicción", fuente: "INOCAR",
  });
  const obs = (instante: string, valor: number, referencia: string): SimatNivelMar => ({
    id: instante + referencia, puerto: "Isla Santa Cruz", tipo: "Nivel observado", instante, horaPublicada: false,
    valor, unidad: "m", referencia, fase: null, calidad: "validado", fuente: "X",
  });
  // Bajamar 0,6 m a las 08:00 y pleamar 1,6 m a las 14:00 (Galápagos): a las 11:00 la curva da 1,1 m.
  const filas = [pred("2026-11-18 08:00", 0.6, "Bajamar"), pred("2026-11-18 14:00", 1.6, "Pleamar")];
  const ahora = new Date("2026-11-18T17:30:00Z");
  const soloIoc = monitoreoPuerto([...filas, obs("2026-11-18T17:00:00Z", 2.3, "Referencia instrumental sin datum publicado")], "Isla Santa Cruz", ahora);
  assert.equal(soloIoc.estado, "DATUM_INCOMPATIBLE");
  assert.equal(soloIoc.anomaliaMarM, null);
  const conMlws = monitoreoPuerto(
    [...filas, obs("2026-11-18T17:20:00Z", 2.4, "Referencia instrumental sin datum publicado"), obs("2026-11-18T17:00:00Z", 1.25, "MLWS")],
    "Isla Santa Cruz",
    ahora,
  );
  assert.equal(conMlws.estado, "MONITOREO_VALIDO");
  assert.equal(conMlws.mareaPredichaM, 1.1);
  assert.equal(conMlws.anomaliaMarM, 0.15);
  assert.equal(monitoreoPuerto(filas, "Isla Santa Cruz", ahora).estado, "SOLO_PREDICCION");
  assert.equal(monitoreoPuerto([], "Puerto Villamil", ahora).estado, "SIN_PREDICCION");
});

// Actual public viewer response, captured with Origin/Referer headers.
import { parseSerieInamhi } from "../modules/simat/conectores/inamhiSeries.js";
test("INAMHI: real hourly response preserves UTC, zero rainfall and variable identity", () => {
  const fixture = JSON.parse(leer("inamhi-hour.json"));
  const rows = parseSerieInamhi(fixture, "INAMHI-64210", new Date("2026-11-01Z"), new Date("2026-12-01Z"));
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.variable === "precipitacion" && r.fuente === "INAMHI"));
  const data = {series: [{code: "017140801h", data: [
    {date: "2026-11-17T14:00:00Z", value: 0},
    {date: "2026-11-17T15:00:00Z", value: -1},
    {date: "2026-11-17T16:00:00", value: 10},
  ]}, {code: "029030401h", data: [{date: "2026-11-17T14:00:00Z", value: 25}]}]};
  const parsed = parseSerieInamhi(data, "INAMHI-64210", new Date("2026-11-17T00:00:00Z"), new Date("2026-11-17T16:00:00Z"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].valor, 0);
  assert.equal(parsed[0].instante.toISOString(), "2026-11-17T14:00:00.000Z");
  assert.throws(() => parseSerieInamhi({}, "X", new Date(), new Date()), /formato/);
});
