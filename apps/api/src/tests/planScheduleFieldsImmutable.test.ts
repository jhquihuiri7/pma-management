import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerErrorHandler } from "../auth/middleware.js";
import {
  assertScheduleFieldsNotEdited,
  planCreateSchema,
  planUpdateSchema,
  pmaPlansRoutes,
} from "../routes/pma/plans.js";
import type { PlanUpdateInput } from "../modules/pma/plansModule.js";

/**
 * `start_date` and `report_per` define a plan's schedule grid: the first its
 * origin, the second its block width. From that grid come the reporting-period
 * keys stored in `pma_period_compliance`, every item's evidence ranges and
 * deadline months, which months accept an upload, and the storage folder each
 * evidence file is written to.
 *
 * Editing either after creation reshapes the grid underneath rows already laid
 * out on the old one — which is how plan "Helipuerto Santa Cruz" ended up with
 * nine compliance rows on a block it no longer had (migration 0023). Both
 * fields are now fixed at creation; these tests pin that.
 */

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
}

function assertRefused(body: unknown, pattern: RegExp) {
  assert.throws(
    () => assertScheduleFieldsNotEdited(body),
    (error: unknown) => {
      assert.equal(statusOf(error), 400);
      assert.match(String((error as Error).message), pattern);
      return true;
    },
    `debe rechazarse: ${JSON.stringify(body)}`,
  );
}

test("editing start_date is refused instead of dropped in silence", () => {
  // Including null and the empty string: clearing the field would move the
  // origin to the plan's createdAt, which is just as disruptive as moving it.
  for (const value of ["2020-01-01", null, "", "no es fecha"]) {
    assertRefused({ title: "T", start_date: value }, /fecha de inicio/i);
  }
});

test("editing report_per is refused — it is the more destructive of the two", () => {
  // Going from "6 meses" to "2 años" invalidates every compliance key at once:
  // no six-month label exists on a 24-month grid.
  for (const value of ["6 meses", "1 año", "2 años", null, "otro"]) {
    assertRefused({ title: "T", report_per: value }, /periodo de reporte/i);
  }
});

test("sending both names both of them in one message", () => {
  assertRefused(
    { start_date: "2020-01-01", report_per: "2 años" },
    /fecha de inicio y el periodo de reporte/i,
  );
});

test("the guard leaves every other update untouched", () => {
  for (const body of [
    { title: "T" },
    { description: "", visualization_url: null },
    { tipo: "Licencia", fase: "Operación" },
    {},
    undefined,
    null,
  ]) {
    assert.doesNotThrow(() => assertScheduleFieldsNotEdited(body));
  }
});

test("neither field survives the update contract, so neither can be forwarded", () => {
  // Second line of defence: even without the guard, the schema has no such
  // fields, so Zod strips them and the module never sees a value.
  const stripped = planUpdateSchema.parse({
    title: "T",
    start_date: "2020-01-01",
    report_per: "2 años",
  }) as Record<string, unknown>;
  assert.deepEqual(stripped, { title: "T" });
});

test("PlanUpdateInput makes either change unrepresentable", () => {
  // Compile-time assertions: if either field returns to PlanUpdateInput this
  // stops typechecking, and the runtime guard is no longer the only defence.
  type HasStartDate = "startDate" extends keyof PlanUpdateInput ? true : false;
  type HasReportPer = "reportPer" extends keyof PlanUpdateInput ? true : false;
  const startDateIsGone: HasStartDate extends false ? true : false = true;
  const reportPerIsGone: HasReportPer extends false ? true : false = true;
  assert.equal(startDateIsGone, true);
  assert.equal(reportPerIsGone, true);
});

test("creating a plan without start_date is refused", () => {
  // Now that the field is immutable, omitting it would anchor the plan to its
  // createdAt for good. It has to be caught at creation or not at all.
  for (const payload of [
    { title: "Sin fecha", report_per: "6 meses" },
    { title: "Vacía", report_per: "6 meses", start_date: "" },
    { title: "Nula", report_per: "6 meses", start_date: null },
    { title: "Inválida", report_per: "6 meses", start_date: "2026-02-30" },
  ]) {
    const result = planCreateSchema.safeParse(payload);
    assert.equal(result.success, false, JSON.stringify(payload));
  }
});

test("creating a plan accepts both schedule fields", () => {
  const result = planCreateSchema.safeParse({
    title: "Plan nuevo",
    report_per: "2 años",
    start_date: "2026-01-01",
  });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.start_date, "2026-01-01");
  assert.equal(result.success && result.data.report_per, "2 años");
});

test("the plans routes are registered and authenticate before parsing", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(pmaPlansRoutes, { prefix: "/plans" });

  const response = await app.inject({ method: "POST", url: "/plans", payload: {} });
  assert.equal(response.statusCode, 401);
  await app.close();
});
