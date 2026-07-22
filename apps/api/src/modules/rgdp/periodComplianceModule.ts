import type { PeriodCompliance } from "@pma/types";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpItemAssignments,
  rgdpPeriodCompliance,
  rgdpPlanItems,
  rgdpPlans,
} from "../../db/schema/rgdp.js";
import { BadRequest } from "../../lib/errors.js";
import { comparePlanPeriodEntries } from "../shared/planPeriodOrdering.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { currentMonthKey, validateMonthlyGenerationPeriod } from "./monthlyGenerationPolicy.js";

export type Status = "C" | "NC+" | "NC-" | "N/A";

export async function getCompliance(planId: string, assignedToUserId?: string) {
  const db = getDb();
  let allowedItemIds: string[] | null = null;
  if (assignedToUserId) {
    const assignments = await db
      .select({ planItemId: rgdpItemAssignments.planItemId })
      .from(rgdpItemAssignments)
      .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
      .where(
        and(
          eq(rgdpItemAssignments.userId, assignedToUserId),
          eq(rgdpPlanItems.planId, planId)
        )
      );
    allowedItemIds = assignments.map((row) => row.planItemId);
    if (allowedItemIds.length === 0) return [];
  }
  const rows = await db
    .select({
      planItemId: rgdpPeriodCompliance.planItemId,
      periodKey: rgdpPeriodCompliance.periodKey,
      status: rgdpPeriodCompliance.status,
      updatedAt: rgdpPeriodCompliance.updatedAt,
    })
    .from(rgdpPeriodCompliance)
    .innerJoin(rgdpPlanItems, eq(rgdpPeriodCompliance.planItemId, rgdpPlanItems.id))
    .where(
      allowedItemIds
        ? and(eq(rgdpPlanItems.planId, planId), inArray(rgdpPlanItems.id, allowedItemIds))
        : eq(rgdpPlanItems.planId, planId)
    );
  return rows.map((row) => toComplianceApi(planId, row));
}

export async function setCompliance(
  planId: string,
  planItemId: string,
  periodKey: string,
  status: Status,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const plan = await assertPlanItems(tx, planId, [planItemId]);
    assertPeriod(plan, periodKey);
    const [row] = await tx
      .insert(rgdpPeriodCompliance)
      .values({ planItemId, periodKey, status, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [rgdpPeriodCompliance.planItemId, rgdpPeriodCompliance.periodKey],
        set: { status, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Compliance upsert returned no row");
    return toComplianceApi(planId, row);
  });
}

export async function bulkSetCompliance(
  planId: string,
  entries: Array<{ planItemId: string; periodKey: string; status: Status }>,
  actorId: string,
) {
  if (entries.length === 0) throw BadRequest("Se requiere al menos una entrada");
  const keys = entries.map((entry) => `${entry.planItemId}:${entry.periodKey}`);
  if (new Set(keys).size !== keys.length) throw BadRequest("La carga contiene entradas de cumplimiento duplicadas");
  const orderedEntries = [...entries].sort(comparePlanPeriodEntries);
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const plan = await assertPlanItems(tx, planId, orderedEntries.map((entry) => entry.planItemId));
    for (const periodKey of new Set(orderedEntries.map((entry) => entry.periodKey))) assertPeriod(plan, periodKey);
    let updated = 0;
    for (const entry of orderedEntries) {
      const rows = await tx
        .insert(rgdpPeriodCompliance)
        .values({ ...entry, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [rgdpPeriodCompliance.planItemId, rgdpPeriodCompliance.periodKey],
          set: { status: entry.status, updatedAt: new Date() },
        })
        .returning({ planItemId: rgdpPeriodCompliance.planItemId });
      if (rows.length !== 1) throw new Error("Compliance upsert returned no row");
      updated += 1;
    }
    return updated;
  });
}

async function assertPlanItems(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  planId: string,
  planItemIds: string[]
) {
  const uniqueIds = [...new Set(planItemIds)];
  const [plan] = await tx
    .select({ startDate: rgdpPlans.startDate, createdAt: rgdpPlans.createdAt })
    .from(rgdpPlans)
    .where(eq(rgdpPlans.id, planId))
    .limit(1);
  if (!plan) throw BadRequest("El proyecto no existe");
  const rows = uniqueIds.length === 0 ? [] : await tx
    .select({ id: rgdpPlanItems.id })
    .from(rgdpPlanItems)
    .where(and(eq(rgdpPlanItems.planId, planId), inArray(rgdpPlanItems.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) {
    throw BadRequest("One or more plan items do not belong to the requested plan");
  }
  return plan;
}

function assertPeriod(plan: { startDate: string | null; createdAt: Date }, periodKey: string): void {
  try {
    validateMonthlyGenerationPeriod({
      periodKey,
      planStartMonth: plan.startDate?.slice(0, 7) ?? currentMonthKey(plan.createdAt),
    });
  } catch (error) {
    throw BadRequest(error instanceof Error ? error.message : "Período inválido");
  }
}

function toComplianceApi(
  planId: string,
  row: { planItemId: string; periodKey: string; status: Status; updatedAt: Date | string },
): PeriodCompliance {
  return {
    id: `${row.planItemId}:${row.periodKey}`,
    planId,
    planItemId: row.planItemId,
    periodKey: row.periodKey,
    status: row.status,
    updatedAt: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString(),
  };
}
