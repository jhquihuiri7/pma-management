import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pglpMonthlyGenerations, pglpPlanItems } from "../../db/schema/pglp.js";

export type Entry = { planItemId: string; periodKey: string; generationKg: number };

export async function getGenerations(planId: string) {
  return getDb()
    .select({
      planItemId: pglpMonthlyGenerations.planItemId,
      periodKey: pglpMonthlyGenerations.periodKey,
      generationKg: pglpMonthlyGenerations.generationKg,
      updatedAt: pglpMonthlyGenerations.updatedAt,
    })
    .from(pglpMonthlyGenerations)
    .innerJoin(pglpPlanItems, eq(pglpMonthlyGenerations.planItemId, pglpPlanItems.id))
    .where(eq(pglpPlanItems.planId, planId));
}

export async function setGeneration(entry: Entry) {
  await getDb()
    .insert(pglpMonthlyGenerations)
    .values({
      planItemId: entry.planItemId,
      periodKey: entry.periodKey,
      generationKg: String(entry.generationKg),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pglpMonthlyGenerations.planItemId, pglpMonthlyGenerations.periodKey],
      set: { generationKg: String(entry.generationKg), updatedAt: new Date() },
    });
}

export async function bulkSetGenerations(entries: Entry[]) {
  for (const e of entries) await setGeneration(e);
}
