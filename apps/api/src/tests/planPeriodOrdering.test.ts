import assert from "node:assert/strict";
import test from "node:test";
import { comparePlanPeriodEntries } from "../modules/shared/planPeriodOrdering.js";

test("plan-period mutations use a deterministic item-then-period order", () => {
  const input = [
    { planItemId: "item-b", periodKey: "2026-02" },
    { planItemId: "item-a", periodKey: "2026-03" },
    { planItemId: "item-a", periodKey: "2026-01" },
    { planItemId: "item-b", periodKey: "2026-01" },
  ];

  const ordered = [...input].sort(comparePlanPeriodEntries);
  assert.deepEqual(ordered, [
    { planItemId: "item-a", periodKey: "2026-01" },
    { planItemId: "item-a", periodKey: "2026-03" },
    { planItemId: "item-b", periodKey: "2026-01" },
    { planItemId: "item-b", periodKey: "2026-02" },
  ]);
  assert.equal(input[0]?.planItemId, "item-b", "sorting a copy must not mutate the request body");
});
