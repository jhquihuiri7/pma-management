import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPlanAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../../db/schema/pma.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { getStorage, buildEvidencePath } from "../../storage/index.js";
import { assertPmaActivityMonth } from "../../lib/activityMonth.js";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { enqueueStorageCleanupPaths } from "../shared/storageCleanup.js";
import {
  createNotifications,
  getEvidenceResultRecipientIds,
  getEvidenceSubmittedRecipientIds,
} from "./notificationsModule.js";
import { persistDurableFileAndRecord } from "../shared/durableFilePersistence.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type EvidenceCreateInput = {
  planId: string;
  planItemId?: string;
  uploadedBy: string;
  uploaderName: string;
  fileName: string;
  description?: string;
  activityMonth?: string;
  data: Buffer;
  contentType?: string;
};

type EvidenceRow = typeof pmaEvidences.$inferSelect;

function toApi(row: EvidenceRow) {
  const storageUrl = getStorage().getUrl(row.storagePath);
  return {
    id: row.id,
    planId: row.planId,
    planItemId: row.planItemId ?? undefined,
    uploadedBy: row.uploadedBy,
    uploaderName: row.uploaderName,
    fileName: row.fileName,
    storagePath: row.storagePath,
    storageUrl,
    driveFileId: row.storagePath,
    driveUrl: storageUrl,
    description: row.description,
    validationStatus: row.validationStatus,
    validationComment: row.validationComment ?? undefined,
    validatedBy: row.validatedBy ?? undefined,
    validatedAt: row.validatedAt ?? undefined,
    activityMonth: row.activityMonth ?? undefined,
    createdAt: row.createdAt,
  };
}

export async function createEvidence(_adminId: string, input: EvidenceCreateInput) {
  const db = getDb();
  const plan = await db
    .select()
    .from(pmaPlans)
    .where(eq(pmaPlans.id, input.planId))
    .limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const planRow = plan[0];

  let planItem: typeof pmaPlanItems.$inferSelect | null = null;

  if (input.planItemId) {
    const itemRows = await db
      .select()
      .from(pmaPlanItems)
      .where(eq(pmaPlanItems.id, input.planItemId))
      .limit(1);
    planItem = itemRows[0] ?? null;
    if (!planItem) throw NotFound("Plan item not found");
    if (planItem.planId !== input.planId) throw BadRequest("Plan item does not belong to plan");

    if (!input.activityMonth) throw BadRequest("activityMonth is required for item evidence");
    assertPmaActivityMonth({
      activityMonth: input.activityMonth,
      startDate: planRow.startDate,
      createdAt: planRow.createdAt,
      periodicity: planItem.periodicity,
    });
  } else {
    if (input.activityMonth) throw BadRequest("activityMonth requires planItemId");
  }

  const evidenceId = randomUUID();
  const storagePath = buildEvidencePath({
    subsystem: "pma",
    planId: input.planId,
    evidenceId,
    planName: planRow.title,
    planItemId: input.planItemId,
    planItemName: planItem?.item,
    periodFolder: planItem && input.activityMonth
      ? getActivityPeriodFolder(input.activityMonth, planRow.startDate, planRow.createdAt, planItem.reportPer)
      : undefined,
    fileName: input.fileName,
  });

  const row = await persistDurableFileAndRecord({
    path: storagePath,
    data: input.data,
    contentType: input.contentType,
    db,
    reason: `pma:evidence:${evidenceId}`,
    persist: async (tx) => {
      const actor = await lockAndAssertActor(
        tx,
        input.uploadedBy,
        "pma",
        ["ADMIN", "REPORTER", "VIEWER"],
      );

      const [freshPlan] = await tx
        .select()
        .from(pmaPlans)
        .where(eq(pmaPlans.id, input.planId))
        .limit(1)
        .for("update");
      if (!freshPlan) throw NotFound("Plan not found");
      let freshItem: typeof pmaPlanItems.$inferSelect | null = null;
      if (input.planItemId) {
        const [lockedItem] = await tx
          .select()
          .from(pmaPlanItems)
          .where(and(eq(pmaPlanItems.id, input.planItemId), eq(pmaPlanItems.planId, input.planId)))
          .limit(1)
          .for("update");
        if (!lockedItem) throw NotFound("Plan item not found");
        freshItem = lockedItem;
        if (!input.activityMonth) throw BadRequest("activityMonth is required for item evidence");
        assertPmaActivityMonth({
          activityMonth: input.activityMonth,
          startDate: freshPlan.startDate,
          createdAt: freshPlan.createdAt,
          periodicity: freshItem.periodicity,
        });
      }
      if (!(await canUserUploadEvidence(
        input.planId,
        input.planItemId,
        { sub: actor.id, role: actor.role },
        tx,
      ))) throw Forbidden("El acceso al plan o ítem fue revocado durante la subida");

      const [created] = await tx
        .insert(pmaEvidences)
        .values({
          id: evidenceId,
          planId: input.planId,
          planItemId: input.planItemId ?? null,
          uploadedBy: input.uploadedBy,
          uploaderName: actor.name,
          fileName: input.fileName,
          storagePath,
          storageUrl: getStorage().getUrl(storagePath),
          description: input.description ?? "",
          validationStatus: "pending",
          activityMonth: input.activityMonth ?? null,
        })
        .returning();
      if (!created) throw new Error("Evidence insert returned no row");

      const recipientIds = await getEvidenceSubmittedRecipientIds(
        tx,
        input.planId,
        input.uploadedBy
      );
      await createNotifications(
        recipientIds.map((userId) => ({
          userId,
          type: "evidence_submitted" as const,
          title: "Nueva evidencia pendiente",
          message: `${actor.name} subió la evidencia «${input.fileName}».`,
          planId: input.planId,
          planItemId: input.planItemId,
          evidenceId,
          metadata: {
            fileName: input.fileName,
            uploaderName: actor.name,
            validationStatus: "pending",
          },
        })),
        tx
      );
      return created;
    },
  });
  return toApi(row);
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Months an item's evidence range spans, keyed by periodicity (>=1200 = single
// open range). Mirrors PERIODICITY_INTERVAL on the web side (lib/planPeriods).
const PERIODICITY_INTERVAL: Record<string, number> = {
  "Al finalizar la etapa de operacion": 9999,
  "Al finalizar la etapa de operación": 9999,
  "En caso de suceder": 1,
  Diaria: 1,
  Semanal: 1,
  Mensual: 1,
  Bimensual: 2,
  Bianual: 24,
  Trimestral: 3,
  Cuatrimestral: 4,
  Trianual: 36,
  Semestral: 6,
  Anual: 12,
  Permanente: 1,
  "Unica vez": 9999,
  "Única vez": 9999,
};

export function getPeriodicityInterval(periodicity: string | undefined): number {
  const interval = PERIODICITY_INTERVAL[periodicity ?? ""];
  if (interval === undefined) throw BadRequest(`Periodicidad no soportada: ${periodicity ?? "vacía"}`);
  return interval;
}

function getBlockSize(reportPer: string | undefined): number {
  const s = (reportPer ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
}

function getActivityPeriodFolder(
  activityMonth: string,
  startDate: string | null,
  createdAt: Date,
  reportPer: string
): string {
  const [year, month] = activityMonth.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return activityMonth;

  const planStart = startDate ? new Date(`${startDate}T00:00:00`) : createdAt;
  const blockOrigin = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
  const targetDate = new Date(year, month - 1, 1);
  const diff = (targetDate.getFullYear() - blockOrigin.getFullYear()) * 12 +
    (targetDate.getMonth() - blockOrigin.getMonth());
  if (diff < 0) return activityMonth;

  const blockSize = getBlockSize(reportPer);
  const blockIndex = Math.floor(diff / blockSize);
  const blockStart = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + blockIndex * blockSize, 1);
  const blockEnd = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + (blockIndex + 1) * blockSize - 1, 1);
  return `${MONTHS_ES[blockStart.getMonth()]}${blockStart.getFullYear()}-${MONTHS_ES[blockEnd.getMonth()]}${blockEnd.getFullYear()}`;
}

export async function getEvidencesByPlan(planId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmaEvidences)
    .where(eq(pmaEvidences.planId, planId))
    .orderBy(desc(pmaEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidencesByReporter(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmaEvidences)
    .where(eq(pmaEvidences.uploadedBy, userId))
    .orderBy(desc(pmaEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidencesForUser(
  user: Pick<AccessTokenClaims, "sub" | "role">
) {
  const db = getDb();
  if (user.role === "ADMIN") {
    const rows = await db.select().from(pmaEvidences).orderBy(desc(pmaEvidences.createdAt));
    return rows.map(toApi);
  }
  if (user.role === "REPORTER") return getEvidencesByReporter(user.sub);

  const explicitPlanAccess = db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(and(
      eq(pmaPlanAssignments.userId, user.sub),
      eq(pmaPlanAssignments.planId, pmaEvidences.planId),
      eq(pmaPlanAssignments.explicitAccess, true)
    ));
  const exactItemAccess = db
    .select({ planItemId: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(
      eq(pmaItemAssignments.userId, user.sub),
      eq(pmaItemAssignments.planItemId, pmaEvidences.planItemId),
      eq(pmaPlanItems.planId, pmaEvidences.planId)
    ));
  const rows = await db
    .select()
    .from(pmaEvidences)
    .where(or(exists(explicitPlanAccess), exists(exactItemAccess)))
    .orderBy(desc(pmaEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidenceById(id: string) {
  const db = getDb();
  const rows = await db.select().from(pmaEvidences).where(eq(pmaEvidences.id, id)).limit(1);
  return rows[0] ? toApi(rows[0]) : null;
}

export async function getEvidenceByStoragePath(storagePath: string) {
  const rows = await getDb()
    .select()
    .from(pmaEvidences)
    .where(eq(pmaEvidences.storagePath, storagePath))
    .limit(1);
  return rows[0] ? toApi(rows[0]) : null;
}

export type EvidenceAccessAction = "read" | "validate" | "delete";

export async function canUserAccessEvidence(
  evidence: { planId: string; planItemId?: string | null; uploadedBy?: string | null },
  user: Pick<AccessTokenClaims, "sub" | "role">,
  action: EvidenceAccessAction = "read",
  db: any = getDb(),
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (user.role === "REPORTER") {
    // Item access lets a reporter work on that item, but never exposes files
    // uploaded by somebody else.
    return action !== "validate" && evidence.uploadedBy === user.sub;
  }

  const planRows = await db
    .select({ planId: pmaPlanAssignments.planId })
    .from(pmaPlanAssignments)
    .where(and(
      eq(pmaPlanAssignments.planId, evidence.planId),
      eq(pmaPlanAssignments.userId, user.sub),
      eq(pmaPlanAssignments.explicitAccess, true)
    ))
    .limit(1);
  if (planRows.length > 0) return true;
  if (!evidence.planItemId) return false;

  const itemRows = await db
    .select({ planItemId: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(
      eq(pmaItemAssignments.userId, user.sub),
      eq(pmaItemAssignments.planItemId, evidence.planItemId),
      eq(pmaPlanItems.planId, evidence.planId)
    ))
    .limit(1);
  return itemRows.length > 0;
}

export async function canUserUploadEvidence(
  planId: string,
  planItemId: string | undefined,
  user: Pick<AccessTokenClaims, "sub" | "role">,
  db: any = getDb(),
): Promise<boolean> {
  if (user.role === "ADMIN") return true;

  // VIEWERs manage their assigned plans and may upload evidence there, scoped
  // to an explicit plan grant or an item they are assigned to.
  if (user.role === "VIEWER") {
    const planGrant = await db
      .select({ planId: pmaPlanAssignments.planId })
      .from(pmaPlanAssignments)
      .where(and(
        eq(pmaPlanAssignments.planId, planId),
        eq(pmaPlanAssignments.userId, user.sub),
        eq(pmaPlanAssignments.explicitAccess, true)
      ))
      .limit(1);
    if (planGrant.length > 0) return true;
    if (!planItemId) return false;
    const viewerItem = await db
      .select({ planItemId: pmaItemAssignments.planItemId })
      .from(pmaItemAssignments)
      .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
      .where(and(
        eq(pmaItemAssignments.userId, user.sub),
        eq(pmaItemAssignments.planItemId, planItemId),
        eq(pmaPlanItems.planId, planId)
      ))
      .limit(1);
    return viewerItem.length > 0;
  }

  if (user.role !== "REPORTER") return false;
  if (!planItemId) return false;

  const exactItem = await db
    .select({ planItemId: pmaItemAssignments.planItemId })
    .from(pmaItemAssignments)
    .innerJoin(pmaPlanItems, eq(pmaItemAssignments.planItemId, pmaPlanItems.id))
    .where(and(
      eq(pmaItemAssignments.userId, user.sub),
      eq(pmaItemAssignments.planItemId, planItemId),
      eq(pmaPlanItems.planId, planId)
    ))
    .limit(1);
  return exactItem.length > 0;
}

export async function updateEvidenceValidation(
  evidenceId: string,
  status: "valid" | "invalid" | "pending",
  _adminId: string,
  validatedBy: string,
  validationComment?: string
) {
  if (status === "invalid" && !validationComment?.trim()) {
    throw BadRequest("El motivo de rechazo es obligatorio");
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(
      tx,
      validatedBy,
      "pma",
      ["ADMIN", "VIEWER"],
    );
    const [evidence] = await tx
      .select()
      .from(pmaEvidences)
      .where(eq(pmaEvidences.id, evidenceId))
      .limit(1)
      .for("update");
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(
      evidence,
      { sub: actor.id, role: actor.role },
      "validate",
      tx,
    ))) {
      throw Forbidden("El acceso a la evidencia fue revocado durante la validación");
    }

    const previousStatus = evidence.validationStatus;
    const [row] = await tx
      .update(pmaEvidences)
      .set({
        validationStatus: status,
        validatedAt: status === "pending" ? null : new Date(),
        validatedBy: status === "pending" ? null : validatedBy,
        validationComment: status === "invalid" ? validationComment!.trim() : null,
      })
      .where(eq(pmaEvidences.id, evidenceId))
      .returning();
    if (!row) throw new Error("Evidence validation update returned no row");

    if (status !== previousStatus && status !== "pending") {
      const recipientIds = await getEvidenceResultRecipientIds(tx, evidence.uploadedBy, validatedBy);
      const approved = status === "valid";
      await createNotifications(
        recipientIds.map((userId) => ({
          userId,
          type: approved ? "evidence_approved" as const : "evidence_rejected" as const,
          title: approved ? "Evidencia aprobada" : "Evidencia rechazada",
          message: `Tu evidencia «${evidence.fileName}» fue ${approved ? "aprobada" : "rechazada"}.`,
          planId: evidence.planId,
          planItemId: evidence.planItemId ?? undefined,
          evidenceId,
          metadata: {
            fileName: evidence.fileName,
            validationStatus: status,
          },
        })),
        tx
      );
    }

    return { evidence: toApi(row), previousStatus };
  });
}

export async function deleteEvidence(evidenceId: string, actorId: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(
      tx,
      actorId,
      "pma",
      ["ADMIN", "REPORTER", "VIEWER"],
    );
    const [evidence] = await tx
      .select()
      .from(pmaEvidences)
      .where(eq(pmaEvidences.id, evidenceId))
      .limit(1)
      .for("update");
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(
      evidence,
      { sub: actor.id, role: actor.role },
      "delete",
      tx,
    ))) {
      throw Forbidden("El acceso a la evidencia fue revocado durante la eliminación");
    }
    const deleted = await tx
      .delete(pmaEvidences)
      .where(eq(pmaEvidences.id, evidenceId))
      .returning({ id: pmaEvidences.id });
    if (deleted.length !== 1) throw NotFound("Evidence not found");
    await enqueueStorageCleanupPaths(tx, [evidence.storagePath], `pma:evidence:${evidenceId}`);
  });
}
