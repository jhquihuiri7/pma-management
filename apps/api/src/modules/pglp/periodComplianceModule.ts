import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pglpPeriodCompliance, pglpPlanItems } from "../../db/schema/pglp.js";

export type Status = "C" | "NC+" | "NC-" | "N/A";

export const getCompliance = (planId: string) =>
  getDb()
    .select({
      planItemId: pglpPeriodCompliance.planItemId,
      periodKey: pglpPeriodCompliance.periodKey,
      status: pglpPeriodCompliance.status,
      updatedAt: pglpPeriodCompliance.updatedAt,
    })
    .from(pglpPeriodCompliance)
    .innerJoin(pglpPlanItems, eq(pglpPeriodCompliance.planItemId, pglpPlanItems.id))
    .where(eq(pglpPlanItems.planId, planId));

export async function setCompliance(planItemId: string, periodKey: string, status: Status) {
  await getDb()
    .insert(pglpPeriodCompliance)
    .values({ planItemId, periodKey, status, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [pglpPeriodCompliance.planItemId, pglpPeriodCompliance.periodKey],
      set: { status, updatedAt: new Date() },
    });
}

export async function bulkSetCompliance(entries: Array<{ planItemId: string; periodKey: string; status: Status }>) {
  for (const e of entries) await setCompliance(e.planItemId, e.periodKey, e.status);
}
