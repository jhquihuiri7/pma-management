import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpFindings } from "../../db/schema/rgdp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";

export type FindingInput = {
  component: "LEGAL" | "OPERACIONAL" | "AMBIENTAL";
  nudosCriticos: string;
  alarmas: string;
  riesgos: string;
  propuestasSolucion: string;
};

export async function createFinding(planId: string, userId: string, userName: string, input: FindingInput) {
  const [row] = await getDb()
    .insert(rgdpFindings)
    .values({
      planId,
      component: input.component,
      nudosCriticos: input.nudosCriticos,
      alarmas: input.alarmas,
      riesgos: input.riesgos,
      propuestasSolucion: input.propuestasSolucion,
      createdBy: userId,
      createdByName: userName,
    })
    .returning();
  return row;
}

export const getFindingsByPlan = (planId: string) =>
  getDb().select().from(rgdpFindings).where(eq(rgdpFindings.planId, planId)).orderBy(desc(rgdpFindings.createdAt));

export async function updateFinding(findingId: string, planId: string, input: FindingInput) {
  const rows = await getDb().select().from(rgdpFindings).where(eq(rgdpFindings.id, findingId)).limit(1);
  const existing = rows[0];
  if (!existing) throw NotFound("Finding not found");
  if (existing.planId !== planId) throw Forbidden();
  const [row] = await getDb().update(rgdpFindings).set(input).where(eq(rgdpFindings.id, findingId)).returning();
  return row;
}

export async function deleteFinding(findingId: string, planId: string) {
  const rows = await getDb().select().from(rgdpFindings).where(eq(rgdpFindings.id, findingId)).limit(1);
  const existing = rows[0];
  if (!existing) throw NotFound("Finding not found");
  if (existing.planId !== planId) throw Forbidden();
  await getDb().delete(rgdpFindings).where(eq(rgdpFindings.id, findingId));
}
