import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaPlans,
  pmaPlanAssignments,
  pmaItemAssignments,
  pmaPlanItems,
} from "../../db/schema/pma.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
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
};

export type PlanUpdateInput = Partial<Omit<PlanCreateInput, "tipo" | "fase" | "enfoque" | "startDate" | "visualizationUrl">> & {
  tipo?: PlanCreateInput["tipo"] | null;
  fase?: PlanCreateInput["fase"] | null;
  enfoque?: PlanCreateInput["enfoque"] | null;
  startDate?: string | null;
  visualizationUrl?: string | null;
};

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

export async function createPlan(actorId: string, input: PlanCreateInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN"]);
    const [row] = await tx
      .insert(pmaPlans)
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
      })
      .returning();
    if (!row) throw new Error("Plan insert returned no row");
    return toApi(row);
  });
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

export async function updatePlan(planId: string, actorId: string, updates: PlanUpdateInput) {
  const db = getDb();
  const cleaned = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const [row] = await tx
      .update(pmaPlans)
      .set({ ...cleaned, updatedAt: new Date() })
      .where(eq(pmaPlans.id, planId))
      .returning();
    if (!row) throw NotFound("Plan not found");
    // Item schedules are evaluated against their stored report period. Keep
    // them synchronized with the parent plan in the same commit.
    if (updates.reportPer !== undefined) {
      await tx
        .update(pmaPlanItems)
        .set({ reportPer: updates.reportPer, updatedAt: new Date() })
        .where(eq(pmaPlanItems.planId, planId));
    }
    return toApi(row);
  });
}

export async function deletePlan(planId: string, actorId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pma", ["ADMIN"]);
    const existing = await tx
      .select({ id: pmaPlans.id })
      .from(pmaPlans)
      .where(eq(pmaPlans.id, planId))
      .limit(1)
      .for("update");
    if (!existing[0]) throw NotFound("Plan not found");
    await enqueueEvidenceCleanupForPlan(tx, "pma", planId);
    const deleted = await tx.delete(pmaPlans).where(eq(pmaPlans.id, planId)).returning({ id: pmaPlans.id });
    if (deleted.length !== 1) throw NotFound("Plan not found");
  });
}

export async function assignUserToPlan(planId: string, userId: string, actorId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    const [plan] = await tx.select({ id: pmaPlans.id }).from(pmaPlans).where(eq(pmaPlans.id, planId)).limit(1);
    if (!plan) throw NotFound("Plan not found");
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    await assertAssignableUser(userId, "pma", ["VIEWER"], tx);
    await tx
      .insert(pmaPlanAssignments)
      .values({ planId, userId, explicitAccess: true })
      .onConflictDoUpdate({
        target: [pmaPlanAssignments.planId, pmaPlanAssignments.userId],
        set: { explicitAccess: true },
      });
  });
}

export async function unassignUserFromPlan(planId: string, userId: string, actorId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pma", ["ADMIN", "VIEWER"]);
    const [plan] = await tx
      .select({ id: pmaPlans.id })
      .from(pmaPlans)
      .where(eq(pmaPlans.id, planId))
      .limit(1);
    if (!plan) throw NotFound("Plan not found");
    if (!(await canUserAccessPlan(planId, { sub: actor.id, role: actor.role }, tx))) {
      throw Forbidden("No tienes acceso a este plan");
    }
    const [assignment] = await tx
      .select()
      .from(pmaPlanAssignments)
      .where(and(
        eq(pmaPlanAssignments.planId, planId),
        eq(pmaPlanAssignments.userId, userId),
        eq(pmaPlanAssignments.explicitAccess, true),
      ))
      .limit(1)
      .for("update");
    if (!assignment) throw NotFound("La asignación explícita no existe");
    const itemAssignment = await tx
      .select({ id: pmaItemAssignments.planItemId })
      .from(pmaItemAssignments)
      .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
      .where(and(eq(pmaPlanItems.planId, planId), eq(pmaItemAssignments.userId, userId)))
      .limit(1);
    if (itemAssignment.length > 0) {
      await tx
        .update(pmaPlanAssignments)
        .set({ explicitAccess: false })
        .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)));
    } else {
      await tx
        .delete(pmaPlanAssignments)
        .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.userId, userId)));
    }
  });
}

export async function getPlansForReporter(userId: string) {
  const db = getDb();
  const itemLevel = await db
    .select({ planId: pmaPlanItems.planId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(eq(pmaItemAssignments.userId, userId));

  const planIds = Array.from(new Set(itemLevel.map((r) => r.planId)));
  if (planIds.length === 0) return [];
  const rows = await db.select().from(pmaPlans).where(inArray(pmaPlans.id, planIds));
  return rows.map(toApi);
}

export async function getPlansForViewer(userId: string) {
  const db = getDb();
  const planLevel = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(and(eq(pmaPlanAssignments.userId, userId), eq(pmaPlanAssignments.explicitAccess, true)));
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
    .where(and(eq(pmaPlanAssignments.planId, planId), eq(pmaPlanAssignments.explicitAccess, true)));
  return rows.map((r) => r.userId);
}

export async function isUserAssignedToPlan(
  userId: string,
  planId: string,
  db: any = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(and(
      eq(pmaPlanAssignments.userId, userId),
      eq(pmaPlanAssignments.planId, planId),
      eq(pmaPlanAssignments.explicitAccess, true),
    ))
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
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" },
  db: any = getDb(),
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role === "VIEWER") return isUserAssignedToPlan(user.sub, planId, db);
  const itemRows = await db
    .select({ planItemId: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(eq(pmaItemAssignments.userId, user.sub), eq(pmaPlanItems.planId, planId)))
    .limit(1);
  return itemRows.length > 0;
}
