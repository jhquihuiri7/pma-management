import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpMonthlyGenerations,
  rgdpItemAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../../db/schema/rgdp.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  calculateAnnualGenerationTotal,
  currentMonthKey,
  exceedsAnnualGenerationLimit,
  validateMonthlyGenerationPeriod,
} from "./monthlyGenerationPolicy.js";
import { toMonthlyGenerationApi } from "./serializers.js";
import { isReporterAssignedToItem } from "./planItemsModule.js";
import { comparePlanPeriodEntries } from "../shared/planPeriodOrdering.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type Entry = { planItemId: string; periodKey: string; generationKg: number };
type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function getGenerations(planId: string, assignedToUserId?: string) {
  const db = getDb();
  let allowedItemIds: string[] | null = null;
  if (assignedToUserId) {
    const assigned = await db
      .select({ planItemId: rgdpItemAssignments.planItemId })
      .from(rgdpItemAssignments)
      .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
      .where(
        and(
          eq(rgdpItemAssignments.userId, assignedToUserId),
          eq(rgdpPlanItems.planId, planId)
        )
      );
    allowedItemIds = assigned.map((row) => row.planItemId);
    if (allowedItemIds.length === 0) return [];
  }
  const rows = await db
    .select({
      planItemId: rgdpMonthlyGenerations.planItemId,
      periodKey: rgdpMonthlyGenerations.periodKey,
      generationKg: rgdpMonthlyGenerations.generationKg,
      updatedAt: rgdpMonthlyGenerations.updatedAt,
    })
    .from(rgdpMonthlyGenerations)
    .innerJoin(rgdpPlanItems, eq(rgdpMonthlyGenerations.planItemId, rgdpPlanItems.id))
    .where(
      allowedItemIds
        ? and(eq(rgdpPlanItems.planId, planId), inArray(rgdpPlanItems.id, allowedItemIds))
        : eq(rgdpPlanItems.planId, planId)
    );
  return rows.map((row) => toMonthlyGenerationApi(row, planId));
}

export async function setGeneration(planId: string, entry: Entry, actorId: string) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN", "REPORTER"]);
    return setGenerationInTransaction(tx, planId, entry, actor);
  });
}

export async function bulkSetGenerations(planId: string, entries: Entry[], actorId: string) {
  if (entries.length === 0) throw BadRequest("Se requiere al menos una entrada");
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.planItemId}:${entry.periodKey}`;
      if (seen.has(key)) throw BadRequest("No se puede repetir el mismo ítem y período");
      seen.add(key);
    }

    // Lock every affected item in one canonical order. This serializes bulk
    // requests with each other and with the single-entry endpoint without
    // creating an item-A/item-B deadlock.
    const itemIds = [...new Set(entries.map((entry) => entry.planItemId))].sort();
    const lockedItems = itemIds.length === 0
      ? []
      : await tx
          .select()
          .from(rgdpPlanItems)
          .where(and(eq(rgdpPlanItems.planId, planId), inArray(rgdpPlanItems.id, itemIds)))
          .orderBy(asc(rgdpPlanItems.id))
          .for("update");
    if (lockedItems.length !== itemIds.length) {
      throw NotFound("Uno o más ítems no pertenecen al proyecto");
    }

    const [plan] = await tx.select().from(rgdpPlans).where(eq(rgdpPlans.id, planId)).limit(1);
    if (!plan) throw NotFound("Proyecto no encontrado");
    const planStartMonth = plan.startDate?.slice(0, 7) ?? currentMonthKey(plan.createdAt);
    for (const entry of entries) {
      try {
        validateMonthlyGenerationPeriod({ periodKey: entry.periodKey, planStartMonth });
      } catch (error) {
        throw BadRequest((error as Error).message);
      }
    }

    const existingRows = itemIds.length === 0
      ? []
      : await tx
          .select({
            planItemId: rgdpMonthlyGenerations.planItemId,
            periodKey: rgdpMonthlyGenerations.periodKey,
            generationKg: rgdpMonthlyGenerations.generationKg,
          })
          .from(rgdpMonthlyGenerations)
          .where(inArray(rgdpMonthlyGenerations.planItemId, itemIds));
    const finalByItem = new Map<string, Map<string, number>>();
    for (const row of existingRows) {
      const periods = finalByItem.get(row.planItemId) ?? new Map<string, number>();
      periods.set(row.periodKey, Number(row.generationKg));
      finalByItem.set(row.planItemId, periods);
    }
    for (const entry of entries) {
      const periods = finalByItem.get(entry.planItemId) ?? new Map<string, number>();
      periods.set(entry.periodKey, entry.generationKg);
      finalByItem.set(entry.planItemId, periods);
    }

    const itemById = new Map(lockedItems.map((item) => [item.id, item]));
    const affectedYears = new Map<string, Set<string>>();
    for (const entry of entries) {
      const years = affectedYears.get(entry.planItemId) ?? new Set<string>();
      years.add(entry.periodKey.slice(0, 4));
      affectedYears.set(entry.planItemId, years);
    }
    for (const [itemId, years] of affectedYears) {
      const item = itemById.get(itemId)!;
      const annualLimitKg = item.annualGenerationKg == null
        ? Number.NaN
        : Number(item.annualGenerationKg);
      if (!Number.isFinite(annualLimitKg) || annualLimitKg < 0) {
        throw BadRequest("El ítem no tiene una generación anual válida");
      }
      const periods = finalByItem.get(itemId) ?? new Map<string, number>();
      for (const year of years) {
        const records = [...periods]
          .filter(([periodKey]) => periodKey.startsWith(`${year}-`))
          .map(([periodKey, generationKg]) => ({ periodKey, generationKg }));
        const [first, ...rest] = records;
        const annualTotalKg = first
          ? calculateAnnualGenerationTotal({
              periodKey: first.periodKey,
              generationKg: first.generationKg,
              records: rest,
            })
          : 0;
        if (exceedsAnnualGenerationLimit(annualTotalKg, annualLimitKg)) {
          throw BadRequest(
            `La suma mensual de ${year} (${annualTotalKg.toFixed(3)} kg) ` +
              `supera la generación anual declarada (${annualLimitKg.toFixed(3)} kg)`
          );
        }
      }
    }

    const records: Awaited<ReturnType<typeof setGenerationInTransaction>>[] = new Array(entries.length);
    const orderedEntries = entries
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .sort((a, b) => comparePlanPeriodEntries(a.entry, b.entry));
    for (const { entry, originalIndex } of orderedEntries) {
      const [row] = await tx
        .insert(rgdpMonthlyGenerations)
        .values({
          planItemId: entry.planItemId,
          periodKey: entry.periodKey,
          generationKg: entry.generationKg.toFixed(3),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [rgdpMonthlyGenerations.planItemId, rgdpMonthlyGenerations.periodKey],
          set: { generationKg: entry.generationKg.toFixed(3), updatedAt: new Date() },
        })
        .returning();
      if (!row) throw new Error("Monthly generation upsert returned no row");
      records[originalIndex] = toMonthlyGenerationApi(row, planId);
    }
    return records;
  });
}

async function setGenerationInTransaction(
  tx: DbTransaction,
  planId: string,
  entry: Entry,
  actor: { id: string; role: "ADMIN" | "REPORTER" | "VIEWER" },
) {
  // Locking the item serializes every monthly update for it, including the
  // first insert of a year where no generation row exists yet.
  const itemRows = await tx
    .select()
    .from(rgdpPlanItems)
    .where(and(eq(rgdpPlanItems.id, entry.planItemId), eq(rgdpPlanItems.planId, planId)))
    .limit(1)
    .for("update");
  const item = itemRows[0];
  if (!item) throw NotFound("El ítem no pertenece al proyecto");
  if (
    actor.role === "REPORTER" &&
    !(await isReporterAssignedToItem(planId, entry.planItemId, actor.id, tx))
  ) {
    throw Forbidden("No tienes acceso a este ítem");
  }

  const planRows = await tx.select().from(rgdpPlans).where(eq(rgdpPlans.id, planId)).limit(1);
  const plan = planRows[0];
  if (!plan) throw NotFound("Proyecto no encontrado");

  const planStartMonth = plan.startDate?.slice(0, 7) ?? currentMonthKey(plan.createdAt);
  try {
    validateMonthlyGenerationPeriod({
      periodKey: entry.periodKey,
      planStartMonth,
    });
  } catch (error) {
    throw BadRequest((error as Error).message);
  }

  const annualLimitKg = item.annualGenerationKg == null
    ? Number.NaN
    : Number(item.annualGenerationKg);
  if (!Number.isFinite(annualLimitKg) || annualLimitKg < 0) {
    throw BadRequest("El ítem no tiene una generación anual válida");
  }

  const existingRows = await tx
    .select({
      periodKey: rgdpMonthlyGenerations.periodKey,
      generationKg: rgdpMonthlyGenerations.generationKg,
    })
    .from(rgdpMonthlyGenerations)
    .where(eq(rgdpMonthlyGenerations.planItemId, entry.planItemId));
  const annualTotalKg = calculateAnnualGenerationTotal({
    periodKey: entry.periodKey,
    generationKg: entry.generationKg,
    records: existingRows.map((row) => ({
      periodKey: row.periodKey,
      generationKg: Number(row.generationKg),
    })),
  });
  if (exceedsAnnualGenerationLimit(annualTotalKg, annualLimitKg)) {
    throw BadRequest(
      `La suma mensual de ${entry.periodKey.slice(0, 4)} (${annualTotalKg.toFixed(3)} kg) ` +
        `supera la generación anual declarada (${annualLimitKg.toFixed(3)} kg)`
    );
  }

  const [row] = await tx
    .insert(rgdpMonthlyGenerations)
    .values({
      planItemId: entry.planItemId,
      periodKey: entry.periodKey,
      generationKg: entry.generationKg.toFixed(3),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rgdpMonthlyGenerations.planItemId, rgdpMonthlyGenerations.periodKey],
      set: { generationKg: entry.generationKg.toFixed(3), updatedAt: new Date() },
    })
    .returning();
  return toMonthlyGenerationApi(row, planId);
}
