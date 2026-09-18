import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { PMA_PLAN_ESTADO_VALUES } from "@pma/types";
import { registerErrorHandler } from "../auth/middleware.js";
import { pmaPlanEstadoEnum } from "../db/schema/enums.js";
import { MAX_REASON_LENGTH, type SetActionPlanInput } from "../modules/pma/actionPlanModule.js";
import type { PlanCreateInput, PlanUpdateInput } from "../modules/pma/plansModule.js";
import { pmaActionPlanRoutes, toggleSchema } from "../routes/pma/actionPlan.js";
import {
  assertActionPlanNotEdited,
  planCreateSchema,
  planUpdateSchema,
} from "../routes/pma/plans.js";

/**
 * Two PMA plan fields that look alike and are governed in opposite ways.
 *
 * `estado` is a label an administrator declares — "Vigente" or "Vencida" — and
 * nothing in the system branches on it. It is written like any other plan
 * field, through the plan schemas.
 *
 * `actionPlanActive` is the denormalized head of `pma_action_plan_activations`,
 * and every transition of it is signed: who flipped it, when, and why. Its own
 * endpoint writes the flag and the audit row in one transaction. If the flag
 * could also be set through a plan update, a plan could end up activated with
 * nobody's name and no motive on record — which is the whole point of the
 * feature gone. These tests pin that asymmetry: `estado` in, the flag out, and
 * the refusal of the flag spoken aloud rather than performed by a silent Zod
 * strip.
 *
 * Everything here runs without a database. What needs one lives in
 * pmaActionPlan.integration.test.ts.
 */

const CREATE_BASE = {
  title: "Plan con estado",
  report_per: "6 meses",
  start_date: "2026-01-01",
} as const;

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
}

// ---------------------------------------------------------------------------
// estado
// ---------------------------------------------------------------------------

test("the estado list the web ships is the pg enum, element for element", () => {
  // Two independent literals: `PMA_PLAN_ESTADO_VALUES` in @pma/types feeds the
  // web's <select>, `pmaPlanEstadoEnum` is the column migration 0027 created.
  // Nothing else in the repo pins one against the other, so adding a value on
  // one side only would ship a dropdown option the database refuses.
  assert.deepEqual([...PMA_PLAN_ESTADO_VALUES], [...pmaPlanEstadoEnum.enumValues]);
  // Order included: the first value is what the form offers by default and what
  // the column falls back to.
  assert.deepEqual([...PMA_PLAN_ESTADO_VALUES], ["Vigente", "Vencida"]);
  assert.equal(pmaPlanEstadoEnum.enumName, "pma_plan_estado");
});

test("a plan may be created with any estado, and omitting it takes the column default", () => {
  for (const estado of PMA_PLAN_ESTADO_VALUES) {
    const result = planCreateSchema.safeParse({ ...CREATE_BASE, estado });
    assert.equal(result.success, true, estado);
    assert.equal(result.success && result.data.estado, estado);
  }

  // Omitted and empty both arrive as undefined, so `createPlan` leaves the
  // column out of the INSERT and Postgres applies "Vigente".
  for (const payload of [{ ...CREATE_BASE }, { ...CREATE_BASE, estado: "" }, { ...CREATE_BASE, estado: "   " }]) {
    const result = planCreateSchema.safeParse(payload);
    assert.equal(result.success, true, JSON.stringify(payload));
    assert.equal(result.success && result.data.estado, undefined);
  }
});

test("a plan may be updated to any estado", () => {
  for (const estado of PMA_PLAN_ESTADO_VALUES) {
    const result = planUpdateSchema.safeParse({ estado });
    assert.equal(result.success, true, estado);
    assert.equal(result.success && result.data.estado, estado);
  }
});

test("estado outside the enum is refused on both create and update", () => {
  // Including the near-misses a hand-written client would reach for.
  for (const estado of ["Caducada", "vigente", "VENCIDA", "Vencido", "Activa", 1, true]) {
    assert.equal(
      planCreateSchema.safeParse({ ...CREATE_BASE, estado }).success,
      false,
      `create ${JSON.stringify(estado)}`,
    );
    assert.equal(
      planUpdateSchema.safeParse({ estado }).success,
      false,
      `update ${JSON.stringify(estado)}`,
    );
  }
});

test("estado is never nullable — the column is NOT NULL", () => {
  // `tipo` and `fase` are nullable and their empty value means "bórralo".
  // `estado` is not: a plan always has a vigencia, so null has to be refused at
  // the edge instead of reaching the column and failing as a 500.
  const update = planUpdateSchema.safeParse({ estado: null });
  assert.equal(update.success, false);
  assert.deepEqual(update.success ? [] : update.error.issues[0]!.path, ["estado"]);
  assert.equal(planCreateSchema.safeParse({ ...CREATE_BASE, estado: null }).success, false);

  // And the empty string means "no lo estoy cambiando", not "bórralo": it
  // survives the parse as undefined, which `updatePlan` filters out before the
  // UPDATE is built.
  const blank = planUpdateSchema.safeParse({ title: "T", estado: "" });
  assert.equal(blank.success, true);
  assert.equal(blank.success && blank.data.estado, undefined);
  assert.equal(blank.success && blank.data.title, "T");
});

// ---------------------------------------------------------------------------
// actionPlanActive: read-only on the plan routes
// ---------------------------------------------------------------------------

test("flipping the Plan de Acción through a plan update is refused out loud", () => {
  // The reason this is a thrown 400 and not a silent strip: a client that sent
  // the flag and got 200 back would believe the plan was activated, and the
  // activation history would have no row explaining it. Same precedent as
  // `assertScheduleFieldsNotEdited`.
  //
  // Both spellings, because the serializer emits the camelCase one and a client
  // echoing back the plan it just read would otherwise be stripped in silence.
  for (const field of ["action_plan_active", "actionPlanActive"]) {
    // Any value at all: deactivating without a motive is as unsigned as
    // activating without one.
    for (const value of [true, false, null, "true", 1, undefined]) {
      assert.throws(
        () => assertActionPlanNotEdited({ title: "T", [field]: value }),
        (error: unknown) => {
          assert.equal(statusOf(error), 400);
          assert.match(String((error as Error).message), /plan de acción/i);
          // The message has to point at the way that does work, or the caller
          // is only told "no".
          assert.match(String((error as Error).message), /motivo/i);
          return true;
        },
        `debe rechazarse: ${field}=${JSON.stringify(value)}`,
      );
    }
  }
});

test("the guard leaves every legitimate plan update alone", () => {
  for (const body of [
    { title: "T" },
    { estado: "Vencida" },
    { tipo: "Licencia Ambiental", fase: "Operación", estado: "Vigente" },
    { description: "", visualization_url: null },
    {},
    undefined,
    null,
    "no es un objeto",
  ]) {
    assert.doesNotThrow(() => assertActionPlanNotEdited(body), JSON.stringify(body));
  }
});

test("neither plan schema carries the flag, so nothing could forward it anyway", () => {
  // Second line of defence, behind the loud guard: even if the guard were
  // removed from the route, the schemas have no such field and the module would
  // never see a value.
  const updated = planUpdateSchema.parse({
    title: "T",
    action_plan_active: true,
    actionPlanActive: true,
  }) as Record<string, unknown>;
  assert.deepEqual(updated, { title: "T" });

  const created = planCreateSchema.parse({
    ...CREATE_BASE,
    action_plan_active: true,
    actionPlanActive: true,
  }) as Record<string, unknown>;
  assert.equal("action_plan_active" in created, false);
  assert.equal("actionPlanActive" in created, false);
});

test("PlanCreateInput and PlanUpdateInput make an unsigned flip unrepresentable", () => {
  // Compile-time assertions: if the flag returns to either input type this
  // stops typechecking, and the runtime guard is no longer the last defence.
  type CreateHasFlag = "actionPlanActive" extends keyof PlanCreateInput ? true : false;
  type UpdateHasFlag = "actionPlanActive" extends keyof PlanUpdateInput ? true : false;
  const absentFromCreate: CreateHasFlag extends false ? true : false = true;
  const absentFromUpdate: UpdateHasFlag extends false ? true : false = true;
  assert.equal(absentFromCreate, true);
  assert.equal(absentFromUpdate, true);

  // `estado`, by contrast, belongs to both.
  type CreateHasEstado = "estado" extends keyof PlanCreateInput ? true : false;
  type UpdateHasEstado = "estado" extends keyof PlanUpdateInput ? true : false;
  const createTakesEstado: CreateHasEstado extends true ? true : false = true;
  const updateTakesEstado: UpdateHasEstado extends true ? true : false = true;
  assert.equal(createTakesEstado, true);
  assert.equal(updateTakesEstado, true);
});

// ---------------------------------------------------------------------------
// The activation endpoint's contract
// ---------------------------------------------------------------------------

test("a transition is unrepresentable without both its target state and its motive", () => {
  // The route parses the body into exactly this shape, so the type is where a
  // forgotten field is caught first. See the note at the end of this file about
  // the body schema itself.
  // @ts-expect-error — `reason` is required: a transition with no motive is not
  // a transition anyone signed for.
  const withoutReason: SetActionPlanInput = { planId: randomUUID(), active: true };
  // @ts-expect-error — `active` is required: the target state is never implied
  // by "toggle whatever it is now", which is what makes the 409 meaningful.
  const withoutActive: SetActionPlanInput = { planId: randomUUID(), reason: "Motivo" };
  // @ts-expect-error — `active` is a boolean, not a string the client picked.
  const stringyActive: SetActionPlanInput = { planId: randomUUID(), active: "true", reason: "M" };
  void withoutReason;
  void withoutActive;
  void stringyActive;

  const complete: SetActionPlanInput = { planId: randomUUID(), active: true, reason: "Motivo" };
  assert.equal(complete.active, true);
});

test("the motive has a bound the form can mirror", () => {
  // Exported so the web textarea and the server agree on one number instead of
  // the client discovering the limit through a 400.
  assert.equal(MAX_REASON_LENGTH, 1000);
  assert.ok(Number.isInteger(MAX_REASON_LENGTH) && MAX_REASON_LENGTH > 0);
});

test("both action-plan routes refuse an unauthenticated caller", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(pmaActionPlanRoutes, { prefix: "/plans/:planId/action-plan" });
  const url = `/plans/${randomUUID()}/action-plan`;

  const read = await app.inject({ method: "GET", url });
  assert.equal(read.statusCode, 401);
  assert.match(read.json().message, /token/i);

  const write = await app.inject({
    method: "POST",
    url,
    payload: { active: true, reason: "Incumplimiento reiterado" },
  });
  assert.equal(write.statusCode, 401);

  await app.close();
});

test("authentication is judged before the body and the plan id are", async () => {
  // An anonymous caller must not be able to tell a malformed request from a
  // rejected one: no validation oracle, and no confirmation that a plan id
  // exists.
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(pmaActionPlanRoutes, { prefix: "/plans/:planId/action-plan" });

  const blankMotive = await app.inject({
    method: "POST",
    url: `/plans/${randomUUID()}/action-plan`,
    payload: { active: true, reason: "   " },
  });
  assert.equal(blankMotive.statusCode, 401);

  const notAUuid = await app.inject({ method: "GET", url: "/plans/no-es-uuid/action-plan" });
  assert.equal(notAUuid.statusCode, 401);

  await app.close();
});

// ---------------------------------------------------------------------------
// The transition body itself
// ---------------------------------------------------------------------------

test("a blank motive is refused, however much whitespace it is dressed in", () => {
  // The whole feature is "no transition without a signed reason", and this is
  // the only place a blank one can still be stopped: `reason` is NOT NULL with
  // a non-empty CHECK in 0027, so a whitespace-only motive that got past here
  // would either be stored blank or blow up as a 500 at the constraint.
  for (const reason of ["", " ", "   ", "\t", "\n", "\u00a0\u00a0", " \t\n "]) {
    const result = toggleSchema.safeParse({ active: true, reason });
    assert.equal(result.success, false, `debe rechazarse: ${JSON.stringify(reason)}`);
  }
});

test("the motive is trimmed before it is measured, not after", () => {
  // Order-dependent and easy to reverse in a refactor: `.min(1).trim()` accepts
  // "   " and then hands the module an empty string. Pinning the trimmed output
  // is what makes that regression fail here instead of in the database.
  const result = toggleSchema.parse({ active: true, reason: "  Incumplimiento reiterado  " });
  assert.equal(result.reason, "Incumplimiento reiterado");

  // And a motive that is only meaningful once trimmed still gets through.
  assert.equal(toggleSchema.parse({ active: false, reason: "  x  " }).reason, "x");
});

test("the target state is required and must be a real boolean", () => {
  // No "toggle whatever it is now": the caller names the state it believes it
  // is moving to, which is what lets `setActionPlanActive` answer 409 when the
  // plan is already there instead of silently flipping it back.
  assert.equal(toggleSchema.safeParse({ reason: "Motivo" }).success, false);
  for (const active of ["true", "false", 1, 0, null, "", "si"]) {
    assert.equal(
      toggleSchema.safeParse({ active, reason: "Motivo" }).success,
      false,
      `active=${JSON.stringify(active)}`,
    );
  }
  for (const active of [true, false]) {
    assert.equal(toggleSchema.parse({ active, reason: "Motivo" }).active, active);
  }
});

test("the motive is bounded at exactly MAX_REASON_LENGTH, measured after trimming", () => {
  const atLimit = "m".repeat(MAX_REASON_LENGTH);
  assert.equal(toggleSchema.parse({ active: true, reason: atLimit }).reason, atLimit);
  assert.equal(
    toggleSchema.safeParse({ active: true, reason: "m".repeat(MAX_REASON_LENGTH + 1) }).success,
    false,
  );
  // Padding is not length: a motive at the limit inside surrounding whitespace
  // is accepted, because the bound applies to what actually gets stored.
  assert.equal(
    toggleSchema.parse({ active: true, reason: `  ${atLimit}  ` }).reason,
    atLimit,
  );
});

test("the body is strict, so the actor cannot be supplied by the caller", () => {
  // `actorId`/`actorName`/`actorEmail` are taken from the locked user row and
  // the token inside the transaction. A lax schema would let a client post its
  // own and sign someone else's name to the transition.
  for (const extra of [
    { actorId: randomUUID() },
    { actorName: "Otra persona" },
    { actorEmail: "otra@ejemplo.ec" },
    { planId: randomUUID() },
    { createdAt: new Date().toISOString() },
  ]) {
    assert.equal(
      toggleSchema.safeParse({ active: true, reason: "Motivo", ...extra }).success,
      false,
      JSON.stringify(extra),
    );
  }
});
