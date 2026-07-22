import assert from "node:assert/strict";
import test from "node:test";
import type { SQLWrapper } from "drizzle-orm";
import {
  canonicalDirectionLockOrder,
  lockPlanDirections,
  normalizeDirection,
} from "../modules/shared/directionLock.js";

test("direction lock order is normalized, deduplicated and deterministic", () => {
  const input = [" Norte ", "Sur", "Norte", "", null, undefined, " Este "] as const;

  assert.deepEqual(canonicalDirectionLockOrder(input), ["Este", "Norte", "Sur"]);
  assert.equal(normalizeDirection("  DGTAR  "), "DGTAR");
  assert.equal(input[0], " Norte ", "the caller's input must not be mutated");
});

test("direction locks are acquired sequentially once per canonical direction", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const tx = {
    async execute(_query: SQLWrapper | string) {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    },
  };

  await lockPlanDirections(tx, "pma", "plan-a", ["B", " A ", "B", ""]);

  assert.equal(calls, 2);
  assert.equal(maxActive, 1, "advisory locks must never be requested in parallel");
});
