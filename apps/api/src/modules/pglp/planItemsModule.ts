import { eq, and, asc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pglpPlanItems,
  pglpItemAssignments,
  pglpPlanAssignments,
} from "../../db/schema/pglp.js";
import { NotFound, Forbidden } from "../../lib/errors.js";

export type PglpPlanItemCreateInput = {
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

export type PglpPlanItemUpdateInput = Partial<PglpPlanItemCreateInput>;

function toDbValues(i: PglpPlanItemCreateInput) {
  return {
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
    wasteCode: i.wasteCode ?? null,
    wasteName: i.wasteName ?? null,
    wasteDescription: i.wasteDescription ?? null,
    crtib: i.crtib ?? null,
    annualGenerationKg: i.annualGenerationKg != null ? String(i.annualGenerationKg) : null,
    generationOrigin: i.generationOrigin ?? null,
    selfManagement: Boolean(i.selfManagement),
  };
}

export async function createPlanItem(planId: string, input: PglpPlanItemCreateInput) {
  const db = getDb();
  const [row] = await db.insert(pglpPlanItems).values({ planId, ...toDbValues(input) }).returning();
  return row;
}

export async function bulkCreatePlanItems(planId: string, items: PglpPlanItemCreateInput[]) {
  if (items.length === 0) return [];
  return getDb()
    .insert(pglpPlanItems)
    .values(items.map((i) => ({ planId, ...toDbValues(i) })))
    .returning();
}

export async function getPlanItems(planId: string) {
  const db = getDb();
  const items = await db
    .select()
    .from(pglpPlanItems)
    .where(eq(pglpPlanItems.planId, planId))
    .orderBy(asc(pglpPlanItems.createdAt));
  if (items.length === 0) return [];
  const assignments = await db
    .select()
    .from(pglpItemAssignments)
    .where(inArray(pglpItemAssignments.planItemId, items.map((i) => i.id)));
  const byItem = new Map<string, Array<{ userId: string; category: string }>>();
  for (const a of assignments) {
    const arr = byItem.get(a.planItemId) ?? [];
    arr.push({ userId: a.userId, category: a.category });
    byItem.set(a.planItemId, arr);
  }
  return items.map((i) => ({ ...i, assignedUsers: byItem.get(i.id) ?? [] }));
}

export async function getPlanItemById(itemId: string) {
  const rows = await getDb().select().from(pglpPlanItems).where(eq(pglpPlanItems.id, itemId)).limit(1);
  return rows[0] ?? null;
}

export async function updatePlanItem(itemId: string, planId: string, updates: PglpPlanItemUpdateInput) {
  const existing = await getPlanItemById(itemId);
  if (!existing) throw NotFound("Plan item not found");
  if (existing.planId !== planId) throw Forbidden();
  const cleaned: Record<string, unknown> = {};
  const all = toDbValues(updates as PglpPlanItemCreateInput);
  for (const [k, v] of Object.entries(all)) {
    if ((updates as any)[unmap(k)] !== undefined) cleaned[k] = v;
  }
  const [row] = await getDb()
    .update(pglpPlanItems)
    .set({ ...(cleaned as any), updatedAt: new Date() })
    .where(eq(pglpPlanItems.id, itemId))
    .returning();
  return row;
}

function unmap(camel: string): string {
  // Reverse the snake-case keys back to the input shape to detect "was set".
  switch (camel) {
    case "environmentalActivity": return "environmental_activity";
    case "identifiedEnvironmentalImpact": return "identified_environmental_impact";
    case "proposedMeasure": return "proposed_measure";
    case "verificationMethod": return "verification_method";
    case "reportPer": return "report_per";
    default: return camel;
  }
}

export async function deletePlanItem(itemId: string, planId: string) {
  const existing = await getPlanItemById(itemId);
  if (!existing) throw NotFound("Plan item not found");
  if (existing.planId !== planId) throw Forbidden();
  await getDb().delete(pglpPlanItems).where(eq(pglpPlanItems.id, itemId));
}

export async function assignReporterToItem(itemId: string, userId: string, category: "Responsable" | "Colaborador") {
  const db = getDb();
  const item = await getPlanItemById(itemId);
  if (!item) throw NotFound("Plan item not found");
  await db
    .delete(pglpItemAssignments)
    .where(and(eq(pglpItemAssignments.planItemId, itemId), eq(pglpItemAssignments.userId, userId)));
  await db.insert(pglpItemAssignments).values({ planItemId: itemId, userId, category });
  await db.insert(pglpPlanAssignments).values({ planId: item.planId, userId }).onConflictDoNothing();
}

export async function unassignReporterFromItem(itemId: string, userId: string) {
  const db = getDb();
  const item = await getPlanItemById(itemId);
  if (!item) throw NotFound("Plan item not found");
  await db
    .delete(pglpItemAssignments)
    .where(and(eq(pglpItemAssignments.planItemId, itemId), eq(pglpItemAssignments.userId, userId)));
  const remaining = await db
    .select({ id: pglpItemAssignments.planItemId })
    .from(pglpItemAssignments)
    .innerJoin(pglpPlanItems, eq(pglpItemAssignments.planItemId, pglpPlanItems.id))
    .where(and(eq(pglpPlanItems.planId, item.planId), eq(pglpItemAssignments.userId, userId)))
    .limit(1);
  if (remaining.length === 0) {
    await db
      .delete(pglpPlanAssignments)
      .where(and(eq(pglpPlanAssignments.planId, item.planId), eq(pglpPlanAssignments.userId, userId)));
  }
}
