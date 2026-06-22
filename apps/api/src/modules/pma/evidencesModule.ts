import { eq, desc, asc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaEvidences, pmaPlanItems, pmaPlans } from "../../db/schema/pma.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { getStorage, buildEvidencePath } from "../../storage/index.js";

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

export async function createEvidence(adminId: string, input: EvidenceCreateInput) {
  const db = getDb();
  const plan = await db
    .select()
    .from(pmaPlans)
    .where(eq(pmaPlans.id, input.planId))
    .limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const planRow = plan[0];

  let planItem: typeof pmaPlanItems.$inferSelect | null = null;
  let subsystemName = "Sin proceso";

  if (input.planItemId) {
    const itemRows = await db
      .select()
      .from(pmaPlanItems)
      .where(eq(pmaPlanItems.id, input.planItemId))
      .limit(1);
    planItem = itemRows[0] ?? null;
    if (!planItem) throw NotFound("Plan item not found");
    if (planItem.planId !== input.planId) throw BadRequest("Plan item does not belong to plan");
    subsystemName = planItem.subplan || subsystemName;
  } else {
    const firstItemRows = await db
      .select()
      .from(pmaPlanItems)
      .where(eq(pmaPlanItems.planId, input.planId))
      .orderBy(asc(pmaPlanItems.createdAt))
      .limit(1);
    subsystemName = firstItemRows[0]?.subplan || subsystemName;
  }

  const storagePath = buildEvidencePath({
    adminId,
    subsystem: "pma",
    planId: input.planId,
    planName: planRow.title,
    subsystemName,
    planItemId: input.planItemId,
    planItemName: planItem?.item,
    periodFolder: planItem && input.activityMonth
      ? getActivityPeriodFolder(input.activityMonth, planRow.startDate, planRow.createdAt, planItem.reportPer)
      : undefined,
    fileName: input.fileName,
  });

  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });

  const [row] = await db
    .insert(pmaEvidences)
    .values({
      planId: input.planId,
      planItemId: input.planItemId ?? null,
      uploadedBy: input.uploadedBy,
      uploaderName: input.uploaderName,
      fileName: input.fileName,
      storagePath,
      storageUrl: getStorage().getUrl(storagePath),
      description: input.description ?? "",
      validationStatus: "pending",
      activityMonth: input.activityMonth ?? null,
    })
    .returning();
  return toApi(row);
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

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

export async function getEvidenceById(id: string) {
  const db = getDb();
  const rows = await db.select().from(pmaEvidences).where(eq(pmaEvidences.id, id)).limit(1);
  return rows[0] ? toApi(rows[0]) : null;
}

export async function updateEvidenceValidation(
  evidenceId: string,
  status: "valid" | "invalid" | "pending",
  adminId: string,
  validatedBy: string,
  validationComment?: string
) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(pmaPlans).where(eq(pmaPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");

  const previousStatus = evidence.validationStatus;
  const [row] = await db
    .update(pmaEvidences)
    .set({
      validationStatus: status,
      validatedAt: new Date(),
      validatedBy,
      validationComment: status === "invalid" ? (validationComment ?? "").trim() : "",
    })
    .where(eq(pmaEvidences.id, evidenceId))
    .returning();
  return { evidence: toApi(row), previousStatus };
}

export async function deleteEvidence(evidenceId: string, adminId: string) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(pmaPlans).where(eq(pmaPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");

  // Remove the file first; if the DB delete fails we won't leave an orphan file.
  try {
    await getStorage().delete(evidence.storagePath);
  } catch {
    // ignore storage errors; record is still valid to remove
  }
  await db.delete(pmaEvidences).where(eq(pmaEvidences.id, evidenceId));
}
