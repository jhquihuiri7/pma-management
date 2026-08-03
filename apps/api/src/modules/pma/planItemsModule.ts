import { eq, and, asc, ne, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaPlanItems,
  pmaItemAssignments,
  pmaPlanAssignments,
  pmaPlans,
} from "../../db/schema/pma.js";
import { BadRequest, NotFound, Conflict, Forbidden } from "../../lib/errors.js";
import { assertAssignableUser, assertAssignableUsers } from "../shared/assignmentPolicy.js";
import { lockPlanDirections, normalizeDirection } from "../shared/directionLock.js";
import { enqueueEvidenceCleanupForItem } from "../shared/storageCleanup.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { canUserAccessPlan } from "./plansModule.js";

export type PlanItemCreateInput = {
  item: string;
  subplan: string;
  direccion?: string;
  environmental_activity?: string;
  identified_environmental_impact?: string;
  proposed_measure?: string;
  indicator?: string;
  verification_method?: string;
  periodicity: string;
  budget?: number;
  /** Omit to adopt the plan's period; an explicit value must match the plan. */
  report_per?: "6 meses" | "1 año" | "2 años";
  observation?: string;
};

export type PlanItemUpdateInput = Partial<PlanItemCreateInput>;

type PlanItemRow = typeof pmaPlanItems.$inferSelect;

// Drizzle returns rows keyed in camelCase, but the API contract / frontend
// expect snake_case for several fields. Serialize to the shape the client reads.
function toApi(row: PlanItemRow, assignedUsers: ReporterAssignment[] = []) {
  return {
    id: row.id,
    planId: row.planId,
    item: row.item,
    subplan: row.subplan,
    direccion: row.direccion,
    environmental_activity: row.environmentalActivity,
    identified_environmental_impact: row.identifiedEnvironmentalImpact,
    proposed_measure: row.proposedMeasure,
    indicator: row.indicator,
    verification_method: row.verificationMethod,
    periodicity: row.periodicity,
    budget: Number(row.budget),
    report_per: row.reportPer,
    observation: row.observation,
    storagePath: row.storagePath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignedUsers,
  };
}

function toDb(input: PlanItemCreateInput | PlanItemUpdateInput) {
  return {
    item: input.item,
    subplan: input.subplan,
    direccion:
      input.direccion !== undefined ? normalizeDirection(input.direccion) || null : undefined,
    environmentalActivity: input.environmental_activity,
    identifiedEnvironmentalImpact: input.identified_environmental_impact,
    proposedMeasure: input.proposed_measure,
    indicator: input.indicator,
    verificationMethod: input.verification_method,
    periodicity: input.periodicity,
    budget: input.budget != null ? String(input.budget) : undefined,
    reportPer: input.report_per,
    observation: input.observation !== undefined ? input.observation : undefined,
  };
}

type ReporterAssignment = { userId: string; category: "Responsable" | "Colaborador" };

async function serializePlanItems(db: any, rows: PlanItemRow[]) {
  if (rows.length === 0) return [];
  const assignments = await db
    .select()
    .from(pmaItemAssignments)
    .where(inArray(pmaItemAssignments.planItemId, rows.map((row) => row.id)));
  const byItem = new Map<string, ReporterAssignment[]>();
  for (const assignment of assignments) {
    const current = byItem.get(assignment.planItemId) ?? [];
    current.push({
      userId: assignment.userId,
      category: assignment.category as ReporterAssignment["category"],
    });
    byItem.set(assignment.planItemId, current);
  }
  return rows.map((row) => toApi(row, byItem.get(row.id) ?? []));
}

// Reporters currently assigned across a plan's "direccion" group, deduped into
// a single set. When a reporter appears with different categories, "Responsable"
// wins — matching how assignments are unified elsewhere in the app.
async function direccionReporterUnion(
  db: any,
  planId: string,
  direccion: string,
  excludeItemId?: string
): Promise<ReporterAssignment[]> {
  const filters = [
    eq(pmaPlanItems.planId, planId),
    eq(pmaPlanItems.direccion, direccion),
  ];
  if (excludeItemId) filters.push(ne(pmaPlanItems.id, excludeItemId));
  const rows = await db
    .select({ userId: pmaItemAssignments.userId, category: pmaItemAssignments.category })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(...filters));
  const map = new Map<string, "Responsable" | "Colaborador">();
  for (const r of rows) {
    if (map.get(r.userId) === "Responsable") continue;
    map.set(r.userId, r.category as "Responsable" | "Colaborador");
  }
  return Array.from(map.entries()).map(([userId, category]) => ({ userId, category }));
}

// Persist a set of reporters onto a single item and guarantee each can see the
// plan. `replace` overwrites the item's existing reporters (used when an item
// moves to a new direccion); otherwise assignments are only added.
async function writeItemAssignments(
  db: any,
  planId: string,
  itemId: string,
  reporters: ReporterAssignment[],
  { replace }: { replace: boolean }
) {
  if (replace) {
    await db.delete(pmaItemAssignments).where(eq(pmaItemAssignments.planItemId, itemId));
  }
  if (reporters.length === 0) return;
  // Direction membership is derived from existing grants. Revalidate it while
  // holding the same authorization lock as app revocation/role changes so a
  // stale grant can never be copied to a new or moved item.
  await assertAssignableUsers(reporters.map((reporter) => reporter.userId), "pma", ["REPORTER"], db);
  await db
    .insert(pmaItemAssignments)
    .values(reporters.map((r) => ({ planItemId: itemId, userId: r.userId, category: r.category })))
    .onConflictDoNothing();
  await db
    .insert(pmaPlanAssignments)
    .values(reporters.map((r) => ({ planId, userId: r.userId, explicitAccess: false })))
    .onConflictDoNothing();
}

// Drop plan-level access for any of `userIds` who no longer hold an item-level
// assignment anywhere in the plan (mirrors the unassign cleanup logic).
async function cleanupOrphanPlanAssignments(db: any, planId: string, userIds: string[]) {
  for (const userId of userIds) {
    const remaining = await db
      .select({ id: pmaItemAssignments.planItemId })
      .from(pmaItemAssignments)
      .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
      .where(and(eq(pmaPlanItems.planId, planId), eq(pmaItemAssignments.userId, userId)))
      .limit(1);
    if (remaining.length === 0) {
      await db
        .delete(pmaPlanAssignments)
        .where(and(
          eq(pmaPlanAssignments.planId, planId),
          eq(pmaPlanAssignments.userId, userId),
          eq(pmaPlanAssignments.explicitAccess, false),
        ));
    }
  }
}

export async function createPlanItem(planId: string, input: PlanItemCreateInput, actorId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const direccion = normalizeDirection(input.direccion);
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    await lockPlanDirections(tx, "pma", planId, [direccion]);
    const plan = await tx
      .select({ id: pmaPlans.id, reportPer: pmaPlans.reportPer })
      .from(pmaPlans)
      .where(eq(pmaPlans.id, planId))
      .limit(1);
    if (!plan[0]) throw NotFound("Plan not found");
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    // report_per describes the plan's reporting period, so an item that leaves
    // it out simply inherits it. Resolving it here — against the row already
    // locked above — keeps the value authoritative and rules out a caller that
    // read the plan earlier and raced a change to it.
    const reportPer = input.report_per ?? plan[0].reportPer;
    if (reportPer !== plan[0].reportPer) throw BadRequest("report_per no coincide con el plan");
    const [row] = await tx
      .insert(pmaPlanItems)
      .values({
        planId,
        item: input.item,
        subplan: input.subplan,
        direccion: direccion || null,
        environmentalActivity: input.environmental_activity ?? "",
        identifiedEnvironmentalImpact: input.identified_environmental_impact ?? "",
        proposedMeasure: input.proposed_measure ?? "",
        indicator: input.indicator ?? "",
        verificationMethod: input.verification_method ?? "",
        periodicity: input.periodicity ?? "",
        budget: String(input.budget ?? 0),
        reportPer,
        observation: input.observation ?? null,
      })
      .returning();
    if (!row) throw new Error("Plan item insert returned no row");
    if (direccion) {
      const union = await direccionReporterUnion(tx, planId, direccion);
      await writeItemAssignments(tx, planId, row.id, union, { replace: false });
    }
    const [serialized] = await serializePlanItems(tx, [row]);
    return serialized!;
  });
}

export async function getPlanItems(planId: string, reporterId?: string) {
  const db = getDb();
  const items = reporterId
    ? await db
      .select({ item: pmaPlanItems })
      .from(pmaPlanItems)
      .innerJoin(pmaItemAssignments, and(
        eq(pmaItemAssignments.planItemId, pmaPlanItems.id),
        eq(pmaItemAssignments.userId, reporterId),
      ))
      .where(eq(pmaPlanItems.planId, planId))
      .orderBy(asc(pmaPlanItems.createdAt))
      .then((rows) => rows.map((row) => row.item))
    : await db
      .select()
      .from(pmaPlanItems)
      .where(eq(pmaPlanItems.planId, planId))
      .orderBy(asc(pmaPlanItems.createdAt));
  if (items.length === 0) return [];
  return serializePlanItems(db, items);
}

export async function getPlanItemById(itemId: string, db: any = getDb()) {
  const rows = await db.select().from(pmaPlanItems).where(eq(pmaPlanItems.id, itemId)).limit(1);
  return rows[0] ?? null;
}

export async function isReporterAssignedToItem(userId: string, itemId: string, planId: string) {
  const rows = await getDb()
    .select({ itemId: pmaPlanItems.id })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(
      eq(pmaItemAssignments.userId, userId),
      eq(pmaPlanItems.id, itemId),
      eq(pmaPlanItems.planId, planId),
    ))
    .limit(1);
  return rows.length === 1;
}

export async function updatePlanItem(
  itemId: string,
  planId: string,
  updates: PlanItemUpdateInput,
  actorId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    let directionSnapshot: string | undefined;
    if (updates.direccion !== undefined) {
      const [snapshot] = await tx
        .select({ direccion: pmaPlanItems.direccion })
        .from(pmaPlanItems)
        .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
        .limit(1);
      if (!snapshot) throw NotFound("Plan item not found");
      directionSnapshot = normalizeDirection(snapshot.direccion);
      await lockPlanDirections(tx, "pma", planId, [directionSnapshot, updates.direccion]);
    }
    const existingRows = await tx
      .select()
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    const existing = existingRows[0];
    if (!existing) throw NotFound("Plan item not found");
    if (
      directionSnapshot !== undefined &&
      normalizeDirection(existing.direccion) !== directionSnapshot
    ) {
      throw Conflict("La dirección del ítem cambió durante la actualización; vuelve a intentarlo");
    }
    if (updates.report_per !== undefined) {
      const [plan] = await tx
        .select({ reportPer: pmaPlans.reportPer })
        .from(pmaPlans)
        .where(eq(pmaPlans.id, planId))
        .limit(1);
      if (!plan || updates.report_per !== plan.reportPer) {
        throw BadRequest("report_per no coincide con el plan");
      }
    }
    const patch = toDb(updates);
    const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [row] = await tx
      .update(pmaPlanItems)
      .set({ ...cleaned, updatedAt: new Date() })
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .returning();
    if (!row) throw Conflict("Plan item changed while it was being updated");

    const oldDireccion = normalizeDirection(existing.direccion);
    const newDireccion = normalizeDirection(row.direccion);
    if (updates.direccion !== undefined && newDireccion !== oldDireccion) {
      const previous = await tx
        .select({ userId: pmaItemAssignments.userId })
        .from(pmaItemAssignments)
        .where(eq(pmaItemAssignments.planItemId, itemId));
      const union = newDireccion
        ? await direccionReporterUnion(tx, planId, newDireccion, itemId)
        : [];
      await writeItemAssignments(tx, planId, itemId, union, { replace: true });
      const kept = new Set(union.map((u) => u.userId));
      const removed = previous.map((p) => p.userId).filter((id) => !kept.has(id));
      await cleanupOrphanPlanAssignments(tx, planId, removed);
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
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "REPORTER", "VIEWER"]);
    const [item] = await tx
      .select({ id: pmaPlanItems.id })
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    if (!item) throw NotFound("Plan item not found");
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    if (actor.role === "REPORTER") {
      const [assignment] = await tx
        .select({ itemId: pmaItemAssignments.planItemId })
        .from(pmaItemAssignments)
        .where(and(
          eq(pmaItemAssignments.planItemId, itemId),
          eq(pmaItemAssignments.userId, actor.id),
        ))
        .limit(1);
      if (!assignment) throw Forbidden("No tienes acceso a este ítem");
    }
    const [row] = await tx
      .update(pmaPlanItems)
      .set({ observation, updatedAt: new Date() })
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .returning({ id: pmaPlanItems.id });
    if (!row) throw NotFound("Plan item not found");
    return row;
  });
}

export async function deletePlanItem(itemId: string, planId: string, actorId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    const existing = await tx
      .select({ id: pmaPlanItems.id })
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .limit(1)
      .for("update");
    if (!existing[0]) throw NotFound("Plan item not found");
    await enqueueEvidenceCleanupForItem(tx, "pma", itemId);
    const deleted = await tx
      .delete(pmaPlanItems)
      .where(and(eq(pmaPlanItems.id, itemId), eq(pmaPlanItems.planId, planId)))
      .returning({ id: pmaPlanItems.id });
    if (deleted.length !== 1) throw Conflict("Plan item changed while it was being deleted");
  });
}

export async function assignReporterToDireccion(
  planId: string,
  direccion: string,
  userId: string,
  category: "Responsable" | "Colaborador",
  actorId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const normalizedDireccion = normalizeDirection(direccion);
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    await lockPlanDirections(tx, "pma", planId, [normalizedDireccion]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    await assertAssignableUser(userId, "pma", ["REPORTER"], tx);
    const items = await tx
      .select({ id: pmaPlanItems.id })
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.planId, planId), eq(pmaPlanItems.direccion, normalizedDireccion)));
    if (items.length === 0) throw NotFound("No hay items con esa dirección");

    await tx
      .insert(pmaItemAssignments)
      .values(items.map((item) => ({ planItemId: item.id, userId, category })))
      .onConflictDoUpdate({
        target: [pmaItemAssignments.planItemId, pmaItemAssignments.userId],
        set: { category },
      });
    await tx
      .insert(pmaPlanAssignments)
      .values({ planId, userId, explicitAccess: false })
      .onConflictDoNothing();
    const persistedAssignments = await tx
      .select({ planItemId: pmaItemAssignments.planItemId, category: pmaItemAssignments.category })
      .from(pmaItemAssignments)
      .where(and(
        inArray(pmaItemAssignments.planItemId, items.map((item) => item.id)),
        eq(pmaItemAssignments.userId, userId),
      ));
    const [planAssignment] = await tx
      .select({ planId: pmaPlanAssignments.planId, userId: pmaPlanAssignments.userId })
      .from(pmaPlanAssignments)
      .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)))
      .limit(1);
    if (
      persistedAssignments.length !== items.length ||
      persistedAssignments.some((assignment) => assignment.category !== category) ||
      !planAssignment
    ) {
      throw new Error("Reporter direction assignment was not fully persisted");
    }
    return {
      planId,
      direccion: normalizedDireccion,
      userId,
      category,
      assignedItemIds: persistedAssignments.map((assignment) => assignment.planItemId),
      planAssignment,
    };
  });
}

export async function unassignReporterFromDireccion(
  planId: string,
  direccion: string,
  userId: string,
  actorId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const normalizedDireccion = normalizeDirection(direccion);
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    await lockPlanDirections(tx, "pma", planId, [normalizedDireccion]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const items = await tx
      .select({ id: pmaPlanItems.id })
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.planId, planId), eq(pmaPlanItems.direccion, normalizedDireccion)));
    const ids = items.map((i) => i.id);
    if (ids.length === 0) throw NotFound("No hay items con esa dirección");
    const removed = await tx
      .delete(pmaItemAssignments)
      .where(and(inArray(pmaItemAssignments.planItemId, ids), eq(pmaItemAssignments.userId, userId)))
      .returning({ id: pmaItemAssignments.planItemId });
    if (removed.length === 0) throw NotFound("El reportero no está asignado a esa dirección");
    await cleanupOrphanPlanAssignments(tx, planId, [userId]);
    return {
      planId,
      direccion: normalizedDireccion,
      userId,
      unassignedItemIds: removed.map((assignment) => assignment.id),
    };
  });
}

export async function bulkCreatePlanItems(
  planId: string,
  items: PlanItemCreateInput[],
  actorId: string,
) {
  if (items.length === 0) return [];
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    await lockPlanDirections(tx, "pma", planId, items.map((item) => item.direccion));
    const plan = await tx.select().from(pmaPlans).where(eq(pmaPlans.id, planId)).limit(1).for("update");
    if (plan.length === 0) throw NotFound("Plan not found");
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    // Same rule as the single-item create: omitted means "the plan's period".
    const reportPer = plan[0].reportPer;
    if (items.some((item) => item.report_per !== undefined && item.report_per !== reportPer)) {
      throw BadRequest("Uno o más report_per no coinciden con el plan");
    }
    const rows = await tx
      .insert(pmaPlanItems)
      .values(
        items.map((i) => ({
          planId,
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
          reportPer,
          observation: i.observation ?? null,
        }))
      )
      .returning();
    for (const row of rows) {
      const direccion = normalizeDirection(row.direccion);
      if (!direccion) continue;
      const union = await direccionReporterUnion(tx, planId, direccion, row.id);
      await writeItemAssignments(tx, planId, row.id, union, { replace: false });
    }
    return serializePlanItems(tx, rows);
  });
}
