import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPmaActivityMonth,
  assertPmaPeriodStart,
  assertRgdpActivityMonth,
} from "../lib/activityMonth.js";

const createdAt = new Date(2026, 0, 15);
const now = new Date(2026, 6, 20);

test("PMA rejects malformed, pre-plan and not-yet-started ranges", () => {
  assert.throws(() => assertPmaActivityMonth({ activityMonth: "2026-7", startDate: "2026-01-01", createdAt, periodicity: "Mensual", now }));
  assert.throws(() => assertPmaActivityMonth({ activityMonth: "2025-12", startDate: "2026-01-01", createdAt, periodicity: "Mensual", now }));
  assert.throws(() => assertPmaActivityMonth({ activityMonth: "2026-10", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
  assert.throws(() => assertPmaActivityMonth({ activityMonth: "2026-09", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
  assert.doesNotThrow(() => assertPmaActivityMonth({ activityMonth: "2026-07", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
});

test("RGDP only accepts scheduled months in its available calendar", () => {
  assert.doesNotThrow(() => assertRgdpActivityMonth({ activityMonth: "2026-07", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
  assert.throws(() => assertRgdpActivityMonth({ activityMonth: "2026-06", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
  assert.throws(() => assertRgdpActivityMonth({ activityMonth: "2026-10", startDate: "2026-01-01", createdAt, periodicity: "Trimestral", now }));
});

test("PMA download periods must be exact, already-started range boundaries", () => {
  assert.doesNotThrow(() => assertPmaPeriodStart({
    activityMonth: "2026-07",
    startDate: "2026-01-01",
    createdAt,
    periodicity: "Trimestral",
    now,
  }));
  assert.throws(() => assertPmaPeriodStart({
    activityMonth: "2026-08",
    startDate: "2026-01-01",
    createdAt,
    periodicity: "Trimestral",
    now,
  }), /beginning of a reporting period/);
  assert.throws(() => assertPmaPeriodStart({
    activityMonth: "2026-10",
    startDate: "2026-01-01",
    createdAt,
    periodicity: "Trimestral",
    now,
  }), /available calendar range/);
});
