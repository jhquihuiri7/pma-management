import { eq, and, desc, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaPlans,
  pmaPlanAssignments,
  pmaItemAssignments,
  pmaPlanItems,
  pmaEvidences,
  pmaPeriodCompliance,
} from "../../db/schema/pma.js";
import type { PmaPlanEstado, PmaPlanTipo } from "@pma/types";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanCalendar, getPlanPeriods } from "./planSchedule.js";
import { assertAssignableUser } from "../shared/assignmentPolicy.js";
import { enqueueEvidenceCleanupForPlan } from "../shared/storageCleanup.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type PlanCreateInput = {
  title: string;
  description?: string;
  reportPer: "6 meses" | "1 año" | "2 años";
  tipo?: PmaPlanTipo;
  fase?: "Planificación" | "Construcción" | "Operación" | "Cierre";
  /** Omitted falls through to the column default, "Vigente". */
  estado?: PmaPlanEstado;
  /** Required: origin of every derived schedule, and immutable once created. */
  startDate: string;
  /**
   * Last day the plan is in force. Required exactly when `estado` is
   * 'Vencida' and forbidden otherwise — see `resolveEstadoEndDate`.
   */
  endDate?: string | null;
  visualizationUrl?: string;
};

/**
 * `startDate` and `reportPer` are intentionally not part of this type. Together
 * they define the plan's schedule grid — the first its origin, the second its
 * block width — and from that grid come the reporting-period keys stored in
 * `pma_period_compliance`, every item's evidence ranges and deadline months,
 * which months accept an upload, and the storage folder each evidence file is
 * written to. An update that moved either would reshape the grid underneath
 * rows and files already laid out on the old one. Omitting them here makes that
 * unrepresentable rather than merely unrouted.
 */
export type PlanUpdateInput = Partial<Omit<PlanCreateInput, "tipo" | "fase" | "startDate" | "reportPer" | "visualizationUrl" | "endDate">> & {
  tipo?: PlanCreateInput["tipo"] | null;
  fase?: PlanCreateInput["fase"] | null;
  visualizationUrl?: string | null;
  /**
   * Unlike `startDate`, this one *is* editable: it is a fact about the
   * instrument that an administrator can get wrong and correct, and moving it
   * only narrows or widens the visible tail of the calendar — it never shifts
   * the grid's origin, so no period key or storage folder is renamed.
   */
  endDate?: string | null;
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
    estado: row.estado,
    // Serialized but never accepted back: the flag is flipped only by
    // `actionPlanModule`, which stamps each transition with its actor and
    // motive, so it is deliberately absent from both input types above.
    actionPlanActive: row.actionPlanActive,
    report_per: row.reportPer,
    start_date: toDateOnly(row.startDate),
    end_date: toDateOnly(row.endDate),
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

/** The transaction handle `db.transaction` hands its callback. */
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

type EstadoEndDate = { estado: PmaPlanEstado; endDate: string | null };

/**
 * The (estado, endDate) pair a write leaves behind, refusing the two
 * combinations that would misrepresent the plan.
 *
 * A plan is 'Vencida' *because* it stopped being in force on some day, so the
 * date is not optional decoration: without it the state means no more than the
 * bare label 0027 shipped, and the calendar has nothing to stop at. And a plan
 * back in force must not keep the date around, because it would go on
 * truncating a live calendar — 0028 makes that half unrepresentable in the
 * column too.
 *
 * `requested` carries only what the caller actually sent (undefined = "not
 * changing this"); `current` is the pair already stored, and is the plan's own
 * values on creation.
 *
 * Exported so both refusals are testable without auth and a database.
 */
export function resolveEstadoEndDate(
  requested: { estado?: PmaPlanEstado; endDate?: string | null },
  current: EstadoEndDate,
  startDate: string,
): EstadoEndDate {
  const estado = requested.estado ?? current.estado;

  if (estado === "Vigente") {
    if (requested.endDate) {
      throw BadRequest(
        "Un plan Vigente no lleva fecha de fin: cámbialo a Vencida para registrarla, o quita la fecha",
      );
    }
    // Cleared unconditionally rather than only when `estado` was the field that
    // changed, so a plan that was already Vigente cannot be left carrying one.
    return { estado, endDate: null };
  }

  const endDate = requested.endDate === undefined ? current.endDate : requested.endDate;
  if (!endDate) {
    throw BadRequest(
      "Para marcar el plan como Vencida debes indicar la fecha de fin: es el último día en que el plan estuvo vigente y define hasta dónde llega su cronograma",
    );
  }
  if (endDate < startDate) {
    throw BadRequest("La fecha de fin no puede ser anterior a la fecha de inicio del plan");
  }
  return { estado, endDate };
}

/**
 * Refuse an end date that would hide work already recorded past it.
 *
 * Narrowing the calendar does not delete anything, which is exactly the danger:
 * the evidences and the grades stay in the database while disappearing from the
 * cronograma, the charts and the compliance percentage, with nothing on screen
 * to explain the drop. Naming the counts hands the administrator the choice —
 * correct the date, or clear those records first — instead of making it for
 * them silently.
 *
 * Only rows the plan *currently* shows are counted. Keys already outside the
 * live calendar (the duplicated period labels written before the API began
 * validating them) are stranded with or without this change, so holding an
 * unrelated end date hostage to them would block every administrator forever.
 */
async function assertNothingRecordedAfter(
  tx: DbTx,
  planId: string,
  plan: { startDate: string; reportPer: string; createdAt: Date },
  endDate: string,
): Promise<void> {
  const endMonth = endDate.slice(0, 7);

  const [evidence] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(pmaEvidences)
    .where(and(eq(pmaEvidences.planId, planId), gt(pmaEvidences.activityMonth, endMonth)));

  const visibleNow = new Set(
    getPlanPeriods(getPlanCalendar({ ...plan, endDate: null })).map((period) => period.key),
  );
  const visibleAfter = new Set(
    getPlanPeriods(getPlanCalendar({ ...plan, endDate })).map((period) => period.key),
  );
  const wouldHide = [...visibleNow].filter((key) => !visibleAfter.has(key));

  const gradedRows = wouldHide.length === 0 ? [] : await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(pmaPeriodCompliance)
    .innerJoin(pmaPlanItems, eq(pmaPeriodCompliance.planItemId, pmaPlanItems.id))
    .where(and(eq(pmaPlanItems.planId, planId), inArray(pmaPeriodCompliance.periodKey, wouldHide)));

  const evidenceCount = evidence?.count ?? 0;
  const gradeCount = gradedRows[0]?.count ?? 0;
  if (evidenceCount === 0 && gradeCount === 0) return;

  const parts: string[] = [];
  if (evidenceCount > 0) {
    parts.push(`${evidenceCount} ${evidenceCount === 1 ? "evidencia" : "evidencias"}`);
  }
  if (gradeCount > 0) {
    parts.push(`${gradeCount} ${gradeCount === 1 ? "calificación" : "calificaciones"}`);
  }
  throw BadRequest(
    `No se puede fijar el fin del plan en ${endDate}: el plan tiene ${parts.join(" y ")} en meses posteriores, que dejarían de verse en el cronograma y en los gráficos. Corrige la fecha o elimina esos registros primero.`,
  );
}

export async function createPlan(actorId: string, input: PlanCreateInput) {
  const db = getDb();
  // A plan created straight into 'Vencida' goes through the same rule as one
  // that gets there by an update: otherwise creation would be a back door to
  // the very state `resolveEstadoEndDate` exists to prevent. There is nothing
  // recorded yet, so the orphan-data guard has nothing to check.
  const { estado, endDate } = resolveEstadoEndDate(
    { estado: input.estado, endDate: input.endDate },
    { estado: input.estado ?? "Vigente", endDate: null },
    input.startDate,
  );
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
        estado,
        reportPer: input.reportPer,
        startDate: input.startDate,
        endDate,
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
    // Locked before the pair is resolved: `estado` and `end_date` are decided
    // against the row's current values, so two concurrent updates must not each
    // read a state the other is about to leave. The same lock covers the
    // orphan-data counts below, which would otherwise be a read that a
    // simultaneous evidence upload could invalidate before the write lands.
    const [existing] = await tx
      .select()
      .from(pmaPlans)
      .where(eq(pmaPlans.id, planId))
      .limit(1)
      .for("update");
    if (!existing) throw NotFound("Plan not found");

    const startDate = toDateOnly(existing.startDate)!;
    const { estado, endDate } = resolveEstadoEndDate(
      { estado: updates.estado, endDate: updates.endDate },
      { estado: existing.estado, endDate: toDateOnly(existing.endDate) },
      startDate,
    );
    if (endDate) {
      await assertNothingRecordedAfter(
        tx,
        planId,
        { startDate, reportPer: existing.reportPer, createdAt: existing.createdAt },
        endDate,
      );
    }

    const [row] = await tx
      .update(pmaPlans)
      // `estado` and `endDate` go last so the resolved pair always wins over
      // whatever `cleaned` carries: the two are decided together, never field
      // by field.
      .set({ ...cleaned, estado, endDate, updatedAt: new Date() })
      .where(eq(pmaPlans.id, planId))
      .returning();
    if (!row) throw NotFound("Plan not found");
    // No item fan-out here any more. `pmaPlanItems.reportPer` used to be
    // rewritten whenever the plan's changed, because item schedules are
    // evaluated against their stored period. `reportPer` is now fixed at
    // creation and `planItemsModule` rejects any item whose value differs from
    // its plan's, so the two cannot drift apart and there is nothing to sync.
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
