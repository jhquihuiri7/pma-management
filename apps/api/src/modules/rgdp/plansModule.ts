import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpPlans,
  rgdpPlanAssignments,
  rgdpItemAssignments,
  rgdpPlanItems,
} from "../../db/schema/rgdp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { toRgdpPlanApi } from "./serializers.js";
import { assertAssignableUser } from "../shared/assignmentPolicy.js";
import { enqueueEvidenceCleanupForPlan } from "../shared/storageCleanup.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

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

export type PlanUpdateInput = Partial<
  Omit<
    PlanCreateInput,
    | "tipo"
    | "fase"
    | "enfoque"
    | "startDate"
    | "visualizationUrl"
    | "zoneType"
    | "coordinateFormat"
  >
> & {
  tipo?: PlanCreateInput["tipo"] | null;
  fase?: PlanCreateInput["fase"] | null;
  enfoque?: PlanCreateInput["enfoque"] | null;
  startDate?: string | null;
  visualizationUrl?: string | null;
  zoneType?: PlanCreateInput["zoneType"] | null;
  coordinateFormat?: string | null;
};

export async function createPlan(actorId: string, input: PlanCreateInput) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const [row] = await tx
      .insert(rgdpPlans)
      .values({
        createdBy: actor.id,
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
    if (!row) throw new Error("Plan insert returned no row");
    return toRgdpPlanApi(row);
  });
}

export async function getPlansByAdmin(_adminId?: string) {
  const rows = await getDb().select().from(rgdpPlans).orderBy(desc(rgdpPlans.createdAt));
  return rows.map(toRgdpPlanApi);
}

export async function getPlanById(planId: string) {
  const rows = await getDb().select().from(rgdpPlans).where(eq(rgdpPlans.id, planId)).limit(1);
  return rows[0] ? toRgdpPlanApi(rows[0]) : null;
}

export async function updatePlan(planId: string, actorId: string, updates: PlanUpdateInput) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const existing = await tx
      .select({ id: rgdpPlans.id })
      .from(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .limit(1);
    if (!existing[0]) throw NotFound("Plan not found");
    const cleaned = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
    const [row] = await tx
      .update(rgdpPlans)
      .set({ ...(cleaned as any), updatedAt: new Date() })
      .where(eq(rgdpPlans.id, planId))
      .returning();
    if (!row) throw NotFound("Plan not found");
    if (updates.reportPer !== undefined) {
      await tx
        .update(rgdpPlanItems)
        .set({ reportPer: updates.reportPer, updatedAt: new Date() })
        .where(eq(rgdpPlanItems.planId, planId));
    }
    return toRgdpPlanApi(row);
  });
}

export async function deletePlan(planId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const plan = await tx
      .select({ id: rgdpPlans.id })
      .from(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .limit(1)
      .for("update");
    if (!plan[0]) throw NotFound("Plan not found");
    await enqueueEvidenceCleanupForPlan(tx, "rgdp", planId);
    const [deleted] = await tx
      .delete(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .returning({ id: rgdpPlans.id });
    if (!deleted) throw NotFound("Plan not found");
    return deleted;
  });
}

export async function assignUserToPlan(planId: string, userId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const plan = await tx
      .select({ id: rgdpPlans.id })
      .from(rgdpPlans)
      .where(eq(rgdpPlans.id, planId))
      .limit(1)
      .for("update");
    if (plan.length === 0) throw NotFound("Plan not found");
    await assertAssignableUser(userId, "rgdp", ["VIEWER"], tx);
    const [assignment] = await tx
      .insert(rgdpPlanAssignments)
      .values({ planId, userId, explicitAccess: true })
      .onConflictDoUpdate({
        target: [rgdpPlanAssignments.planId, rgdpPlanAssignments.userId],
        set: { explicitAccess: true },
      })
      .returning();
    if (!assignment) throw new Error("Plan assignment upsert returned no row");
    return assignment;
  });
}

export async function unassignUserFromPlan(planId: string, userId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const [explicitAssignment] = await tx
      .select()
      .from(rgdpPlanAssignments)
      .where(
        and(
          eq(rgdpPlanAssignments.planId, planId),
          eq(rgdpPlanAssignments.userId, userId),
          eq(rgdpPlanAssignments.explicitAccess, true)
        )
      )
      .limit(1)
      .for("update");
    if (!explicitAssignment) throw NotFound("La asignación explícita no existe");
    const itemRows = await tx
      .select({ planItemId: rgdpItemAssignments.planItemId })
      .from(rgdpItemAssignments)
      .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
      .where(and(eq(rgdpItemAssignments.userId, userId), eq(rgdpPlanItems.planId, planId)))
      .limit(1);

    if (itemRows.length > 0) {
      const [assignment] = await tx
        .update(rgdpPlanAssignments)
        .set({ explicitAccess: false })
        .where(and(eq(rgdpPlanAssignments.planId, planId), eq(rgdpPlanAssignments.userId, userId)))
        .returning();
      if (!assignment) throw NotFound("La asignación explícita no existe");
      return assignment;
    }

    const [assignment] = await tx
      .delete(rgdpPlanAssignments)
      .where(and(eq(rgdpPlanAssignments.planId, planId), eq(rgdpPlanAssignments.userId, userId)))
      .returning();
    if (!assignment) throw NotFound("La asignación explícita no existe");
    return assignment;
  });
}

export async function getPlansForReporter(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(
      and(
        eq(rgdpPlanAssignments.userId, userId),
        eq(rgdpPlanAssignments.explicitAccess, true)
      )
    );
  const itemLevel = await db
    .select({ planId: rgdpPlanItems.planId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(eq(rgdpItemAssignments.userId, userId));
  const planIds = Array.from(new Set([...planLevel, ...itemLevel].map((r) => r.planId)));
  if (planIds.length === 0) return [];
  const rows = await db.select().from(rgdpPlans).where(inArray(rgdpPlans.id, planIds));
  return rows.map(toRgdpPlanApi);
}

export async function getPlansForViewer(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(
      and(
        eq(rgdpPlanAssignments.userId, userId),
        eq(rgdpPlanAssignments.explicitAccess, true)
      )
    );
  const planIds = planLevel.map((r) => r.planId);
  if (planIds.length === 0) return [];
  const rows = await db.select().from(rgdpPlans).where(inArray(rgdpPlans.id, planIds));
  return rows.map(toRgdpPlanApi);
}

export async function getAssignedUserIds(planId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userId: rgdpPlanAssignments.userId })
    .from(rgdpPlanAssignments)
    .where(
      and(
        eq(rgdpPlanAssignments.planId, planId),
        eq(rgdpPlanAssignments.explicitAccess, true)
      )
    );
  return rows.map((r) => r.userId);
}

/**
 * Object-level read authorization for a plan. ADMINs see everything; other
 * roles may only reach a plan they are assigned to, at plan OR item level —
 * exactly the set returned by the list endpoints. Used to stop a low-privilege
 * user from reading an unrelated plan (and its evidences) by guessing its id.
 */
export async function canUserAccessPlan(
  planId: string,
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" },
  db: any = getDb(),
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  const planRows = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(
      and(
        eq(rgdpPlanAssignments.userId, user.sub),
        eq(rgdpPlanAssignments.planId, planId),
        eq(rgdpPlanAssignments.explicitAccess, true)
      )
    )
    .limit(1);
  if (planRows.length > 0) return true;
  const itemRows = await db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(and(eq(rgdpItemAssignments.userId, user.sub), eq(rgdpPlanItems.planId, planId)))
    .limit(1);
  return itemRows.length > 0;
}
