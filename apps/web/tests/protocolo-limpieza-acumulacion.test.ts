import assert from "node:assert/strict";
import test from "node:test";
import { forms } from "@pma/types/protocolo-limpieza";
import { balanceGestion, computeAccumulation, computeVoyages, points, type RegistroCalculo } from "../lib/protocolo-limpieza/acumulacion";

// Ported from the standalone app's tests/accumulation.test.mjs: same cases, same numbers.

const rec = (kind: string, data: RegistroCalculo["data"]): RegistroCalculo => ({ kind, data });
const chain = [
  rec("recoleccion", { fecha: "2026-11-01", t: 100, m3: 150 }),
  rec("relleno", { fecha: "2026-11-02", recepcion: "2026-11-02", t: 10, m3: 15 }),
  rec("patioSCY", { fecha: "2026-11-03", contenedor: "C-1", t: 40, m3: 60 }),
  rec("patioSCY", { fecha: "2026-11-03", contenedor: "C-2", t: 30, m3: 45 }),
  rec("puertoSCY", { fecha: "2026-11-04", contenedor: "C-1", t: 40, m3: 60 }),
  rec("embarque", { fecha: "2026-11-05", contenedor: "C-1", t: 40, m3: 60 }),
];

test("todas las rutas registran toneladas, metros cúbicos y unidades obligatorios", () => {
  for (const f of Object.values(forms)) {
    for (const id of ["t", "m3", "u"]) assert.ok(f.fields.some((x) => x.id === id && x.required), `${f.name} sin ${id}`);
  }
});

test("R4 está en Santa Cruz: sale de Baltra hacia Guayaquil", () => {
  const zone = Object.fromEntries(points.map((p) => [p.id, p.zone]));
  assert.deepEqual(["R1", "R2", "R2.1", "R3", "R4"].map((id) => zone[id]), ["sc", "sc", "sc", "sc", "sc"]);
  assert.deepEqual(["R5", "R6"].map((id) => zone[id]), ["gye", "gye"]);
});

test("si entran 100 t al R1 y 50 t pasan al R2, R1 baja a la mitad y R2 sube", () => {
  const r1 = [rec("recoleccion", { fecha: "2026-11-01", t: 100, m3: 150 })];
  const before = computeAccumulation(r1, { today: "2026-11-01" });
  assert.equal(before.stock.R1, 100);
  assert.equal(before.total, 100);
  const after = computeAccumulation([...r1, rec("patioSCY", { fecha: "2026-11-02", contenedor: "A", t: 50, m3: 75 })], { today: "2026-11-02" });
  assert.equal(after.stock.R1, 50);
  assert.equal(after.stock.R2, 50);
  assert.equal(after.total, 100);
  assert.ok(after.active.has("R2") && after.activeLegs.has("R2"));
});

test("cada ruta pinta lo que entró menos lo que pasó a la siguiente, en la unidad elegida", () => {
  const t = computeAccumulation(chain, { today: "2026-11-05" });
  assert.deepEqual(t.moved, { R1: 100, R2: 70, "R2.1": 10, R3: 40, R4: 40, R5: 0, R6: 0 });
  assert.equal(t.stock.R1, 20); // 100 − 70 al patio − 10 al relleno
  assert.equal(t.stock.R2, 30); // 70 − 40 a Baltra
  assert.equal(t.stock["R2.1"], 10);
  assert.equal(t.stock.R3, 0); // 40 − 40 embarcadas
  assert.equal(t.stock.R4, 40);
  assert.equal(t.total, 100);
  assert.deepEqual(Array.from(t.active), ["R4"]);
  assert.equal(t.boxes.R4, 1);
  assert.equal(t.boxes.R2, 1);
  const m3 = computeAccumulation(chain, { unit: "m3", today: "2026-11-05" });
  assert.equal(m3.stock.R1, 30);
  assert.equal(m3.stock.R2, 45);
  assert.equal(m3.stock.R4, 60);
  assert.equal(m3.total, 150);
});

test("respeta la fecha de corte", () => {
  const s = computeAccumulation(chain, { to: "2026-11-03", today: "2026-11-10" });
  assert.equal(s.stock.R1, 20);
  assert.equal(s.stock.R2, 70);
  assert.equal(s.stock.R4, 0);
  assert.equal(s.active.size, 0);
});

test("con fecha inicial solo cuenta los movimientos del período", () => {
  const s = computeAccumulation(chain, { from: "2026-11-04", today: "2026-11-10" });
  assert.equal(s.moved.R1, 0);
  assert.equal(s.stock.R3, 0);
  assert.equal(s.stock.R4, 40);
});

test("la carga llega a Guayaquil y pasa por R5 y R6", () => {
  // El embarque se completa con la fecha de llegada a Guayaquil.
  const gye = [
    ...chain.slice(0, -1),
    rec("embarque", { fecha: "2026-11-05", recepcion: "2026-11-08", contenedor: "C-1", t: 40, m3: 60 }),
    rec("patioGYE", { fecha: "2026-11-09", recepcion: "2026-11-09", contenedor: "C-1", t: 40, m3: 60 }),
    rec("recepcion", { fecha: "2026-11-10", contenedor: "C-1", t: 25, m3: 37.5 }),
  ];
  const s = computeAccumulation(gye, { today: "2026-11-10" });
  assert.equal(s.stock.R4, 0);
  assert.equal(s.stock.R5, 15);
  assert.equal(s.stock.R6, 25);
  assert.ok(s.active.has("R6") && s.activeLegs.has("R6"));
});

// Barcos del R4: salida 00:00 en Galápagos (UTC−6), llegada 23:59 en Guayaquil (UTC−5).
const at = (date: string, hour: number) => Date.parse(date + "T" + String(hour).padStart(2, "0") + ":00:00-06:00");
const trips = [
  rec("embarque", { fecha: "2026-11-12", recepcion: "2026-11-14", contenedor: "A-1", buque: "Isla Bonita", t: 10, m3: 15, u: 3 }),
  rec("embarque", { fecha: "2026-11-12", recepcion: "2026-11-14", contenedor: "A-2", buque: "ISLA BONITA ", t: 5, m3: 7.5, u: 2 }),
  rec("embarque", { fecha: "2026-11-10", recepcion: "2026-11-12", contenedor: "B-1", buque: "Galápagos Trader", t: 8, m3: 12, u: 4 }),
];

test("agrupa los barcos por buque y fecha de salida, con su carga", () => {
  const v = computeVoyages(trips, { now: at("2026-11-11", 12), today: "2026-11-11" });
  assert.equal(v.length, 2);
  const bonita = v.find((x) => x.salida === "2026-11-12")!;
  assert.equal(bonita.containers, 2);
  assert.equal(bonita.amount, 15);
  assert.equal(computeVoyages(trips, { unit: "u", now: at("2026-11-11", 12) }).find((x) => x.salida === "2026-11-12")!.amount, 5);
});

test("ubica cada barco según la hora: programado, navegando o arribado", () => {
  const now = at("2026-11-11", 12);
  const [trader, bonita] = computeVoyages(trips, { now, today: "2026-11-11" });
  assert.equal(bonita.status, "programado");
  assert.equal(trader.status, "navegando");
  // Del 10/11 00:00 (Galápagos) al 12/11 23:59 (Guayaquil): 71 h; a las 12:00 del 11/11 van 36 h.
  assert.ok(Math.abs(trader.progress - 36 / 71) < 1e-4);
  assert.equal(computeVoyages(trips, { now: at("2026-11-10", 0) })[0].progress, 0);
  const later = computeVoyages(trips, { now: at("2026-11-13", 9), today: "2026-11-13" });
  assert.equal(later.find((x) => x.buque === "Galápagos Trader")!.status, "arribado");
  assert.equal(later.find((x) => x.salida === "2026-11-12")!.status, "navegando");
});

test("el barco arribado sale del mapa cuando su carga pasa al R5", () => {
  const r5 = rec("patioGYE", { fecha: "2026-11-13", recepcion: "2026-11-13", contenedor: "B-1", t: 8, m3: 12, u: 4 });
  const v = computeVoyages([...trips, r5], { now: at("2026-11-13", 9), today: "2026-11-13" });
  assert.equal(v.length, 1);
  assert.equal(v[0].buque, "Isla Bonita");
});

test("un embarque programado no cuenta en R4 hasta su fecha de salida", () => {
  const r3 = rec("puertoSCY", { fecha: "2026-11-09", contenedor: "A-1", t: 15, m3: 22.5, u: 5 });
  const before = computeAccumulation([r3, ...trips.slice(0, 2)], { today: "2026-11-11", now: at("2026-11-11", 12) });
  assert.equal(before.stock.R3, 15);
  assert.equal(before.stock.R4, 0);
  assert.equal(before.voyages[0].status, "programado");
  const sailing = computeAccumulation([r3, ...trips.slice(0, 2)], { today: "2026-11-12", now: at("2026-11-12", 6) });
  assert.equal(sailing.stock.R3, 0);
  assert.equal(sailing.stock.R4, 15);
  assert.equal(sailing.voyages[0].status, "navegando");
});

test("balance de gestión: el rojo es lo que falta sacar de Santa Cruz y el verde lo que ya llegó a Guayaquil", () => {
  // Recién recolectado: todo está por sacar, nada gestionado.
  const inicio = balanceGestion(computeAccumulation([chain[0]], { today: "2026-11-01" }));
  assert.deepEqual([inicio.porSacar, inicio.gestionado, inicio.base, inicio.partePorSacar, inicio.parteGestionada], [100, 0, 100, 1, 0]);
  // 10 t van al relleno (se gestionan en la isla) y 40 t ya se embarcaron: quedan 50 de 90 por sacar.
  const enCamino = balanceGestion(computeAccumulation(chain, { today: "2026-11-05" }));
  assert.deepEqual([enCamino.porSacar, enCamino.gestionado, enCamino.base], [50, 0, 90]);
  assert.equal(enCamino.partePorSacar.toFixed(3), "0.556");
  // Las 40 t llegan a Guayaquil: la gestora recibe 25 (R6) y 15 esperan en el patio (R5).
  const gye = [
    ...chain.slice(0, -1),
    rec("embarque", { fecha: "2026-11-05", recepcion: "2026-11-08", contenedor: "C-1", t: 40, m3: 60 }),
    rec("patioGYE", { fecha: "2026-11-09", recepcion: "2026-11-09", contenedor: "C-1", t: 40, m3: 60 }),
    rec("recepcion", { fecha: "2026-11-10", contenedor: "C-1", t: 25, m3: 37.5 }),
  ];
  const final = balanceGestion(computeAccumulation(gye, { today: "2026-11-10" }));
  assert.deepEqual([final.porSacar, final.gestionado, final.base], [50, 40, 90]);
  assert.equal(final.parteGestionada.toFixed(3), "0.444");
  // Sin registros no hay nada que pintar.
  assert.deepEqual(balanceGestion(computeAccumulation([], { today: "2026-11-10" })), { porSacar: 0, gestionado: 0, base: 0, partePorSacar: 0, parteGestionada: 0 });
});
