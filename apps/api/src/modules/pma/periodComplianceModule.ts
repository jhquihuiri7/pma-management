import type { PeriodCompliance } from "@pma/types";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaItemAssignments, pmaPeriodCompliance, pmaPlanItems, pmaPlans } from "../../db/schema/pma.js";
import { BadRequest, Forbidden } from "../../lib/errors.js";
import { comparePlanPeriodEntries } from "../shared/planPeriodOrdering.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { canUserAccessPlan } from "./plansModule.js";

export type Status = "C" | "NC+" | "NC-" | "N/A";

export async function getCompliance(planId: string, assignedToUserId?: string) {
  const db = getDb();
  let allowedItemIds: string[] | undefined;
  if (assignedToUserId) {
    const assigned = await db
      .select({ id: pmaPlanItems.id })
      .from(pmaItemAssignments)
      .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
      .where(and(eq(pmaItemAssignments.userId, assignedToUserId), eq(pmaPlanItems.planId, planId)));
    allowedItemIds = [...new Set(assigned.map((row) => row.id))];
    if (allowedItemIds.length === 0) return [];
  }
  const rows = await db
    .select({
      planItemId: pmaPeriodCompliance.planItemId,
      periodKey: pmaPeriodCompliance.periodKey,
      status: pmaPeriodCompliance.status,
      updatedAt: pmaPeriodCompliance.updatedAt,
    })
    .from(pmaPeriodCompliance)
    .innerJoin(pmaPlanItems, eq(pmaPeriodCompliance.planItemId, pmaPlanItems.id))
    .where(allowedItemIds
      ? and(eq(pmaPlanItems.planId, planId), inArray(pmaPlanItems.id, allowedItemIds))
      : eq(pmaPlanItems.planId, planId));
  return rows.map((row) => toComplianceApi(planId, row));
}

export async function setCompliance(
  planId: string,
  planItemId: string,
  periodKey: string,
  status: Status,
  actorId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const plan = await assertPlanItems(tx, planId, [planItemId]);
    assertPeriodKey(plan, periodKey);
    const [row] = await tx
      .insert(pmaPeriodCompliance)
      .values({ planItemId, periodKey, status, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [pmaPeriodCompliance.planItemId, pmaPeriodCompliance.periodKey],
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
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const plan = await assertPlanItems(tx, planId, orderedEntries.map((entry) => entry.planItemId));
    for (const periodKey of new Set(orderedEntries.map((entry) => entry.periodKey))) {
      assertPeriodKey(plan, periodKey);
    }
    let updated = 0;
    for (const entry of orderedEntries) {
      const rows = await tx
        .insert(pmaPeriodCompliance)
        .values({ ...entry, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [pmaPeriodCompliance.planItemId, pmaPeriodCompliance.periodKey],
          set: { status: entry.status, updatedAt: new Date() },
        })
        .returning({ planItemId: pmaPeriodCompliance.planItemId });
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
    .select({ reportPer: pmaPlans.reportPer, startDate: pmaPlans.startDate, createdAt: pmaPlans.createdAt })
    .from(pmaPlans)
    .where(eq(pmaPlans.id, planId))
    .limit(1);
  if (!plan) throw BadRequest("El plan no existe");
  const rows = uniqueIds.length === 0 ? [] : await tx
      .select({ id: pmaPlanItems.id })
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.planId, planId), inArray(pmaPlanItems.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) {
    throw BadRequest("One or more plan items do not belong to the requested plan");
  }
  return plan;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function assertPeriodKey(
  plan: { reportPer: string; startDate: string | null; createdAt: Date },
  periodKey: string,
): void {
  const blockSize = plan.reportPer === "2 años" ? 24 : plan.reportPer === "1 año" ? 12 : plan.reportPer === "6 meses" ? 6 : 0;
  if (!blockSize) throw BadRequest(`Periodo de reporte no soportado: ${plan.reportPer}`);
  const start = plan.startDate ? /^([0-9]{4})-([0-9]{2})-[0-9]{2}$/.exec(plan.startDate) : null;
  const origin = start
    ? { year: Number(start[1]), month: Number(start[2]) }
    : businessMonth(plan.createdAt);
  const current = businessMonth(new Date());
  const currentDiff = (current.year - origin.year) * 12 + current.month - origin.month;
  if (currentDiff < 0) throw BadRequest("El período del plan aún no ha iniciado");

  const valid = new Set<string>();
  for (let block = 0; block <= Math.floor(currentDiff / blockSize); block++) {
    const startDate = new Date(Date.UTC(origin.year, origin.month - 1 + block * blockSize, 1));
    const endDate = new Date(Date.UTC(origin.year, origin.month - 1 + (block + 1) * blockSize - 1, 1));
    const startLabel = MONTHS_ES[startDate.getUTCMonth()];
    const endLabel = MONTHS_ES[endDate.getUTCMonth()];
    valid.add(startDate.getUTCFullYear() === endDate.getUTCFullYear()
      ? `${startLabel}-${endLabel} ${endDate.getUTCFullYear()}`
      : `${startLabel} ${startDate.getUTCFullYear()}-${endLabel} ${endDate.getUTCFullYear()}`);
  }
  if (!valid.has(periodKey)) throw BadRequest("periodKey no pertenece a un período habilitado del plan");
}

function businessMonth(value: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Galapagos",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
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
