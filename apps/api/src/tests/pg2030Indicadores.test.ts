import assert from "node:assert/strict";
import test from "node:test";
import {
  coherencia,
  dinero,
  estadoReporte,
  institucionAlCorte,
  metaAlCorte,
  promedio,
  semaforo,
  type MesDatos,
} from "../modules/pg2030/indicadores.js";

/** Twelve months; `plan` and `ejec` give values for some of them. */
function meses(
  plan: Record<number, [number, number]>,
  ejec: Record<number, [number, number]> = {},
): MesDatos[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const p = plan[mes] ?? [0, 0];
    const e = ejec[mes];
    return {
      mes,
      fisicoPlanificado: p[0],
      presupuestoPlanificado: p[1],
      fisicoEjecutado: e ? e[0] : null,
      presupuestoDevengado: e ? e[1] : null,
      reportado: e !== undefined,
    };
  });
}

const T1 = { hasta: 3, exigidos: [1, 2, 3] };

test("the traffic light classifies the unrounded value, with no gaps between bands", () => {
  assert.equal(semaforo(1), "verde");
  assert.equal(semaforo(0.85), "verde");
  assert.equal(semaforo(0.84995), "amarillo", "84,995 % is not rounded up into green");
  assert.equal(semaforo(0.7), "amarillo");
  assert.equal(semaforo(0.6995), "rojo");
  assert.equal(semaforo(0.0001), "rojo");
  assert.equal(semaforo(0), "sin_avance");
});

test("a goal accumulates January to the cutoff, caps at 100 % and counts unsaved months as 0", () => {
  // MAGP-like over-execution: 107,9 % physically becomes 100 %.
  const over = metaAlCorte(meses({ 1: [10, 0], 2: [10, 0], 3: [10, 0] }, { 1: [12, 0], 2: [10, 0], 3: [10.37, 0] }), T1.hasta, T1.exigidos);
  assert.equal(over.fisico.avance, 1);
  // Accrued above plan: the computable amount is the plan, the real one is kept.
  const gasto = metaAlCorte(meses({ 2: [1, 100] }, { 1: [0, 0], 2: [1, 130], 3: [0, 0] }), T1.hasta, T1.exigidos);
  assert.deepEqual([gasto.presupuesto.computable, gasto.presupuesto.devengado, gasto.presupuesto.avance], [100, 130, 1]);
  // A month never saved counts as 0 and the goal is not "reported".
  const parcial = metaAlCorte(meses({ 1: [1, 0], 2: [1, 0], 3: [1, 0] }, { 1: [1, 0], 2: [1, 0] }), T1.hasta, T1.exigidos);
  assert.equal(parcial.fisico.avance, 2 / 3);
  assert.equal(parcial.reportada, false);
  // Months after the cutoff do not count.
  const futuro = metaAlCorte(meses({ 6: [5, 50] }, { 1: [0, 0], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  assert.equal(futuro.aReportar, false);
});

test("zero denominators: no physical plan, executed without plan, no budget", () => {
  const sinProg = metaAlCorte(meses({ 1: [0, 10] }, { 1: [0, 10], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  assert.deepEqual([sinProg.fisico.avance, sinProg.fisico.estado], [null, "sin_programacion"]);
  const ejecSinProg = metaAlCorte(meses({ 1: [0, 10] }, { 1: [3, 10], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  assert.equal(ejecSinProg.fisico.estado, "ejecutado_sin_programacion");
  const devSinProg = metaAlCorte(meses({ 1: [1, 0] }, { 1: [1, 40], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  assert.deepEqual([devSinProg.presupuesto.avance, devSinProg.presupuesto.estado], [null, "devengado_sin_programacion"]);
});

test("T1, Table 3: the total is the simple average of institutional averages (80,22 %)", () => {
  const instituciones = [0.6667, 1, 0.8568, 0.725, 0.9833, 1, 0.3833];
  assert.equal(promedio(instituciones)!.toFixed(4), "0.8022");
  // With MDN at 97,50 % (2 goals, plan §7) it would be 80,10 %.
  assert.equal(promedio([0.6667, 1, 0.8568, 0.725, 0.975, 1, 0.3833])!.toFixed(4), "0.8010");
});

test("T1, Table 4: dollars add up before dividing (59,69 %), by funding source too", () => {
  const corriente = metaAlCorte(meses({ 1: [1, 48_885.42] }, { 1: [1, 46_597.02], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  const inversion = metaAlCorte(meses({ 1: [1, 374_600] }, { 1: [1, 206_174.4], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  const total = dinero([corriente, inversion]);
  assert.equal((total.avance! * 100).toFixed(2), "59.69");
  assert.equal((dinero([corriente]).avance! * 100).toFixed(2), "95.32");
  assert.equal((dinero([inversion]).avance! * 100).toFixed(2), "55.04");
  assert.equal(dinero([]).avance, null, "a source with nothing planned is 'No aplica'");
});

test("T1, Table 5: coherence in percentage points, in the plan's order", () => {
  // SECAP 38,33 % vs 33,66 %: 4,67 points apart.
  assert.equal(coherencia(0.3833, 0.3366, false, 3_232), "coherente");
  // MDN 98,33 % vs 87,56 %.
  assert.equal(coherencia(0.9833, 0.8756, false, 8_722), "incoherencia_brecha");
  // ANT and MPCEI: physical progress, no budget defined.
  assert.equal(coherencia(0.6667, null, true, 0), "sin_financiamiento");
  // ARCOTEL with the accrued amount capped: 100 % and 100 %.
  assert.equal(coherencia(1, 1, false, 500), "coherente");
  // A budget planned but nothing accrued, with physical progress.
  assert.equal(coherencia(0.5, 0, false, 0), "sin_financiamiento");
  assert.equal(coherencia(null, 0.5, false, 10), "no_aplica");
  assert.equal(coherencia(0, null, true, 0), "no_aplica");
});

test("an institution's budget average only uses goals with a planned budget (MDN's 87,56 %)", () => {
  const conPresupuesto = metaAlCorte(meses({ 1: [1, 9_962.3] }, { 1: [1, 8_722.7], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  const sinPresupuesto = metaAlCorte(meses({ 1: [2, 0] }, { 1: [2, 0], 2: [0, 0], 3: [0, 0] }), T1.hasta, T1.exigidos);
  const mdn = institucionAlCorte([conPresupuesto, sinPresupuesto]);
  assert.equal((mdn.presupuesto! * 100).toFixed(2), "87.56");
  assert.equal(mdn.fisico, 1);
  assert.equal(institucionAlCorte([sinPresupuesto]).sinPresupuesto, true);
});

test("reporting compliance by institution", () => {
  assert.equal(estadoReporte(0, 0), "no_obligada");
  assert.equal(estadoReporte(3, 3), "cumplio");
  assert.equal(estadoReporte(3, 1), "parcial");
  assert.equal(estadoReporte(3, 0), "no_cumplio");
});
