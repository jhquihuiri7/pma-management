import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pglpPlans,
  pglpPlanAssignments,
  pglpItemAssignments,
  pglpPlanItems,
} from "../../db/schema/pglp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";

export type PlanCreateInput = {
  title: string;
  description?: string;
  reportPer: "6 meses" | "1 año" | "2 años";
  tipo?: "Licencia" | "Registro Ambiental" | "N/A";
  fase?: "Planificación" | "Construcción" | "Operación" | "Cierre";
  enfoque?: "Prevenir impactos" | "Controlar impactos" | "Monitorear y optimizar" | "Restaurar el ambiente";
  startDate?: string;
  visualizationUrl?: string;
  location?: unknown;
  ciiu?: unknown;
  zoneType?: "Urbana" | "Rural" | "Maritima" | "Fluvial";
  coordinateFormat?: string;
  geographicArea?: unknown;
  implantationArea?: unknown;
};

export type PlanUpdateInput = Partial<PlanCreateInput>;

export async function createPlan(adminId: string, input: PlanCreateInput) {
  const db = getDb();
  const [row] = await db
    .insert(pglpPlans)
    .values({
      adminId,
      title: input.title,
      description: input.description ?? "",
      tipo: input.tipo,
      fase: input.fase,
      enfoque: input.enfoque,
      reportPer: input.reportPer,
      startDate: input.startDate ?? null,
      visualizationUrl: input.visualizationUrl ?? null,
      location: (input.location as any) ?? null,
      ciiu: (input.ciiu as any) ?? null,
      zoneType: input.zoneType,
      coordinateFormat: input.coordinateFormat ?? null,
      geographicArea: (input.geographicArea as any) ?? null,
      implantationArea: (input.implantationArea as any) ?? null,
    })
    .returning();
  return row;
}

export const getPlansByAdmin = (adminId: string) =>
  getDb().select().from(pglpPlans).where(eq(pglpPlans.adminId, adminId)).orderBy(desc(pglpPlans.createdAt));

export async function getPlanById(planId: string) {
  const rows = await getDb().select().from(pglpPlans).where(eq(pglpPlans.id, planId)).limit(1);
  return rows[0] ?? null;
}

export async function updatePlan(planId: string, adminId: string, updates: PlanUpdateInput) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
  const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  const [row] = await getDb()
    .update(pglpPlans)
    .set({ ...(cleaned as any), updatedAt: new Date() })
    .where(eq(pglpPlans.id, planId))
    .returning();
  return row;
}

export async function deletePlan(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
  await getDb().delete(pglpPlans).where(eq(pglpPlans.id, planId));
}

export async function assignUserToPlan(planId: string, userId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw Forbidden();
  await getDb().insert(pglpPlanAssignments).values({ planId, userId }).onConflictDoNothing();
}

export async function unassignUserFromPlan(planId: string, userId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw Forbidden();
  await getDb()
    .delete(pglpPlanAssignments)
    .where(and(eq(pglpPlanAssignments.planId, planId), eq(pglpPlanAssignments.userId, userId)));
}

export async function getPlansForReporter(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: pglpPlanAssignments.planId })
    .from(pglpPlanAssignments)
    .where(eq(pglpPlanAssignments.userId, userId));
  const itemLevel = await db
    .select({ planId: pglpPlanItems.planId })
    .from(pglpItemAssignments)
    .innerJoin(pglpPlanItems, eq(pglpItemAssignments.planItemId, pglpPlanItems.id))
    .where(eq(pglpItemAssignments.userId, userId));
  const planIds = Array.from(new Set([...planLevel, ...itemLevel].map((r) => r.planId)));
  if (planIds.length === 0) return [];
  return db.select().from(pglpPlans).where(inArray(pglpPlans.id, planIds));
}

export async function getPlansForViewer(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: pglpPlanAssignments.planId })
    .from(pglpPlanAssignments)
    .where(eq(pglpPlanAssignments.userId, userId));
  const planIds = planLevel.map((r) => r.planId);
  if (planIds.length === 0) return [];
  return db.select().from(pglpPlans).where(inArray(pglpPlans.id, planIds));
}
