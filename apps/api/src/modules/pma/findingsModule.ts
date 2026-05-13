import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaFindings } from "../../db/schema/pma.js";
import { Forbidden, NotFound } from "../../lib/errors.js";

export type FindingInput = {
  component: "LEGAL" | "OPERACIONAL" | "AMBIENTAL";
  nudosCriticos: string;
  alarmas: string;
  riesgos: string;
  propuestasSolucion: string;
};

export async function createFinding(planId: string, userId: string, userName: string, input: FindingInput) {
  const db = getDb();
  const [row] = await db
    .insert(pmaFindings)
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

export async function getFindingsByPlan(planId: string) {
  const db = getDb();
  return db
    .select()
    .from(pmaFindings)
    .where(eq(pmaFindings.planId, planId))
    .orderBy(desc(pmaFindings.createdAt));
}

export async function updateFinding(findingId: string, planId: string, input: FindingInput) {
  const db = getDb();
  const rows = await db.select().from(pmaFindings).where(eq(pmaFindings.id, findingId)).limit(1);
  const existing = rows[0];
  if (!existing) throw NotFound("Finding not found");
  if (existing.planId !== planId) throw Forbidden();
  const [row] = await db
    .update(pmaFindings)
    .set(input)
    .where(eq(pmaFindings.id, findingId))
    .returning();
  return row;
}

export async function deleteFinding(findingId: string, planId: string) {
  const db = getDb();
  const rows = await db.select().from(pmaFindings).where(eq(pmaFindings.id, findingId)).limit(1);
  const existing = rows[0];
  if (!existing) throw NotFound("Finding not found");
  if (existing.planId !== planId) throw Forbidden();
  await db.delete(pmaFindings).where(eq(pmaFindings.id, findingId));
}
