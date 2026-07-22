import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  rgdpEvidences,
  rgdpItemAssignments,
  rgdpPlanAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../../db/schema/rgdp.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { getStorage, buildEvidencePath } from "../../storage/index.js";
import { assertRgdpActivityMonth } from "../../lib/activityMonth.js";
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

type EvidenceRow = typeof rgdpEvidences.$inferSelect;

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
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, input.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const planRow = plan[0];

  let planItem: typeof rgdpPlanItems.$inferSelect | null = null;

  if (input.planItemId) {
    const itemRows = await db
      .select()
      .from(rgdpPlanItems)
      .where(eq(rgdpPlanItems.id, input.planItemId))
      .limit(1);
    planItem = itemRows[0] ?? null;
    if (!planItem) throw NotFound("Plan item not found");
    if (planItem.planId !== input.planId) throw BadRequest("Plan item does not belong to plan");
    if (!input.activityMonth) throw BadRequest("activityMonth is required for item evidence");
    assertRgdpActivityMonth({
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
    subsystem: "rgdp",
    planId: input.planId,
    evidenceId,
    planName: planRow.title,
    planItemId: input.planItemId,
    planItemName: planItem?.item,
    periodFolder: planItem && input.activityMonth ? getMonthlyFolderName(input.activityMonth) : undefined,
    fileName: input.fileName,
  });
  const row = await persistDurableFileAndRecord({
    path: storagePath,
    data: input.data,
    contentType: input.contentType,
    db,
    reason: `rgdp:evidence:${evidenceId}`,
    persist: async (tx) => {
      const actor = await lockAndAssertActor(
        tx,
        input.uploadedBy,
        "rgdp",
        ["ADMIN", "REPORTER"],
      );

      const [freshPlan] = await tx
        .select()
        .from(rgdpPlans)
        .where(eq(rgdpPlans.id, input.planId))
        .limit(1)
        .for("update");
      if (!freshPlan) throw NotFound("Plan not found");
      if (input.planItemId) {
        const [freshItem] = await tx
          .select()
          .from(rgdpPlanItems)
          .where(and(eq(rgdpPlanItems.id, input.planItemId), eq(rgdpPlanItems.planId, input.planId)))
          .limit(1)
          .for("update");
        if (!freshItem) throw NotFound("Plan item not found");
        if (!input.activityMonth) throw BadRequest("activityMonth is required for item evidence");
        assertRgdpActivityMonth({
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
      ))) throw Forbidden("El acceso al ítem fue revocado durante la subida");

      const [created] = await tx
        .insert(rgdpEvidences)
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

function getMonthlyFolderName(activityMonth: string): string {
  const [year, month] = activityMonth.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return activityMonth;
  return `${MONTHS_ES[month - 1]}${year}`;
}

export async function getEvidencesByPlan(planId: string) {
  const rows = await getDb()
    .select()
    .from(rgdpEvidences)
    .where(eq(rgdpEvidences.planId, planId))
    .orderBy(desc(rgdpEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidencesByReporter(userId: string) {
  const rows = await getDb()
    .select()
    .from(rgdpEvidences)
    .where(eq(rgdpEvidences.uploadedBy, userId))
    .orderBy(desc(rgdpEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidencesForUser(
  user: Pick<AccessTokenClaims, "sub" | "role">
) {
  const db = getDb();
  if (user.role === "ADMIN") {
    const rows = await db.select().from(rgdpEvidences).orderBy(desc(rgdpEvidences.createdAt));
    return rows.map(toApi);
  }
  if (user.role === "REPORTER") return getEvidencesByReporter(user.sub);

  const explicitPlanAccess = db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(and(
      eq(rgdpPlanAssignments.userId, user.sub),
      eq(rgdpPlanAssignments.planId, rgdpEvidences.planId),
      eq(rgdpPlanAssignments.explicitAccess, true)
    ));
  const exactItemAccess = db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(and(
      eq(rgdpItemAssignments.userId, user.sub),
      eq(rgdpItemAssignments.planItemId, rgdpEvidences.planItemId),
      eq(rgdpPlanItems.planId, rgdpEvidences.planId)
    ));
  const rows = await db
    .select()
    .from(rgdpEvidences)
    .where(or(exists(explicitPlanAccess), exists(exactItemAccess)))
    .orderBy(desc(rgdpEvidences.createdAt));
  return rows.map(toApi);
}

export async function getEvidenceById(id: string) {
  const rows = await getDb().select().from(rgdpEvidences).where(eq(rgdpEvidences.id, id)).limit(1);
  return rows[0] ? toApi(rows[0]) : null;
}

export async function getEvidenceByStoragePath(storagePath: string) {
  const rows = await getDb()
    .select()
    .from(rgdpEvidences)
    .where(eq(rgdpEvidences.storagePath, storagePath))
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
    // Being assigned to an item authorizes work on that item, not access to
    // files submitted by another reporter. Keep every RGDP listing/storage
    // path consistent with the general "mine" view.
    return action !== "validate" && evidence.uploadedBy === user.sub;
  }

  const planRows = await db
    .select({ planId: rgdpPlanAssignments.planId })
    .from(rgdpPlanAssignments)
    .where(and(
      eq(rgdpPlanAssignments.planId, evidence.planId),
      eq(rgdpPlanAssignments.userId, user.sub),
      eq(rgdpPlanAssignments.explicitAccess, true)
    ))
    .limit(1);
  if (planRows.length > 0) return true;
  if (!evidence.planItemId) return false;

  const itemRows = await db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(and(
      eq(rgdpItemAssignments.userId, user.sub),
      eq(rgdpItemAssignments.planItemId, evidence.planItemId),
      eq(rgdpPlanItems.planId, evidence.planId)
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
  // Upload is an explicit ADMIN/REPORTER capability. Keep this fail-closed so
  // a VIEWER assignment can never become write access if a route guard is
  // accidentally omitted or this policy is reused elsewhere.
  if (user.role !== "REPORTER") return false;
  if (!planItemId) return false;
  const exactItem = await db
    .select({ planItemId: rgdpItemAssignments.planItemId })
    .from(rgdpItemAssignments)
    .innerJoin(rgdpPlanItems, eq(rgdpItemAssignments.planItemId, rgdpPlanItems.id))
    .where(and(
      eq(rgdpItemAssignments.userId, user.sub),
      eq(rgdpItemAssignments.planItemId, planItemId),
      eq(rgdpPlanItems.planId, planId)
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
      "rgdp",
      ["ADMIN"],
    );
    const [evidence] = await tx
      .select()
      .from(rgdpEvidences)
      .where(eq(rgdpEvidences.id, evidenceId))
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
      .update(rgdpEvidences)
      .set({
        validationStatus: status,
        validatedAt: status === "pending" ? null : new Date(),
        validatedBy: status === "pending" ? null : validatedBy,
        validationComment: status === "invalid" ? validationComment!.trim() : null,
      })
      .where(eq(rgdpEvidences.id, evidenceId))
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
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(
      tx,
      actorId,
      "rgdp",
      ["ADMIN"],
    );
    const [evidence] = await tx
      .select()
      .from(rgdpEvidences)
      .where(eq(rgdpEvidences.id, evidenceId))
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
      .delete(rgdpEvidences)
      .where(eq(rgdpEvidences.id, evidenceId))
      .returning({ id: rgdpEvidences.id });
    if (deleted.length !== 1) throw NotFound("Evidence not found");
    await enqueueStorageCleanupPaths(tx, [evidence.storagePath], `rgdp:evidence:${evidenceId}`);
    return deleted[0];
  });
}
