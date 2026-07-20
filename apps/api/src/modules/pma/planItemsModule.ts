import { eq, and, asc, ne, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaPlanItems,
  pmaItemAssignments,
  pmaPlanAssignments,
  pmaPlans,
} from "../../db/schema/pma.js";
import { NotFound, Forbidden, Conflict } from "../../lib/errors.js";

export type PlanItemCreateInput = {
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
};

export type PlanItemUpdateInput = Partial<PlanItemCreateInput>;

type PlanItemRow = typeof pmaPlanItems.$inferSelect;

// Drizzle returns rows keyed in camelCase, but the API contract / frontend
// expect snake_case for several fields. Serialize to the shape the client reads.
function toApi(row: PlanItemRow) {
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
  };
}

function toDb(input: PlanItemCreateInput | PlanItemUpdateInput) {
  return {
    item: input.item,
    subplan: input.subplan,
    direccion: input.direccion ?? null,
    environmentalActivity: input.environmental_activity,
    identifiedEnvironmentalImpact: input.identified_environmental_impact,
    proposedMeasure: input.proposed_measure,
    indicator: input.indicator,
    verificationMethod: input.verification_method,
    periodicity: input.periodicity,
    budget: input.budget != null ? String(input.budget) : undefined,
    reportPer: input.report_per,
    observation: input.observation ?? null,
  };
}

type Db = ReturnType<typeof getDb>;
type ReporterAssignment = { userId: string; category: "Responsable" | "Colaborador" };

// Reporters currently assigned across a plan's "direccion" group, deduped into
// a single set. When a reporter appears with different categories, "Responsable"
// wins — matching how assignments are unified elsewhere in the app.
async function direccionReporterUnion(
  db: Db,
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
  db: Db,
  planId: string,
  itemId: string,
  reporters: ReporterAssignment[],
  { replace }: { replace: boolean }
) {
  if (replace) {
    await db.delete(pmaItemAssignments).where(eq(pmaItemAssignments.planItemId, itemId));
  }
  if (reporters.length === 0) return;
  await db
    .insert(pmaItemAssignments)
    .values(reporters.map((r) => ({ planItemId: itemId, userId: r.userId, category: r.category })))
    .onConflictDoNothing();
  await db
    .insert(pmaPlanAssignments)
    .values(reporters.map((r) => ({ planId, userId: r.userId })))
    .onConflictDoNothing();
}

// Drop plan-level access for any of `userIds` who no longer hold an item-level
// assignment anywhere in the plan (mirrors the unassign cleanup logic).
async function cleanupOrphanPlanAssignments(db: Db, planId: string, userIds: string[]) {
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
        .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)));
    }
  }
}

export async function createPlanItem(planId: string, input: PlanItemCreateInput) {
  const db = getDb();
  const [row] = await db
    .insert(pmaPlanItems)
    .values({
      planId,
      item: input.item,
      subplan: input.subplan,
      direccion: input.direccion ?? null,
      environmentalActivity: input.environmental_activity ?? "",
      identifiedEnvironmentalImpact: input.identified_environmental_impact ?? "",
      proposedMeasure: input.proposed_measure ?? "",
      indicator: input.indicator ?? "",
      verificationMethod: input.verification_method ?? "",
      periodicity: input.periodicity ?? "",
      budget: String(input.budget ?? 0),
      reportPer: input.report_per,
      observation: input.observation ?? null,
    })
    .returning();
  // Inherit the reporters already assigned to this item's direccion group.
  const direccion = (input.direccion ?? "").trim();
  if (direccion) {
    const union = await direccionReporterUnion(db, planId, direccion);
    await writeItemAssignments(db, planId, row.id, union, { replace: false });
  }
  return toApi(row);
}

export async function getPlanItems(planId: string) {
  const db = getDb();
  const items = await db
    .select()
    .from(pmaPlanItems)
    .where(eq(pmaPlanItems.planId, planId))
    .orderBy(asc(pmaPlanItems.createdAt));
  if (items.length === 0) return [];
  // hydrate assignedUsers
  const assignments = await db
    .select()
    .from(pmaItemAssignments)
    .where(inArray(pmaItemAssignments.planItemId, items.map((i) => i.id)));
  const byItem = new Map<string, Array<{ userId: string; category: string }>>();
  for (const a of assignments) {
    const arr = byItem.get(a.planItemId) ?? [];
    arr.push({ userId: a.userId, category: a.category });
    byItem.set(a.planItemId, arr);
  }
  return items.map((i) => ({ ...toApi(i), assignedUsers: byItem.get(i.id) ?? [] }));
}

export async function getPlanItemById(itemId: string) {
  const db = getDb();
  const rows = await db.select().from(pmaPlanItems).where(eq(pmaPlanItems.id, itemId)).limit(1);
  return rows[0] ?? null;
}

export async function updatePlanItem(itemId: string, planId: string, updates: PlanItemUpdateInput) {
  const db = getDb();
  const existing = await getPlanItemById(itemId);
  if (!existing) throw NotFound("Plan item not found");
  if (existing.planId !== planId) throw Forbidden();
  const patch = toDb(updates);
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(pmaPlanItems)
    .set({ ...cleaned, updatedAt: new Date() })
    .where(eq(pmaPlanItems.id, itemId))
    .returning();

  // If the item moved to a different (non-empty) direccion, make it conform to
  // that group's reporters. When the target group already has reporters, they
  // replace this item's own; when it has none, the item keeps its reporters and
  // seeds the group. Orphaned plan-level access is cleaned up afterwards.
  const oldDireccion = (existing.direccion ?? "").trim();
  const newDireccion = (row.direccion ?? "").trim();
  if (updates.direccion !== undefined && newDireccion && newDireccion !== oldDireccion) {
    const previous = await db
      .select({ userId: pmaItemAssignments.userId })
      .from(pmaItemAssignments)
      .where(eq(pmaItemAssignments.planItemId, itemId));
    const union = await direccionReporterUnion(db, planId, newDireccion, itemId);
    if (union.length > 0) {
      await writeItemAssignments(db, planId, itemId, union, { replace: true });
      const kept = new Set(union.map((u) => u.userId));
      const removed = previous.map((p) => p.userId).filter((id) => !kept.has(id));
      await cleanupOrphanPlanAssignments(db, planId, removed);
    }
  }
  return toApi(row);
}

export async function updatePlanItemObservation(itemId: string, planId: string, observation: string) {
  const db = getDb();
  const existing = await getPlanItemById(itemId);
  if (!existing) throw NotFound("Plan item not found");
  if (existing.planId !== planId) throw Forbidden();
  await db
    .update(pmaPlanItems)
    .set({ observation, updatedAt: new Date() })
    .where(eq(pmaPlanItems.id, itemId));
}

export async function deletePlanItem(itemId: string, planId: string) {
  const db = getDb();
  const existing = await getPlanItemById(itemId);
  if (!existing) throw NotFound("Plan item not found");
  if (existing.planId !== planId) throw Forbidden();
  await db.delete(pmaPlanItems).where(eq(pmaPlanItems.id, itemId));
}

export async function assignReporterToDireccion(
  planId: string,
  direccion: string,
  userId: string,
  category: "Responsable" | "Colaborador"
) {
  const db = getDb();
  const items = await db
    .select({ id: pmaPlanItems.id })
    .from(pmaPlanItems)
    .where(and(eq(pmaPlanItems.planId, planId), eq(pmaPlanItems.direccion, direccion)));
  if (items.length === 0) throw NotFound("No hay items con esa dirección");

  // Upsert item-level assignment for every item in the direccion group
  // (delete + insert pattern since the category may change).
  for (const it of items) {
    await db
      .delete(pmaItemAssignments)
      .where(and(eq(pmaItemAssignments.planItemId, it.id), eq(pmaItemAssignments.userId, userId)));
    await db.insert(pmaItemAssignments).values({ planItemId: it.id, userId, category });
  }

  // Ensure a plan-level assignment exists so the reporter can see the plan
  await db
    .insert(pmaPlanAssignments)
    .values({ planId, userId })
    .onConflictDoNothing();
}

export async function unassignReporterFromDireccion(
  planId: string,
  direccion: string,
  userId: string
) {
  const db = getDb();
  const items = await db
    .select({ id: pmaPlanItems.id })
    .from(pmaPlanItems)
    .where(and(eq(pmaPlanItems.planId, planId), eq(pmaPlanItems.direccion, direccion)));
  const ids = items.map((i) => i.id);
  if (ids.length > 0) {
    await db
      .delete(pmaItemAssignments)
      .where(and(inArray(pmaItemAssignments.planItemId, ids), eq(pmaItemAssignments.userId, userId)));
  }

  // If the user has no remaining item-level assignment in this plan, remove
  // the plan-level assignment too.
  const remaining = await db
    .select({ id: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(eq(pmaPlanItems.planId, planId), eq(pmaItemAssignments.userId, userId)))
    .limit(1);
  if (remaining.length === 0) {
    await db
      .delete(pmaPlanAssignments)
      .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)));
  }
}

export async function bulkCreatePlanItems(planId: string, items: PlanItemCreateInput[]) {
  if (items.length === 0) return [];
  const db = getDb();
  // ensure plan exists
  const plan = await db.select().from(pmaPlans).where(eq(pmaPlans.id, planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const rows = await db
    .insert(pmaPlanItems)
    .values(
      items.map((i) => ({
        planId,
        item: i.item,
        subplan: i.subplan,
        direccion: i.direccion ?? null,
        environmentalActivity: i.environmental_activity ?? "",
        identifiedEnvironmentalImpact: i.identified_environmental_impact ?? "",
        proposedMeasure: i.proposed_measure ?? "",
        indicator: i.indicator ?? "",
        verificationMethod: i.verification_method ?? "",
        periodicity: i.periodicity ?? "",
        budget: String(i.budget ?? 0),
        reportPer: i.report_per,
        observation: i.observation ?? null,
      }))
    )
    .returning();
  // Each new item inherits the reporters of its direccion group (if any).
  for (const row of rows) {
    const direccion = (row.direccion ?? "").trim();
    if (!direccion) continue;
    const union = await direccionReporterUnion(db, planId, direccion, row.id);
    await writeItemAssignments(db, planId, row.id, union, { replace: false });
  }
  return rows.map(toApi);
}
