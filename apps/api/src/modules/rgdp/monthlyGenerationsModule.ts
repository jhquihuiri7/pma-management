import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpMonthlyGenerations, rgdpPlanItems } from "../../db/schema/rgdp.js";

export type Entry = { planItemId: string; periodKey: string; generationKg: number };

export async function getGenerations(planId: string) {
  return getDb()
    .select({
      planItemId: rgdpMonthlyGenerations.planItemId,
      periodKey: rgdpMonthlyGenerations.periodKey,
      generationKg: rgdpMonthlyGenerations.generationKg,
      updatedAt: rgdpMonthlyGenerations.updatedAt,
    })
    .from(rgdpMonthlyGenerations)
    .innerJoin(rgdpPlanItems, eq(rgdpMonthlyGenerations.planItemId, rgdpPlanItems.id))
    .where(eq(rgdpPlanItems.planId, planId));
}

export async function setGeneration(entry: Entry) {
  await getDb()
    .insert(rgdpMonthlyGenerations)
    .values({
      planItemId: entry.planItemId,
      periodKey: entry.periodKey,
      generationKg: String(entry.generationKg),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rgdpMonthlyGenerations.planItemId, rgdpMonthlyGenerations.periodKey],
      set: { generationKg: String(entry.generationKg), updatedAt: new Date() },
    });
}

export async function bulkSetGenerations(entries: Entry[]) {
  for (const e of entries) await setGeneration(e);
}
