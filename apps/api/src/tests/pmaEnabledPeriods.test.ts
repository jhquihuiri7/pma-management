import assert from "node:assert/strict";
import test from "node:test";
import { enabledPeriodKeys } from "../modules/pma/periodComplianceModule.js";

// Reproduces the label the web UI builds in apps/web/lib/planPeriods.ts
// (getPeriodLabel) so the test pins backend/frontend parity rather than a
// hand-copied string. Both sides go through CLDR, so September must be "sept".
function uiPeriodLabel(startYear: number, startMonthIdx: number, endYear: number, endMonthIdx: number): string {
  const startLbl = new Date(startYear, startMonthIdx, 1).toLocaleString("es", { month: "short" });
  const endLbl = new Date(endYear, endMonthIdx, 1).toLocaleString("es", { month: "short" });
  return startYear === endYear
    ? `${startLbl}-${endLbl} ${endYear}`
    : `${startLbl} ${startYear}-${endLbl} ${endYear}`;
}

test("enabledPeriodKeys matches the web UI labels, including the 'sept' September block", () => {
  // 6-month plan starting Mar 2024; frozen "today" = mid Jul 2026 (Galápagos).
  const plan = { reportPer: "6 meses", startDate: "2024-03-01", createdAt: new Date("2024-03-01T00:00:00Z") };
  const now = new Date("2026-07-15T12:00:00Z");

  const keys = enabledPeriodKeys(plan, now);

  const expected = [
    uiPeriodLabel(2024, 2, 2024, 7), // mar-ago 2024
    uiPeriodLabel(2024, 8, 2025, 1), // sept 2024-feb 2025  <-- the block that used to fail
    uiPeriodLabel(2025, 2, 2025, 7), // mar-ago 2025
    uiPeriodLabel(2025, 8, 2026, 1), // sept 2025-feb 2026  <-- the block that used to fail
    uiPeriodLabel(2026, 2, 2026, 7), // mar-ago 2026 (in progress)
  ];

  assert.deepEqual([...keys].sort(), [...expected].sort());

  // Regression guard: the September boundary must use the CLDR abbreviation
  // "sept" (what the browser sends), never the truncated "sep".
  assert.ok(keys.has("sept 2024-feb 2025"), 'September block must be "sept 2024-feb 2025"');
  assert.ok(!keys.has("sep 2024-feb 2025"), 'must not fall back to the "sep" spelling');
});

test("enabledPeriodKeys rejects plans that have not started yet", () => {
  const plan = { reportPer: "6 meses", startDate: "2027-01-01", createdAt: new Date("2027-01-01T00:00:00Z") };
  assert.throws(() => enabledPeriodKeys(plan, new Date("2026-07-15T12:00:00Z")), /aún no ha iniciado/);
});
