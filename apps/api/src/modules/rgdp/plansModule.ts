import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpPlans,
  rgdpPlanAssignments,
  rgdpItemAssignments,
  rgdpPlanItems,
} from "../../db/schema/rgdp.js";
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
    .insert(rgdpPlans)
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
  getDb().select().from(rgdpPlans).where(eq(rgdpPlans.adminId, adminId)).orderBy(desc(rgdpPlans.createdAt));

export async function getPlanById(planId: string) {
  const rows = await getDb().select().from(rgdpPlans).where(eq(rgdpPlans.id, planId)).limit(1);
  return rows[0] ?? null;
}

export async function updatePlan(planId: string, adminId: string, updates: PlanUpdateInput) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
  const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  const [row] = await getDb()
    .update(rgdpPlans)
    .set({ ...(cleaned as any), updatedAt: new Date() })
    .where(eq(rgdpPlans.id, planId))
    .returning();
  return row;
}

export async function deletePlan(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
  await getDb().delete(rgdpPlans).where(eq(rgdpPlans.id, planId));
}

export async function assignUserToPlan(planId: string, userId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw Forbidden();
  await getDb().insert(rgdpPlanAssignments).values({ planId, userId }).onConflictDoNothing();
}

export async function unassignUserFromPlan(planId: string, userId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw Forbidden();
  await getDb()
    .delete(rgdpPlanAssignments)
    .where(and(eq(rgdpPlanAssignments.planId, planId), eq(rgdpPlanAssignments.userId, userId)));
}

export async function getPlansForReporter(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(eq(rgdpPlanAssignments.userId, userId));
  const itemLevel = await db
    .select({ planId: rgdpPlanItems.planId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(eq(rgdpItemAssignments.userId, userId));
  const planIds = Array.from(new Set([...planLevel, ...itemLevel].map((r) => r.planId)));
  if (planIds.length === 0) return [];
  return db.select().from(rgdpPlans).where(inArray(rgdpPlans.id, planIds));
}

export async function getPlansForViewer(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(eq(rgdpPlanAssignments.userId, userId));
  const planIds = planLevel.map((r) => r.planId);
  if (planIds.length === 0) return [];
  return db.select().from(rgdpPlans).where(inArray(rgdpPlans.id, planIds));
}
