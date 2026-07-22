import { and, eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaFindings } from "../../db/schema/pma.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { canUserAccessPlan } from "./plansModule.js";

export type FindingInput = {
  component: "LEGAL" | "OPERACIONAL" | "AMBIENTAL";
  nudosCriticos: string;
  alarmas: string;
  riesgos: string;
  propuestasSolucion: string;
};

export async function createFinding(planId: string, actorId: string, input: FindingInput) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const [row] = await tx
      .insert(pmaFindings)
      .values({
        planId,
        component: input.component,
        nudosCriticos: input.nudosCriticos,
        alarmas: input.alarmas,
        riesgos: input.riesgos,
        propuestasSolucion: input.propuestasSolucion,
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning();
    if (!row) throw new Error("Finding insert returned no row");
    return row;
  });
}

export async function getFindingsByPlan(planId: string) {
  const db = getDb();
  return db
    .select()
    .from(pmaFindings)
    .where(eq(pmaFindings.planId, planId))
    .orderBy(desc(pmaFindings.createdAt));
}

export async function updateFinding(
  findingId: string,
  planId: string,
  input: FindingInput,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const [row] = await tx
      .update(pmaFindings)
      .set(input)
      .where(and(eq(pmaFindings.id, findingId), eq(pmaFindings.planId, planId)))
      .returning();
    if (!row) throw NotFound("Finding not found in this plan");
    return row;
  });
}

export async function deleteFinding(findingId: string, planId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    const deleted = await tx
      .delete(pmaFindings)
      .where(and(eq(pmaFindings.id, findingId), eq(pmaFindings.planId, planId)))
      .returning({ id: pmaFindings.id });
    if (deleted.length !== 1) throw NotFound("Finding not found in this plan");
    return deleted[0];
  });
}
