import { and, eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpFindings, rgdpPlans } from "../../db/schema/rgdp.js";
import { NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type FindingInput = {
  component: "LEGAL" | "OPERACIONAL" | "AMBIENTAL";
  nudosCriticos: string;
  alarmas: string;
  riesgos: string;
  propuestasSolucion: string;
};

export async function createFinding(planId: string, actorId: string, input: FindingInput) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const [plan] = await tx.select({ id: rgdpPlans.id }).from(rgdpPlans).where(eq(rgdpPlans.id, planId)).limit(1);
    if (!plan) throw NotFound("Plan not found");
    const [row] = await tx
      .insert(rgdpFindings)
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

export const getFindingsByPlan = (planId: string) =>
  getDb().select().from(rgdpFindings).where(eq(rgdpFindings.planId, planId)).orderBy(desc(rgdpFindings.createdAt));

export async function updateFinding(
  findingId: string,
  planId: string,
  input: FindingInput,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const [row] = await tx
      .update(rgdpFindings)
      .set(input)
      .where(and(eq(rgdpFindings.id, findingId), eq(rgdpFindings.planId, planId)))
      .returning();
    if (!row) throw NotFound("Finding not found in this plan");
    return row;
  });
}

export async function deleteFinding(findingId: string, planId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const deleted = await tx
      .delete(rgdpFindings)
      .where(and(eq(rgdpFindings.id, findingId), eq(rgdpFindings.planId, planId)))
      .returning({ id: rgdpFindings.id });
    if (deleted.length !== 1) throw NotFound("Finding not found in this plan");
    return deleted[0];
  });
}
