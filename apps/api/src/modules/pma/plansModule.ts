import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaPlans,
  pmaPlanAssignments,
  pmaItemAssignments,
  pmaPlanItems,
} from "../../db/schema/pma.js";
import { NotFound } from "../../lib/errors.js";

export type PlanCreateInput = {
  title: string;
  description?: string;
  reportPer: "6 meses" | "1 año" | "2 años";
  tipo?: "Licencia" | "Registro Ambiental" | "N/A";
  fase?: "Planificación" | "Construcción" | "Operación" | "Cierre";
  enfoque?: "Prevenir impactos" | "Controlar impactos" | "Monitorear y optimizar" | "Restaurar el ambiente";
  startDate?: string;
  visualizationUrl?: string;
};

export type PlanUpdateInput = Partial<PlanCreateInput>;

type PlanRow = typeof pmaPlans.$inferSelect;

function toDateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

function toApi(row: PlanRow) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    adminId: row.createdBy,
    title: row.title,
    description: row.description,
    tipo: row.tipo,
    fase: row.fase,
    enfoque: row.enfoque,
    report_per: row.reportPer,
    start_date: toDateOnly(row.startDate),
    visualization_url: row.visualizationUrl,
    storagePath: row.storagePath,
    location: row.location,
    ciiu: row.ciiu,
    zoneType: row.zoneType,
    coordinateFormat: row.coordinateFormat,
    geographicArea: row.geographicArea,
    implantationArea: row.implantationArea,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPlan(adminId: string, input: PlanCreateInput) {
  const db = getDb();
  const [row] = await db
    .insert(pmaPlans)
    .values({
      createdBy: adminId,
      title: input.title,
      description: input.description ?? "",
      tipo: input.tipo,
      fase: input.fase,
      enfoque: input.enfoque,
      reportPer: input.reportPer,
      startDate: input.startDate ?? null,
      visualizationUrl: input.visualizationUrl ?? null,
    })
    .returning();
  return toApi(row);
}

export async function getPlansByAdmin(_adminId?: string) {
  // Single shared organization: every admin sees all plans.
  const db = getDb();
  const rows = await db.select().from(pmaPlans).orderBy(desc(pmaPlans.createdAt));
  return rows.map(toApi);
}

export async function getPlanById(planId: string) {
  const db = getDb();
  const rows = await db.select().from(pmaPlans).where(eq(pmaPlans.id, planId)).limit(1);
  return rows[0] ? toApi(rows[0]) : null;
}

export async function updatePlan(planId: string, adminId: string, updates: PlanUpdateInput) {
  const db = getDb();
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  const [row] = await db
    .update(pmaPlans)
    .set({ ...cleaned, updatedAt: new Date() })
    .where(eq(pmaPlans.id, planId))
    .returning();
  return toApi(row);
}

export async function deletePlan(planId: string, adminId: string) {
  const db = getDb();
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  // FKs are ON DELETE CASCADE; one statement removes items, evidences, assignments, etc.
  await db.delete(pmaPlans).where(eq(pmaPlans.id, planId));
  // Caller is responsible for removing storage_path tree after this returns.
}

export async function assignUserToPlan(planId: string, userId: string, _adminId?: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  const db = getDb();
  await db
    .insert(pmaPlanAssignments)
    .values({ planId, userId })
    .onConflictDoNothing();
}

export async function unassignUserFromPlan(planId: string, userId: string, _adminId?: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  const db = getDb();
  await db
    .delete(pmaPlanAssignments)
    .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)));
}

export async function getPlansForReporter(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(eq(pmaPlanAssignments.userId, userId));

  const itemLevel = await db
    .select({ planId: pmaPlanItems.planId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(eq(pmaItemAssignments.userId, userId));

  const planIds = Array.from(new Set([...planLevel, ...itemLevel].map((r) => r.planId)));
  if (planIds.length === 0) return [];
  const rows = await db.select().from(pmaPlans).where(inArray(pmaPlans.id, planIds));
  return rows.map(toApi);
}

export async function getPlansForViewer(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(eq(pmaPlanAssignments.userId, userId));
  const planIds = planLevel.map((r) => r.planId);
  if (planIds.length === 0) return [];
  const rows = await db.select().from(pmaPlans).where(inArray(pmaPlans.id, planIds));
  return rows.map(toApi);
}

export async function getAssignedUserIds(planId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userId: pmaPlanAssignments.userId })
    .from(pmaPlanAssignments)
    .where(eq(pmaPlanAssignments.planId, planId));
  return rows.map((r) => r.userId);
}

export async function isUserAssignedToPlan(userId: string, planId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(and(eq(pmaPlanAssignments.userId, userId), eq(pmaPlanAssignments.planId, planId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Object-level read authorization for a plan. ADMINs see everything; other
 * roles may only reach a plan they are assigned to, at plan OR item level —
 * exactly the set returned by the list endpoints. Used to stop a low-privilege
 * user from reading an unrelated plan (and its evidences/findings) by guessing
 * its id.
 */
export async function canUserAccessPlan(
  planId: string,
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" }
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (await isUserAssignedToPlan(user.sub, planId)) return true;
  const db = getDb();
  const itemRows = await db
    .select({ planItemId: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(eq(pmaItemAssignments.userId, user.sub), eq(pmaPlanItems.planId, planId)))
    .limit(1);
  return itemRows.length > 0;
}
