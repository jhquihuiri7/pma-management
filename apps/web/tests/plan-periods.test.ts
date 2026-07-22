import assert from "node:assert/strict";
import test from "node:test";

import {
  getBusinessMonth,
  getItemRanges,
  getPlanStartDate,
  getPlanPeriodsByMode,
} from "../lib/planPeriods";

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateOnly(date: Date): string {
  return `${monthKey(date)}-01`;
}

test("ninguna periodicidad permite adjuntar evidencias en meses futuros", () => {
  const currentMonth = getBusinessMonth();
  const now = currentMonth;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const plan = {
    start_date: `${now.getFullYear()}-01-01`,
    createdAt: `${now.getFullYear()}-01-01T00:00:00.000Z`,
  };

  for (const periodicity of ["Mensual", "Trimestral", "Semestral", "Anual", "Única vez"]) {
    const ranges = getItemRanges(plan, periodicity);
    const selectable = ranges.flatMap((range) => range.selectableMonthKeys);
    assert.ok(selectable.every((key) => key <= monthKey(currentMonth)), periodicity);
    assert.ok(!selectable.includes(monthKey(nextMonth)), periodicity);
  }
});

test("un plan que inicia el próximo mes se muestra pero no admite evidencias", () => {
  const now = getBusinessMonth();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ranges = getItemRanges({
    start_date: dateOnly(nextMonth),
    createdAt: nextMonth.toISOString(),
  }, "Mensual");

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0]?.started, false);
  assert.deepEqual(ranges[0]?.selectableMonthKeys, []);
});

test("los periodos mensuales de reporte terminan en el mes actual", () => {
  const now = getBusinessMonth();
  const periods = getPlanPeriodsByMode({
    start_date: `${now.getFullYear()}-01-01`,
    createdAt: `${now.getFullYear()}-01-01T00:00:00.000Z`,
  }, "monthly");

  assert.equal(periods.at(-1)?.key, monthKey(now));
});

test("el mes operativo coincide con Galápagos en el borde de mes", () => {
  assert.equal(
    monthKey(getBusinessMonth(new Date("2026-08-01T05:30:00.000Z"))),
    "2026-07"
  );
  assert.equal(
    monthKey(getBusinessMonth(new Date("2026-08-01T06:30:00.000Z"))),
    "2026-08"
  );
});

test("el fallback de createdAt conserva la fecha calendario de Galápagos", () => {
  const beforeMidnight = getPlanStartDate({
    createdAt: "2026-08-01T05:30:00.000Z",
  });
  assert.equal(monthKey(beforeMidnight), "2026-07");
  assert.equal(beforeMidnight.getDate(), 31);

  const afterMidnight = getPlanStartDate({
    createdAt: "2026-08-01T06:30:00.000Z",
  });
  assert.equal(monthKey(afterMidnight), "2026-08");
  assert.equal(afterMidnight.getDate(), 1);
});
