import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpPeriodCompliance, rgdpPlanItems } from "../../db/schema/rgdp.js";

export type Status = "C" | "NC+" | "NC-" | "N/A";

export const getCompliance = (planId: string) =>
  getDb()
    .select({
      planItemId: rgdpPeriodCompliance.planItemId,
      periodKey: rgdpPeriodCompliance.periodKey,
      status: rgdpPeriodCompliance.status,
      updatedAt: rgdpPeriodCompliance.updatedAt,
    })
    .from(rgdpPeriodCompliance)
    .innerJoin(rgdpPlanItems, eq(rgdpPeriodCompliance.planItemId, rgdpPlanItems.id))
    .where(eq(rgdpPlanItems.planId, planId));

export async function setCompliance(planItemId: string, periodKey: string, status: Status) {
  await getDb()
    .insert(rgdpPeriodCompliance)
    .values({ planItemId, periodKey, status, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [rgdpPeriodCompliance.planItemId, rgdpPeriodCompliance.periodKey],
      set: { status, updatedAt: new Date() },
    });
}

export async function bulkSetCompliance(entries: Array<{ planItemId: string; periodKey: string; status: Status }>) {
  for (const e of entries) await setCompliance(e.planItemId, e.periodKey, e.status);
}
