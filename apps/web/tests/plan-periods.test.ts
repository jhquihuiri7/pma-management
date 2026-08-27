import assert from "node:assert/strict";
import test from "node:test";

import {
  createPeriodHelpers,
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

// The period in progress used to be named after whatever month was current, so
// one reporting period accumulated a different `pma_period_compliance` key every
// month ("mar-may 2026", "mar-jul 2026", "mar-ago 2026" are all the same block).
// The API only accepts whole-block keys, so the clipped spellings also made
// grading the current period fail. These pin the whole-block spelling.
test("la etiqueta de un periodo es el bloque completo, no el mes consultado", () => {
  const plan = { start_date: "2024-03-01", createdAt: "2024-03-01T00:00:00Z", report_per: "6 meses" };
  const { getPeriodLabel } = createPeriodHelpers(plan);

  // Every month inside mar–ago 2026 must resolve to the same key.
  for (const month of [2, 3, 4, 5, 6, 7]) {
    assert.equal(getPeriodLabel(new Date(2026, month, 1)), "mar-ago 2026");
  }
  // And the next block is its own key, including the year-crossing spelling.
  for (const month of [8, 9, 10, 11]) {
    assert.equal(getPeriodLabel(new Date(2026, month, 1)), "sept 2026-feb 2027");
  }
  assert.equal(getPeriodLabel(new Date(2027, 0, 1)), "sept 2026-feb 2027");
});

test("un plan de 2 años etiqueta el bloque de 24 meses completo", () => {
  const plan = { start_date: "2018-09-07", createdAt: "2018-09-07T00:00:00Z", report_per: "2 años" };
  const { getPeriodLabel } = createPeriodHelpers(plan);

  assert.equal(getPeriodLabel(new Date(2018, 8, 1)), "sept 2018-ago 2020");
  assert.equal(getPeriodLabel(new Date(2019, 5, 1)), "sept 2018-ago 2020");
  assert.equal(getPeriodLabel(new Date(2020, 7, 1)), "sept 2018-ago 2020");
  // The period in progress keeps the whole-block spelling mid-period.
  assert.equal(getPeriodLabel(new Date(2026, 4, 1)), "sept 2024-ago 2026");
  assert.equal(getPeriodLabel(new Date(2026, 7, 1)), "sept 2024-ago 2026");
});

test("getActivityPeriodLabel y getPeriodLabel coinciden en todo el bloque", () => {
  const plan = { start_date: "2024-03-01", createdAt: "2024-03-01T00:00:00Z", report_per: "6 meses" };
  const { getPeriodLabel, getActivityPeriodLabel } = createPeriodHelpers(plan);

  for (const [key, month] of [["2026-03", 2], ["2026-05", 4], ["2026-08", 7]] as const) {
    assert.equal(getActivityPeriodLabel(key), getPeriodLabel(new Date(2026, month, 1)));
  }
  // A month before the plan start has no period and is returned untouched.
  assert.equal(getActivityPeriodLabel("2023-01"), "2023-01");
});

test("los periodos por bloque terminan en el bloque que contiene el mes actual", () => {
  const plan = { start_date: "2024-03-01", createdAt: "2024-03-01T00:00:00Z", report_per: "6 meses" };
  const { getPeriodLabel } = createPeriodHelpers(plan);
  const periods = getPlanPeriodsByMode(plan, "block");

  // The last chip is the block in progress, spelled as the whole block, which is
  // what the API's enabledPeriodKeys accepts.
  assert.equal(periods.at(-1)?.key, getPeriodLabel(getBusinessMonth()));
  // No clipped duplicate of the same block sneaks in.
  assert.equal(new Set(periods.map((p) => p.key)).size, periods.length);
});
