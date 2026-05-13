import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaPeriodCompliance, pmaPlanItems } from "../../db/schema/pma.js";

export type Status = "C" | "NC+" | "NC-" | "N/A";

export async function getCompliance(planId: string) {
  const db = getDb();
  return db
    .select({
      planItemId: pmaPeriodCompliance.planItemId,
      periodKey: pmaPeriodCompliance.periodKey,
      status: pmaPeriodCompliance.status,
      updatedAt: pmaPeriodCompliance.updatedAt,
    })
    .from(pmaPeriodCompliance)
    .innerJoin(pmaPlanItems, eq(pmaPeriodCompliance.planItemId, pmaPlanItems.id))
    .where(eq(pmaPlanItems.planId, planId));
}

export async function setCompliance(
  planItemId: string,
  periodKey: string,
  status: Status
) {
  const db = getDb();
  await db
    .insert(pmaPeriodCompliance)
    .values({ planItemId, periodKey, status, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [pmaPeriodCompliance.planItemId, pmaPeriodCompliance.periodKey],
      set: { status, updatedAt: new Date() },
    });
}

export async function bulkSetCompliance(
  entries: Array<{ planItemId: string; periodKey: string; status: Status }>
) {
  for (const e of entries) {
    await setCompliance(e.planItemId, e.periodKey, e.status);
  }
}
