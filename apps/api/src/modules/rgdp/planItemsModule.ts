import { eq, and, asc, ne, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpPlans,
  rgdpPlanItems,
  rgdpItemAssignments,
  rgdpPlanAssignments,
} from "../../db/schema/rgdp.js";
import { BadRequest, NotFound, Forbidden, Conflict } from "../../lib/errors.js";
import { toRgdpPlanItemApi } from "./serializers.js";
import { assertAssignableUser, assertAssignableUsers } from "../shared/assignmentPolicy.js";
import { lockPlanDirections, normalizeDirection } from "../shared/directionLock.js";
import { enqueueEvidenceCleanupForItem } from "../shared/storageCleanup.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type RgdpPlanItemCreateInput = {
  item: string;
  subplan: string;
  direccion?: string;
  environmental_activity?: string;
  identified_environmental_impact?: string;
  proposed_measure?: string;
  indicator?: string;
  verification_method?: string;
  periodicity?: string;
  budget?: number;
  report_per: "6 meses" | "1 año" | "2 años";
  observation?: string;
  // Waste fields
  wasteCode?: string;
  wasteName?: string;
  wasteDescription?: string;
  crtib?: string;
  annualGenerationKg?: number;
  generationOrigin?: string;
  selfManagement?: boolean;
};

export type RgdpPlanItemUpdateInput = Partial<RgdpPlanItemCreateInput>;

function toCreateDbValues(i: RgdpPlanItemCreateInput) {
  return {
    item: i.item,
    subplan: i.subplan,
    direccion: normalizeDirection(i.direccion) || null,
    environmentalActivity: i.environmental_activity ?? "",
    identifiedEnvironmentalImpact: i.identified_environmental_impact ?? "",
    proposedMeasure: i.proposed_measure ?? "",
    indicator: i.indicator ?? "",
    verificationMethod: i.verification_method ?? "",
    periodicity: i.periodicity ?? "",
    budget: String(i.budget ?? 0),
    reportPer: i.report_per,
    observation: i.observation ?? null,
    wasteCode: i.wasteCode ?? null,
    wasteName: i.wasteName ?? null,
    wasteDescription: i.wasteDescription ?? null,
    crtib: i.crtib ?? null,
    annualGenerationKg: i.annualGenerationKg != null ? String(i.annualGenerationKg) : null,
    generationOrigin: i.generationOrigin?.trim() || null,
    selfManagement: Boolean(i.selfManagement),
  };
}

// PATCH requests must preserve omitted fields. In particular, coercing an
// absent boolean to false or an absent number to zero would silently destroy
// persisted data. An explicitly empty direction is the supported way to clear
// the direction group.
function toUpdateDbValues(i: RgdpPlanItemUpdateInput) {
  return {
    item: i.item,
    subplan: i.subplan,
    direccion:
      i.direccion !== undefined ? normalizeDirection(i.direccion) || null : undefined,
    environmentalActivity: i.environmental_activity,
    identifiedEnvironmentalImpact: i.identified_environmental_impact,
    proposedMeasure: i.proposed_measure,
    indicator: i.indicator,
    verificationMethod: i.verification_method,
    periodicity: i.periodicity,
    budget: i.budget !== undefined ? String(i.budget) : undefined,
    reportPer: i.report_per,
    observation: i.observation,
    wasteCode: i.wasteCode,
    wasteName: i.wasteName,
    wasteDescription: i.wasteDescription,
    crtib: i.crtib,
    annualGenerationKg:
      i.annualGenerationKg !== undefined ? String(i.annualGenerationKg) : undefined,
    generationOrigin:
      i.generationOrigin !== undefined ? i.generationOrigin.trim() || null : undefined,
    selfManagement: i.selfManagement,
  };
}

type ReporterAssignment = {
  userId: string;
  category: "Responsable" | "Colaborador";
};

async function serializePlanItems(db: any, rows: Array<typeof rgdpPlanItems.$inferSelect>) {
  if (rows.length === 0) return [];
  const assignments = await db
    .select()
    .from(rgdpItemAssignments)
    .where(inArray(rgdpItemAssignments.planItemId, rows.map((row) => row.id)));
  const byItem = new Map<string, ReporterAssignment[]>();
  for (const assignment of assignments) {
    const current = byItem.get(assignment.planItemId) ?? [];
    current.push({
      userId: assignment.userId,
      category: assignment.category as ReporterAssignment["category"],
    });
    byItem.set(assignment.planItemId, current);
  }
  return rows.map((row) => toRgdpPlanItemApi(row, byItem.get(row.id) ?? []));
}

/**
 * Return the union of reporters already attached to the other items in a
 * direction. If the same user has mixed categories, Responsable wins.
 */
async function direccionReporterUnion(
  db: any,
  planId: string,
  direccion: string,
  excludeItemId?: string
): Promise<ReporterAssignment[]> {
  const filters = [
    eq(rgdpPlanItems.planId, planId),
    eq(rgdpPlanItems.direccion, direccion),
  ];
  if (excludeItemId) filters.push(ne(rgdpPlanItems.id, excludeItemId));
  const rows = await db
    .select({ userId: rgdpItemAssignments.userId, category: rgdpItemAssignments.category })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(and(...filters));
  const union = new Map<string, "Responsable" | "Colaborador">();
  for (const row of rows) {
    if (union.get(row.userId) === "Responsable") continue;
    union.set(row.userId, row.category as "Responsable" | "Colaborador");
  }
  return Array.from(union, ([userId, category]) => ({ userId, category }));
}

/**
 * Make the item-level assignment set and its derived plan-level visibility one
 * atomic write. onConflictDoNothing is intentional: a true explicit plan grant
 * must never be downgraded to a derived false grant.
 */
async function writeItemAssignments(
  db: any,
  planId: string,
  itemId: string,
  reporters: ReporterAssignment[],
  { replace }: { replace: boolean }
) {
  if (replace) {
    await db.delete(rgdpItemAssignments).where(eq(rgdpItemAssignments.planItemId, itemId));
  }
  if (reporters.length === 0) return;
  // Never copy inherited direction grants without checking their current app
  // membership and role in the same serialized transaction.
  await assertAssignableUsers(reporters.map(({ userId }) => userId), "rgdp", ["REPORTER"], db);
  await db
    .insert(rgdpItemAssignments)
    .values(reporters.map(({ userId, category }) => ({ planItemId: itemId, userId, category })))
    .onConflictDoNothing();
  await db
    .insert(rgdpPlanAssignments)
    .values(reporters.map(({ userId }) => ({ planId, userId, explicitAccess: false })))
    .onConflictDoNothing();
}

/** Remove only derived plan grants once their last item assignment disappears. */
async function cleanupOrphanPlanAssignments(db: any, planId: string, userIds: string[]) {
  for (const userId of new Set(userIds)) {
    const remaining = await db
      .select({ id: rgdpItemAssignments.planItemId })
      .from(rgdpItemAssignments)
      .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
      .where(and(eq(rgdpPlanItems.planId, planId), eq(rgdpItemAssignments.userId, userId)))
      .limit(1);
    if (remaining.length === 0) {
      await db
        .delete(rgdpPlanAssignments)
        .where(
          and(
            eq(rgdpPlanAssignments.planId, planId),
            eq(rgdpPlanAssignments.userId, userId),
            eq(rgdpPlanAssignments.explicitAccess, false)
          )
        );
    }
  }
}

export async function createPlanItem(planId: string, input: RgdpPlanItemCreateInput, actorId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const direccion = normalizeDirection(input.direccion);
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    await lockPlanDirections(tx, "rgdp", planId, [direccion]);
    const [plan] = await tx
      .select({ id: rgdpPlans.id, reportPer: rgdpPlans.reportPer })
      .from(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .limit(1)
      .for("update");
    if (!plan) throw NotFound("Plan not found");
    if (input.report_per !== plan.reportPer) {
      throw BadRequest("report_per no coincide con el plan");
    }
    const [row] = await tx
      .insert(rgdpPlanItems)
      .values({ planId, ...toCreateDbValues(input) })
      .returning();
    if (!row) throw new Error("Plan item insert returned no row");
    if (direccion) {
      const reporters = await direccionReporterUnion(tx, planId, direccion, row.id);
      await writeItemAssignments(tx, planId, row.id, reporters, { replace: false });
    }
    const [serialized] = await serializePlanItems(tx, [row]);
    return serialized!;
  });
}

export async function bulkCreatePlanItems(
  planId: string,
  items: RgdpPlanItemCreateInput[],
  actorId: string,
) {
  if (items.length === 0) return [];
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    await lockPlanDirections(tx, "rgdp", planId, items.map((item) => item.direccion));
    const [plan] = await tx
      .select({ id: rgdpPlans.id, reportPer: rgdpPlans.reportPer })
      .from(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .limit(1)
      .for("update");
    if (!plan) throw NotFound("Plan not found");
    if (items.some((item) => item.report_per !== plan.reportPer)) {
      throw BadRequest("Uno o más report_per no coinciden con el plan");
    }
    const rows = await tx
      .insert(rgdpPlanItems)
      .values(items.map((i) => ({ planId, ...toCreateDbValues(i) })))
      .returning();
    if (rows.length !== items.length) {
      throw new Error("Plan item bulk insert returned an incomplete receipt");
    }
    for (const row of rows) {
      const direccion = normalizeDirection(row.direccion);
      if (!direccion) continue;
      const reporters = await direccionReporterUnion(tx, planId, direccion, row.id);
      await writeItemAssignments(tx, planId, row.id, reporters, { replace: false });
    }
    return serializePlanItems(tx, rows);
  });
}

export async function getPlanItems(planId: string, assignedToUserId?: string) {
  const db = getDb();
  let allowedItemIds: string[] | null = null;
  if (assignedToUserId) {
    allowedItemIds = await getReporterAssignedItemIds(planId, assignedToUserId, db);
    if (allowedItemIds.length === 0) return [];
  }
  const items = await db
    .select()
    .from(rgdpPlanItems)
    .where(
      allowedItemIds
        ? and(eq(rgdpPlanItems.planId, planId), inArray(rgdpPlanItems.id, allowedItemIds))
        : eq(rgdpPlanItems.planId, planId)
    )
    .orderBy(asc(rgdpPlanItems.createdAt));
  if (items.length === 0) return [];
  return serializePlanItems(db, items);
}

export async function getReporterAssignedItemIds(
  planId: string,
  userId: string,
  db: any = getDb()
): Promise<string[]> {
  const assigned = await db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(
      and(
        eq(rgdpItemAssignments.userId, userId),
        eq(rgdpPlanItems.planId, planId)
      )
    );
  return assigned.map((row: { planItemId: string }) => row.planItemId);
}

export async function getPlanItemById(itemId: string) {
  const rows = await getDb().select().from(rgdpPlanItems).where(eq(rgdpPlanItems.id, itemId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Exact object-level check used by REPORTER mutations and downloads. Plan
 * access by itself is deliberately insufficient: a reporter can see plan
 * metadata while only being allowed to operate the items assigned to them.
 */
export async function isReporterAssignedToItem(
  planId: string,
  planItemId: string,
  userId: string,
  db: any = getDb()
): Promise<boolean> {
  const rows = await db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(
      and(
        eq(rgdpItemAssignments.userId, userId),
        eq(rgdpItemAssignments.planItemId, planItemId),
        eq(rgdpPlanItems.planId, planId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function updatePlanItem(
  itemId: string,
  planId: string,
  updates: RgdpPlanItemUpdateInput,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    let directionSnapshot: string | undefined;
    if (updates.direccion !== undefined) {
      const [snapshot] = await tx
        .select({ direccion: rgdpPlanItems.direccion })
        .from(rgdpPlanItems)
        .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
        .limit(1);
      if (!snapshot) throw NotFound("Plan item not found");
      directionSnapshot = normalizeDirection(snapshot.direccion);
      await lockPlanDirections(tx, "rgdp", planId, [directionSnapshot, updates.direccion]);
    }
    const [existing] = await tx
      .select()
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    if (!existing) throw NotFound("Plan item not found");
    if (
      directionSnapshot !== undefined &&
      normalizeDirection(existing.direccion) !== directionSnapshot
    ) {
      throw Conflict("La dirección del ítem cambió durante la actualización; vuelve a intentarlo");
    }

    if (updates.report_per !== undefined) {
      const [plan] = await tx
        .select({ reportPer: rgdpPlans.reportPer })
        .from(rgdpPlans)
        .where(eq(rgdpPlans.id, planId))
        .limit(1);
      if (!plan || updates.report_per !== plan.reportPer) {
        throw BadRequest("report_per no coincide con el plan");
      }
    }

    const patch = toUpdateDbValues(updates);
    const cleaned = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const [row] = await tx
      .update(rgdpPlanItems)
      .set({ ...cleaned, updatedAt: new Date() })
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .returning();
    if (!row) throw new Error("Plan item update returned no row after locking it");

    const oldDireccion = normalizeDirection(existing.direccion);
    const newDireccion = normalizeDirection(row.direccion);
    if (updates.direccion !== undefined && newDireccion !== oldDireccion) {
      const previous = await tx
        .select({ userId: rgdpItemAssignments.userId })
        .from(rgdpItemAssignments)
        .where(eq(rgdpItemAssignments.planItemId, itemId));
      const reporters = newDireccion
        ? await direccionReporterUnion(tx, planId, newDireccion, itemId)
        : [];
      await writeItemAssignments(tx, planId, itemId, reporters, { replace: true });
      const kept = new Set(reporters.map(({ userId }) => userId));
      await cleanupOrphanPlanAssignments(
        tx,
        planId,
        previous.map(({ userId }) => userId).filter((userId) => !kept.has(userId))
      );
    }
    const [serialized] = await serializePlanItems(tx, [row]);
    return serialized!;
  });
}

export async function updatePlanItemObservation(
  itemId: string,
  planId: string,
  observation: string,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN", "REPORTER"]);
    const rows = await tx
      .select()
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    if (!rows[0]) throw NotFound("Plan item not found");
    if (actor.role === "REPORTER" && !(await isReporterAssignedToItem(planId, itemId, actor.id, tx))) {
      throw Forbidden("No tienes acceso a este ítem");
    }
    const [row] = await tx
      .update(rgdpPlanItems)
      .set({ observation, updatedAt: new Date() })
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .returning();
    if (!row) throw NotFound("Plan item not found");
    const [serialized] = await serializePlanItems(tx, [row]);
    return serialized!;
  });
}

export async function deletePlanItem(itemId: string, planId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const rows = await tx
      .select({ id: rgdpPlanItems.id })
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    if (!rows[0]) throw NotFound("Plan item not found");
    await enqueueEvidenceCleanupForItem(tx, "rgdp", itemId);
    const [deleted] = await tx
      .delete(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.id, itemId), eq(rgdpPlanItems.planId, planId)))
      .returning({ id: rgdpPlanItems.id });
    if (!deleted) throw NotFound("Plan item not found");
    return deleted;
  });
}

export async function assignReporterToDireccion(
  planId: string,
  direccion: string,
  userId: string,
  category: "Responsable" | "Colaborador",
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    const normalizedDireccion = normalizeDirection(direccion);
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    await lockPlanDirections(tx, "rgdp", planId, [normalizedDireccion]);
    await assertAssignableUser(userId, "rgdp", ["REPORTER"], tx);
    const items = await tx
      .select({ id: rgdpPlanItems.id })
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.planId, planId), eq(rgdpPlanItems.direccion, normalizedDireccion)))
      .for("update");
    if (items.length === 0) throw NotFound("No hay items con esa dirección");

    const assignments = [];
    for (const it of items) {
      const [assignment] = await tx
        .insert(rgdpItemAssignments)
        .values({ planItemId: it.id, userId, category })
        .onConflictDoUpdate({
          target: [rgdpItemAssignments.planItemId, rgdpItemAssignments.userId],
          set: { category },
        })
        .returning();
      if (!assignment) throw new Error("Item assignment upsert returned no row");
      assignments.push(assignment);
    }
    await tx
      .insert(rgdpPlanAssignments)
      .values({ planId, userId, explicitAccess: false })
      // Never downgrade a pre-existing explicit plan assignment.
      .onConflictDoNothing();
    const [planAssignment] = await tx
      .select()
      .from(rgdpPlanAssignments)
      .where(and(eq(rgdpPlanAssignments.planId, planId), eq(rgdpPlanAssignments.userId, userId)))
      .limit(1);
    if (!planAssignment) throw new Error("Derived plan assignment was not persisted");
    return { planId, direccion: normalizedDireccion, userId, category, assignments, planAssignment };
  });
}

export async function unassignReporterFromDireccion(
  planId: string,
  direccion: string,
  userId: string,
  actorId: string,
) {
  return getDb().transaction(async (tx) => {
    const normalizedDireccion = normalizeDirection(direccion);
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    await lockPlanDirections(tx, "rgdp", planId, [normalizedDireccion]);
    const items = await tx
      .select({ id: rgdpPlanItems.id })
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.planId, planId), eq(rgdpPlanItems.direccion, normalizedDireccion)))
      .for("update");
    const ids = items.map((i) => i.id);
    if (ids.length === 0) throw NotFound("No hay items con esa dirección");
    const deleted = await tx
      .delete(rgdpItemAssignments)
      .where(and(inArray(rgdpItemAssignments.planItemId, ids), eq(rgdpItemAssignments.userId, userId)))
      .returning({ planItemId: rgdpItemAssignments.planItemId });
    if (deleted.length === 0) throw NotFound("La asignación por dirección no existe");
    const remaining = await tx
      .select({ id: rgdpItemAssignments.planItemId })
      .from(rgdpItemAssignments)
      .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
      .where(and(eq(rgdpPlanItems.planId, planId), eq(rgdpItemAssignments.userId, userId)))
      .limit(1);
    if (remaining.length === 0) {
      await tx
        .delete(rgdpPlanAssignments)
        .where(
          and(
            eq(rgdpPlanAssignments.planId, planId),
            eq(rgdpPlanAssignments.userId, userId),
            eq(rgdpPlanAssignments.explicitAccess, false)
          )
        );
    }
    return {
      planId,
      direccion: normalizedDireccion,
      userId,
      unassignedItemIds: deleted.map((row) => row.planItemId),
      remainingItemAssignments: remaining.length,
    };
  });
}
