import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlanCalendar,
  getPlanEndIndex,
  getPlanPeriods,
  monthKeyOf,
} from "../modules/pma/planSchedule.js";
import { enabledPeriodKeys } from "../modules/pma/periodComplianceModule.js";
import { resolveEstadoEndDate } from "../modules/pma/plansModule.js";
import { assertPmaActivityMonth, assertPmaPeriodStart } from "../lib/activityMonth.js";

// Semestral blocks from March 2024: mar-ago 2024, sept 2024-feb 2025, ...
const PLAN = {
  startDate: "2024-03-01",
  createdAt: new Date("2024-03-01T00:00:00Z"),
  reportPer: "6 meses",
};
const NOW = new Date("2026-09-18T12:00:00Z");

test("sin fecha de fin el calendario llega hasta el mes actual", () => {
  const calendar = getPlanCalendar(PLAN, NOW);
  assert.equal(monthKeyOf(calendar.currentIndex), "2026-09");
  assert.equal(getPlanEndIndex(PLAN), null);
});

test("la fecha de fin acota el mes actual del calendario", () => {
  const calendar = getPlanCalendar({ ...PLAN, endDate: "2025-06-10" }, NOW);
  assert.equal(monthKeyOf(calendar.currentIndex), "2025-06");
});

test("el mes de la fecha de fin está incluido, no excluido", () => {
  // El plan estuvo vigente parte de junio: ese mes cuenta.
  const calendar = getPlanCalendar({ ...PLAN, endDate: "2025-06-01" }, NOW);
  assert.equal(monthKeyOf(calendar.currentIndex), "2025-06");
  assert.ok(getPlanPeriods(calendar).some((period) => period.key === "mar-ago 2025"));
});

test("no se emiten periodos que empiezan después de la fecha de fin", () => {
  const open = getPlanPeriods(getPlanCalendar(PLAN, NOW)).map((period) => period.key);
  const ended = getPlanPeriods(getPlanCalendar({ ...PLAN, endDate: "2025-06-10" }, NOW))
    .map((period) => period.key);

  assert.deepEqual(ended, ["mar-ago 2024", "sept 2024-feb 2025", "mar-ago 2025"]);
  // Prefijo estricto del calendario abierto: acotar solo recorta la cola.
  assert.deepEqual(open.slice(0, ended.length), ended);
  assert.ok(open.length > ended.length);
});

test("el periodo que contiene la fecha de fin conserva su etiqueta completa", () => {
  // El plan termina en junio, pero el bloque se sigue llamando "mar-ago 2025":
  // esa cadena es la clave primaria de sus filas en pma_period_compliance, y
  // recortarla a "mar-jun 2025" dejaría huérfana cada calificación del periodo.
  const periods = getPlanPeriods(getPlanCalendar({ ...PLAN, endDate: "2025-06-10" }, NOW));
  assert.equal(periods[periods.length - 1].key, "mar-ago 2025");
});

test("una fecha de fin futura no adelanta el calendario", () => {
  const calendar = getPlanCalendar({ ...PLAN, endDate: "2030-01-01" }, NOW);
  assert.equal(monthKeyOf(calendar.currentIndex), "2026-09");
});

test("enabledPeriodKeys se acota igual que el calendario", () => {
  const keys = enabledPeriodKeys({ ...PLAN, endDate: "2025-06-10" }, NOW);
  assert.ok(keys.has("mar-ago 2025"), "el periodo que contiene el fin sigue calificable");
  assert.ok(!keys.has("sept 2025-feb 2026"), "el periodo posterior al fin deja de serlo");
  // Las claves siguen siendo las que produce el cronograma, byte a byte.
  const fromSchedule = getPlanPeriods(getPlanCalendar({ ...PLAN, endDate: "2025-06-10" }, NOW));
  assert.deepEqual([...keys].sort(), fromSchedule.map((period) => period.key).sort());
});

test("no se acepta evidencia en un mes posterior a la fecha de fin", () => {
  const input = {
    startDate: PLAN.startDate,
    createdAt: PLAN.createdAt,
    periodicity: "Mensual",
    endDate: "2025-06-10",
    now: NOW,
  };
  assert.doesNotThrow(() => assertPmaActivityMonth({ ...input, activityMonth: "2025-06" }));
  assert.throws(
    () => assertPmaActivityMonth({ ...input, activityMonth: "2025-07" }),
    /posterior a la fecha de fin/,
  );
  assert.throws(
    () => assertPmaPeriodStart({ ...input, periodicity: "Semestral", activityMonth: "2025-09" }),
    /posterior a la fecha de fin/,
  );
});

test("sin fecha de fin la validación de meses no cambia", () => {
  const input = {
    startDate: PLAN.startDate,
    createdAt: PLAN.createdAt,
    periodicity: "Mensual",
    now: NOW,
  };
  assert.doesNotThrow(() => assertPmaActivityMonth({ ...input, activityMonth: "2025-07" }));
  assert.throws(() => assertPmaActivityMonth({ ...input, activityMonth: "2026-10" }));
});

test("marcar Vencida sin fecha de fin se rechaza", () => {
  assert.throws(
    () => resolveEstadoEndDate({ estado: "Vencida" }, { estado: "Vigente", endDate: null }, "2024-03-01"),
    /debes indicar la fecha de fin/,
  );
});

test("volver a Vigente vacía la fecha de fin", () => {
  const resolved = resolveEstadoEndDate(
    { estado: "Vigente" },
    { estado: "Vencida", endDate: "2025-06-10" },
    "2024-03-01",
  );
  assert.deepEqual(resolved, { estado: "Vigente", endDate: null });
});

test("un plan que ya estaba Vigente nunca conserva una fecha de fin", () => {
  // Sin tocar `estado`: la columna se limpia igual, así que una fecha colada
  // por otra vía no puede quedarse recortando un calendario vivo.
  const resolved = resolveEstadoEndDate({}, { estado: "Vigente", endDate: "2025-06-10" }, "2024-03-01");
  assert.deepEqual(resolved, { estado: "Vigente", endDate: null });
});

test("no se puede poner fecha de fin a un plan Vigente", () => {
  assert.throws(
    () => resolveEstadoEndDate({ endDate: "2025-06-10" }, { estado: "Vigente", endDate: null }, "2024-03-01"),
    /Un plan Vigente no lleva fecha de fin/,
  );
});

test("la fecha de fin no puede preceder a la de inicio", () => {
  assert.throws(
    () => resolveEstadoEndDate(
      { estado: "Vencida", endDate: "2024-02-29" },
      { estado: "Vigente", endDate: null },
      "2024-03-01",
    ),
    /no puede ser anterior a la fecha de inicio/,
  );
});

test("un plan ya Vencida conserva su fecha cuando se edita otro campo", () => {
  const resolved = resolveEstadoEndDate({}, { estado: "Vencida", endDate: "2025-06-10" }, "2024-03-01");
  assert.deepEqual(resolved, { estado: "Vencida", endDate: "2025-06-10" });
});

test("se puede corregir la fecha de fin sin volver a enviar el estado", () => {
  const resolved = resolveEstadoEndDate(
    { endDate: "2025-07-01" },
    { estado: "Vencida", endDate: "2025-06-10" },
    "2024-03-01",
  );
  assert.deepEqual(resolved, { estado: "Vencida", endDate: "2025-07-01" });
});
