import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaActionPlanActivations, pmaPlans } from "../../db/schema/pma.js";
import { Conflict, Forbidden, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { canUserAccessPlan } from "./plansModule.js";
import type {
  PmaActionPlanActivation,
  PmaActionPlanPayload,
  PmaActionPlanResult,
} from "@pma/types";

type Actor = { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER"; email: string };

/** Long enough for a real justification, short enough that the history stays
 *  readable as a list. */
export const MAX_REASON_LENGTH = 1000;

type ActivationRow = typeof pmaActionPlanActivations.$inferSelect;

function toApi(row: ActivationRow): PmaActionPlanActivation {
  return {
    id: row.id,
    planId: row.planId,
    active: row.active,
    reason: row.reason,
    actorId: row.actorId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
  };
}

/**
 * Current flag plus the full transition history, newest first. The list is
 * never filtered down to activations: a deactivation and the motive behind it
 * are as much a part of the record as the activation it closed.
 */
export async function getActionPlan(planId: string, actor: Actor): Promise<PmaActionPlanPayload> {
  const db = getDb();
  const [plan] = await db
    .select({ id: pmaPlans.id, actionPlanActive: pmaPlans.actionPlanActive })
    .from(pmaPlans)
    .where(eq(pmaPlans.id, planId))
    .limit(1);
  if (!plan) throw NotFound("El plan no existe");
  if (!(await canUserAccessPlan(planId, actor))) throw Forbidden("No tienes acceso a este plan");

  const rows = await db
    .select()
    .from(pmaActionPlanActivations)
    .where(eq(pmaActionPlanActivations.planId, planId))
    .orderBy(desc(pmaActionPlanActivations.createdAt));

  return { planId: plan.id, active: plan.actionPlanActive, activations: rows.map(toApi) };
}

export type SetActionPlanInput = {
  planId: string;
  active: boolean;
  /** Already trimmed and non-empty by the time it gets here. */
  reason: string;
};

/**
 * Flip the plan's Plan de Acción and record the transition that did it, in one
 * transaction: the flag on `pma_plans` is only ever the denormalized head of
 * this history, so a flag without its row — or a row without its flag — would
 * leave the plan in a state nobody signed for.
 *
 * The plan row is locked before the current value is read, so two operators
 * toggling at once serialize instead of both appending a transition from the
 * same starting state. Asking for the state the plan is already in is a
 * conflict rather than a no-op: the caller believed it was changing something,
 * and a silent success would put a motive on record for a transition that
 * never happened.
 */
export async function setActionPlanActive(
  input: SetActionPlanInput,
  actor: Actor,
): Promise<PmaActionPlanResult> {
  return getDb().transaction(async (tx) => {
    const dbActor = await lockAndAssertActor(tx, actor.sub, "pma", ["ADMIN", "VIEWER"]);
    const [plan] = await tx
      .select({ id: pmaPlans.id, actionPlanActive: pmaPlans.actionPlanActive })
      .from(pmaPlans)
      .where(eq(pmaPlans.id, input.planId))
      .limit(1)
      .for("update");
    if (!plan) throw NotFound("El plan no existe");
    // Re-checked against the freshly locked role, not the JWT snapshot the
    // route was admitted with.
    if (!(await canUserAccessPlan(input.planId, { sub: dbActor.id, role: dbActor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    if (plan.actionPlanActive === input.active) {
      throw Conflict(
        input.active
          ? "El plan de acción de este plan ya está activo"
          : "El plan de acción de este plan ya está inactivo",
      );
    }

    await tx
      .update(pmaPlans)
      .set({ actionPlanActive: input.active, updatedAt: new Date() })
      .where(eq(pmaPlans.id, input.planId));

    const [row] = await tx
      .insert(pmaActionPlanActivations)
      .values({
        planId: input.planId,
        active: input.active,
        reason: input.reason,
        actorId: dbActor.id,
        // Name from the locked user row, address from the token: the claim is
        // rehydrated on every request, and `lockAndAssertActor` returns no
        // email of its own.
        actorName: dbActor.name,
        actorEmail: actor.email,
      })
      .returning();
    if (!row) throw new Error("Action plan activation insert returned no row");

    return { ok: true, active: input.active, activation: toApi(row) };
  });
}
