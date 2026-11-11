import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { forms, routes, RUTAS_LIMPIEZA, type OperacionLimpieza, type RecursoLimpieza, type RegistroLimpieza } from "@pma/types/protocolo-limpieza";
import { computeAccumulation, destination, points } from "../lib/protocolo-limpieza/acumulacion";
import { claveBarrio } from "../lib/protocolo-limpieza/barrios";
import {
  buildCsv,
  currentDate,
  displayDate,
  executors,
  limpiezaPorBarrio,
  listaLimpieza,
  operationsOf,
  ordenarCampos,
  prellenado,
  recursosPorRuta,
  recursosTexto,
  routeIconSrc,
  sugerenciasRecurso,
  suggestions,
  traspasos,
  visibleHistory,
} from "../lib/protocolo-limpieza/tablero";

// The dashboard logic of the standalone app lived inside its DOM controller
// (lib/dashboard.js) and had no tests of its own; these hold the ported
// functions, and the ones added for the neighbourhoods and resources.

let n = 0;
const reg = (
  kind: OperacionLimpieza,
  data: RegistroLimpieza["data"],
  { updatedAt = `2026-11-10T12:00:0${n % 10}.000Z`, recursos = [] as RecursoLimpieza[] } = {},
): RegistroLimpieza => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  kind,
  data,
  recursos,
  version: 1,
  updatedAt,
});

test("between routes: what passed and its share of what entered the previous route", () => {
  const estado = computeAccumulation(
    [
      reg("recoleccion", { fecha: "2026-11-01", t: 100 }),
      reg("patioSCY", { fecha: "2026-11-02", contenedor: "C-1", t: 40 }),
      reg("relleno", { fecha: "2026-11-02", recepcion: "2026-11-02", t: 10 }),
    ],
    { today: "2026-11-10" },
  );
  const [r2, r21, r3] = traspasos(estado);
  assert.deepEqual([r2.from, r2.to, r2.kind, r2.amount, r2.share], ["R1", "R2", "main", 40, 0.4]);
  assert.deepEqual([r21.to, r21.kind, r21.amount, r21.share], ["R2.1", "branch", 10, 0.1]);
  assert.equal(r2.label, "De R1 a R2 pasó 40 t, el 40 % de lo que entró a R1");
  // Nothing entered R2 → R3, so there is no share to speak of.
  assert.deepEqual([r3.amount, r3.share], [0, 0]);
});

test("each neighbourhood keeps its latest R1 percentage, however its name was written", () => {
  const limpieza = limpiezaPorBarrio(
    [
      reg("recoleccion", { fecha: "2026-11-02", barrio: "MIRAMAR", avance: 80 }),
      reg("recoleccion", { fecha: "2026-11-01", barrio: "Miramar", avance: 20 }),
      reg("recoleccion", { fecha: "2026-11-03", barrio: "Las Orquídeas", avance: 30 }),
      reg("recoleccion", { fecha: "2026-11-04", barrio: "LAS ORQUIDEAS", avance: 55 }),
      // Same day: the report saved last wins.
      reg("recoleccion", { fecha: "2026-11-05", barrio: "EL EDEN", avance: 70 }, { updatedAt: "2026-11-05T15:00:00.000Z" }),
      reg("recoleccion", { fecha: "2026-11-05", barrio: "El Eden", avance: 65 }, { updatedAt: "2026-11-05T09:00:00.000Z" }),
      // The newest date wins, even one after today.
      reg("recoleccion", { fecha: "2026-12-01", barrio: "MIRAMAR", avance: 100 }),
      reg("carga", { fecha: "2026-11-03", barrio: "PELIKAN BAY", avance: 99 }),
    ],
  );
  assert.equal(limpieza.size, 3);
  assert.equal(limpieza.get(claveBarrio("Miramar"))?.avance, 100);
  assert.equal(limpieza.get(claveBarrio("las orquideas"))?.avance, 55);
  assert.equal(limpieza.get(claveBarrio("El Edén"))?.avance, 70);
  assert.equal(limpieza.get(claveBarrio("Pelikan Bay")), undefined);
});

test("the list has only the reported neighbourhoods, most advanced first, with the layer's spelling", () => {
  const limpieza = limpiezaPorBarrio(
    [
      reg("recoleccion", { fecha: "2026-11-02", barrio: "Miramar", avance: 40 }),
      reg("recoleccion", { fecha: "2026-11-02", barrio: "LA FORTUNA", avance: 90 }),
      reg("recoleccion", { fecha: "2026-11-02", barrio: "Sector antiguo", avance: 10 }),
    ],
  );
  const filas = listaLimpieza(["PUNTA ESTRADA", "MIRAMAR", "LA FORTUNA", "EL EDEN"], limpieza);
  assert.equal(listaLimpieza(["PUNTA ESTRADA"], new Map()).length, 0);
  const conCero = listaLimpieza(
    ["PUNTA ESTRADA", "EL EDEN"],
    limpiezaPorBarrio([reg("recoleccion", { fecha: "2026-11-02", barrio: "Punta Estrada", avance: 0 })]),
  );
  assert.deepEqual(conCero.map((f) => [f.barrio, f.avance]), [["PUNTA ESTRADA", 0]]);
  assert.deepEqual(
    filas.map((f) => [f.barrio, f.avance]),
    [["LA FORTUNA", 90], ["MIRAMAR", 40], ["Sector antiguo", 10]],
  );
});

test("each route shows the resources of its latest report, and only those", () => {
  const ayer = [{ cantidad: 3, recurso: "personas", institucion: "GAD Santa Cruz" }];
  const hoy = [
    { cantidad: 10, recurso: "personas", institucion: "Consejo de Gobierno (CGREG)" },
    { cantidad: 1, recurso: "vehículo", institucion: "Consejo de Gobierno (CGREG)" },
  ];
  const filas = recursosPorRuta(
    [
      reg("recoleccion", { fecha: "2026-11-09", barrio: "Miramar" }, { recursos: ayer }),
      reg("carga", { fecha: "2026-11-10", contenedor: "C-1" }, { recursos: hoy }),
      // Later the same day, but without resources: it is still the latest report of R2.
      reg("patioSCY", { fecha: "2026-11-10", contenedor: "C-1" }, { recursos: ayer, updatedAt: "2026-11-10T08:00:00.000Z" }),
      reg("patioSCY", { fecha: "2026-11-10", contenedor: "C-2" }, { updatedAt: "2026-11-10T16:00:00.000Z" }),
      // Relleno counts from its reception date; the newest wins even after today.
      reg("relleno", { fecha: "2026-11-09", recepcion: "2026-11-12" }, { recursos: hoy }),
    ],
  );
  assert.deepEqual(filas.map((f) => f.route), ["R1", "R2", "R2.1", "R3", "R4", "R5", "R6"]);
  const [r1, r2, r21, r3] = filas;
  assert.deepEqual([r1.fecha, r1.recursos], ["2026-11-10", hoy]);
  assert.deepEqual([r2.fecha, r2.recursos], ["2026-11-10", []]);
  assert.deepEqual([r21.fecha, r21.recursos], ["2026-11-12", hoy]);
  assert.deepEqual([r3.fecha, r3.recursos], [null, []]);
  // A resource always reads with a capital letter, also in reports saved before that rule.
  assert.equal(recursosTexto(hoy), "10 Personas (Consejo de Gobierno (CGREG)) | 1 Vehículo (Consejo de Gobierno (CGREG))");
});

test("records are searched in every value and resource, filtered by route and listed newest first", () => {
  const filas = [
    reg("recoleccion", { fecha: "2026-11-01", lote: "L-1", barrio: "Miramar" }),
    reg("relleno", { fecha: "2026-11-02", recepcion: "2026-11-05", lote: "L-2" }),
    reg("carga", { fecha: "2026-11-03", contenedor: "MSCU1234567", lote: "L-1" }, { recursos: [{ cantidad: 2, recurso: "volquetas", institucion: "MIT" }] }),
  ];
  assert.deepEqual(visibleHistory(filas, "", "").map((r) => r.kind), ["relleno", "carga", "recoleccion"]);
  assert.deepEqual(visibleHistory(filas, "R1", "").map((r) => r.kind), ["carga", "recoleccion"]);
  assert.deepEqual(visibleHistory(filas, "", "  MIRAMAR ").map((r) => r.kind), ["recoleccion"]);
  assert.deepEqual(visibleHistory(filas, "", "volquetas").map((r) => r.kind), ["carga"]);
  assert.deepEqual(visibleHistory(filas, "R2.1", "l-1"), []);
});

test("the CSV opens in a Spanish Excel, lists the resources and never runs a cell as a formula", () => {
  const csv = buildCsv([
    reg(
      "recoleccion",
      { fecha: "2026-11-01", barrio: 'La "Unión"', t: 1.5, notas: "=HYPERLINK(\"x\")", responsable: "-Ana" },
      { recursos: [{ cantidad: 10, recurso: "personas", institucion: "GAD Santa Cruz" }] },
    ),
  ]);
  assert.ok(csv.startsWith("﻿"));
  const [cabecera, fila] = csv.slice(1).split("\r\n");
  assert.ok(cabecera.startsWith('"ruta";"operación";"ejecutor";"fecha";"barrio"'));
  assert.ok(cabecera.endsWith('"recursos"'));
  assert.ok(fila.startsWith('"R1";"Recolección";"GAD SCX";"2026-11-01";"La ""Unión"""'));
  assert.ok(fila.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(fila.includes(`"'-Ana"`));
  assert.ok(fila.includes('"1.5"'));
  assert.ok(fila.endsWith('"10 Personas (GAD Santa Cruz)"'));
});

test("the form asks for the cleaning percentage right after the neighbourhood", () => {
  const ids = ordenarCampos(forms.recoleccion.fields).map((c) => c.id);
  assert.equal(ids[ids.indexOf("barrio") + 1], "avance");
  assert.equal(ids.filter((id) => id === "avance").length, 1);
  // Forms without a neighbourhood keep their order.
  assert.deepEqual(ordenarCampos(forms.carga.fields).map((c) => c.id), forms.carga.fields.map((c) => c.id));
});

test("the form offers each executor its operations and suggests what was already reported", () => {
  assert.deepEqual(executors, ["GAD SCX", "OPC", "NAVIERA", "GESTORA AMBIENTAL"]);
  assert.deepEqual(operationsOf("GAD SCX"), ["recoleccion", "carga", "relleno"]);
  assert.deepEqual(operationsOf("GESTORA AMBIENTAL"), ["recepcion", "gestion"]);
  assert.deepEqual(suggestions([reg("carga", { contenedor: "B" }), reg("carga", { contenedor: "A" }), reg("carga", { contenedor: "A" })], "contenedor"), ["A", "B"]);
  const instituciones = sugerenciasRecurso([reg("carga", {}, { recursos: [{ cantidad: 1, recurso: "grúa", institucion: "Armada" }] })], "institucion");
  // The protocol's institutions, as its Ejecución and Apoyo columns write them, plus what was reported.
  for (const nombre of ["CGREG", "GAD SCX", "OPC", "NAVIERA", "NAVIERAS", "MIT", "GESTORA AMBIENTAL", "APEL", "Armada"]) {
    assert.ok(instituciones.includes(nombre), nombre);
  }
  assert.ok(sugerenciasRecurso([], "recurso").includes("Personas"));
  // What was reported in lower case is offered once, capitalised.
  assert.deepEqual(sugerenciasRecurso([reg("carga", {}, { recursos: [{ cantidad: 1, recurso: "personas", institucion: "MIT" }] })], "recurso").filter((r) => r === "Personas"), ["Personas"]);
});

test("dates read as dd/mm/aaaa and today is the day in Galápagos", () => {
  assert.equal(displayDate("2026-11-03"), "03/11/2026");
  assert.equal(displayDate(""), "—");
  assert.equal(displayDate(undefined), "—");
  // 05:30 UTC on the 11th is still the 10th in Galápagos (UTC−6).
  assert.equal(currentDate(new Date("2026-11-11T05:30:00Z")), "2026-11-10");
  assert.equal(currentDate(new Date("2026-11-11T06:30:00Z")), "2026-11-11");
});

test("routes, places and operations carry the exact names of the protocol document", () => {
  assert.deepEqual(
    RUTAS_LIMPIEZA.map((r) => routes[r][0]),
    [
      "Zona urbana → Acopio temporal",
      "Acopio temporal → Patio contenedores SCX",
      "Acopio temporal → Relleno sanitario SCX",
      "Patio contenedores SCX → Puerto de Baltra",
      "Puerto Baltra → Puerto GYE",
      "Puerto GYE → Patio contenedores GYE",
      "Patio GYE → Sitio de gestión de residuos",
    ],
  );
  // Each map point is where its route starts (R2.1, where it ends), named as its trayecto names it.
  assert.deepEqual(
    points.map((p) => [p.id, p.name]),
    [
      ["R1", "Zona urbana"],
      ["R2", "Acopio temporal"],
      ["R2.1", "Relleno sanitario SCX"],
      ["R3", "Patio contenedores SCX"],
      ["R4", "Puerto Baltra"],
      ["R5", "Puerto GYE"],
      ["R6", "Patio GYE"],
    ],
  );
  assert.equal(destination.name, "Sitio de gestión de residuos");
  assert.equal(forms.patioSCY.name, "Traslado al Patio contenedores SCX");
  assert.equal(forms.relleno.name, "Entrega al Relleno sanitario SCX");
  assert.equal(forms.puertoSCY.name, "Traslado al Puerto de Baltra");
  assert.equal(forms.patioGYE.name, "Traslado al Patio contenedores GYE");
  assert.equal(forms.recepcion.fields.find((f) => f.id === "sitio")?.label, "Sitio de gestión de residuos");
});

test("every route is drawn with its map scene, still or animated, and the files exist", () => {
  const publico = join(__dirname, "..", "public");
  for (const r of RUTAS_LIMPIEZA) {
    for (const animado of [false, true]) {
      const src = routeIconSrc(r, animado);
      assert.match(src, /^\/protocolo-limpieza\/mapa\/[a-z-]+\.svg$/);
      assert.equal(src.endsWith("-animado.svg"), animado, src);
      assert.ok(existsSync(join(publico, src)), src);
    }
  }
  assert.equal(routeIconSrc("R1"), "/protocolo-limpieza/mapa/zona-urbana.svg");
  assert.equal(routeIconSrc("R4", true), "/protocolo-limpieza/mapa/puerto-baltra-animado.svg");
  // R3 and R6 are both container yards.
  assert.equal(routeIconSrc("R3"), routeIconSrc("R6"));
});

test("a new report starts from the latest report of the same operation", () => {
  const equipo = [{ cantidad: 10, recurso: "personas", institucion: "CGREG" }];
  const records = [
    reg("recoleccion", { fecha: "2026-11-02", barrio: "MIRAMAR", tipo: "Escombro", t: 5, avance: 30 }),
    // An older report: its lot and how the quantities were obtained are no longer asked.
    reg("recoleccion", { fecha: "2026-11-05", barrio: "LA FORTUNA", lote: "L-002", tipo: "Desecho", t: 8, avance: 60, medicion: "Estimada", metodo: "Volumen", documento: "C-9", responsable: "Luis" }, { recursos: equipo }),
    // The same route, another operation: it never feeds a collection.
    reg("carga", { fecha: "2026-11-09", contenedor: "MSCU1", tipo: "Desecho", t: 8 }),
  ];
  const p = prellenado(records, "recoleccion", "2026-11-10");
  assert.ok(p);
  assert.equal(p.desde, records[1].id);
  // The values the form asks today; the date is today.
  assert.deepEqual(p.data, { fecha: "2026-11-10", barrio: "LA FORTUNA", tipo: "Desecho", t: 8, avance: 60 });
  assert.deepEqual(p.recursos, equipo);
  assert.notEqual(p.recursos[0], equipo[0], "a copy, not the saved report's own objects");
  assert.equal(prellenado(records, "gestion", "2026-11-10"), null);
});

test("the prefilled dates keep their distance from the main one, and the photo is left out", () => {
  const embarque = reg("embarque", { fecha: "2026-11-01", recepcion: "2026-11-04", contenedor: "MSCU1", buque: "Isla Bella", viaje: "V-7", t: 20, documento: "GR-1" });
  const p = prellenado([embarque], "embarque", "2026-11-10");
  assert.equal(p?.data.fecha, "2026-11-10");
  assert.equal(p?.data.recepcion, "2026-11-13", "three days at sea, as before");
  assert.equal(p?.data.buque, "Isla Bella");
  assert.equal(p?.data.documento, undefined);
  const traslado = reg("puertoSCY", { fecha: "2026-11-08", contenedor: "MSCU1", foto: "7b5e4327-61d4-4076-9abf-d4728a0c4789.jpg", sello: "S-1", t: 20 });
  const q = prellenado([traslado], "puertoSCY", "2026-11-10");
  assert.equal(q?.data.foto, undefined);
  // The seal is no longer asked: an older report's seal is not copied.
  assert.equal(q?.data.sello, undefined);
  // On the same date, the report saved last wins.
  const antes = reg("patioGYE", { fecha: "2026-11-09", contenedor: "A" }, { updatedAt: "2026-11-09T08:00:00.000Z" });
  const despues = reg("patioGYE", { fecha: "2026-11-09", contenedor: "B" }, { updatedAt: "2026-11-09T17:00:00.000Z" });
  assert.equal(prellenado([despues, antes], "patioGYE", "2026-11-10")?.data.contenedor, "B");
});
