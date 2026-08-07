import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_RANGE } from "../components/previene/PrevieneFilters";

/**
 * The date range is the viewer's only server-side filter, and the upper edge
 * becomes a hard `submitted_at <= hasta`. A fixed date there is a timer: from
 * that day on, every new report is missing from the map with no error, no empty
 * state and no path through the interface that brings it back.
 *
 * These tests exist because that is exactly what shipped — `TODAY = "2026-12-31"`
 * as a module constant — and it would have gone unnoticed until 1 January 2027.
 */

test("the default range fixes no boundary at all", () => {
  assert.equal(DEFAULT_RANGE.desde, "", "a lower bound would hide the oldest reports");
  assert.equal(DEFAULT_RANGE.hasta, "", "an upper bound is a date on which the viewer goes blind");
});

test("an empty edge is falsy, so the caller omits the parameter", () => {
  // The loader builds the query with `if (range.hasta)`. Any placeholder that
  // is truthy — "none", "9999-12-31" — would be sent to the server and rejected
  // or, worse, applied.
  assert.ok(!DEFAULT_RANGE.desde);
  assert.ok(!DEFAULT_RANGE.hasta);
});

test("the filter module holds no hardcoded calendar date", () => {
  // A literal date reintroduced anywhere in this file is the same defect
  // wearing a different name, so it is checked structurally rather than by
  // asserting on one constant that could simply be renamed.
  const source = readFileSync(
    fileURLToPath(new URL("../components/previene/PrevieneFilters.tsx", import.meta.url)),
    "utf8",
  );
  const literalDate = source.match(/\d{4}-\d{2}-\d{2}/);
  assert.equal(
    literalDate,
    null,
    `a hardcoded date (${literalDate?.[0]}) makes the viewer expire; derive it from the clock at each use`,
  );
});
