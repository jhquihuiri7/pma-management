import { eq, desc, asc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpEvidences, rgdpPlanItems, rgdpPlans } from "../../db/schema/rgdp.js";
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

export async function createEvidence(adminId: string, input: EvidenceCreateInput) {
  const db = getDb();
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, input.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const planRow = plan[0];

  let planItem: typeof rgdpPlanItems.$inferSelect | null = null;
  let subsystemName = "Sin proceso";

  if (input.planItemId) {
    const itemRows = await db
      .select()
      .from(rgdpPlanItems)
      .where(eq(rgdpPlanItems.id, input.planItemId))
      .limit(1);
    planItem = itemRows[0] ?? null;
    if (!planItem) throw NotFound("Plan item not found");
    if (planItem.planId !== input.planId) throw BadRequest("Plan item does not belong to plan");
    subsystemName = planItem.subplan || subsystemName;
  } else {
    const firstItemRows = await db
      .select()
      .from(rgdpPlanItems)
      .where(eq(rgdpPlanItems.planId, input.planId))
      .orderBy(asc(rgdpPlanItems.createdAt))
      .limit(1);
    subsystemName = firstItemRows[0]?.subplan || subsystemName;
  }

  const storagePath = buildEvidencePath({
    adminId,
    subsystem: "rgdp",
    planId: input.planId,
    planName: planRow.title,
    subsystemName,
    planItemId: input.planItemId,
    planItemName: planItem?.item,
    periodFolder: planItem && input.activityMonth ? getMonthlyFolderName(input.activityMonth) : undefined,
    fileName: input.fileName,
  });
  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });

  const [row] = await db
    .insert(rgdpEvidences)
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

async function getEvidenceById(id: string) {
  const rows = await getDb().select().from(rgdpEvidences).where(eq(rgdpEvidences.id, id)).limit(1);
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
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  const previousStatus = evidence.validationStatus;
  const [row] = await db
    .update(rgdpEvidences)
    .set({
      validationStatus: status,
      validatedAt: new Date(),
      validatedBy,
      validationComment: status === "invalid" ? (validationComment ?? "").trim() : "",
    })
    .where(eq(rgdpEvidences.id, evidenceId))
    .returning();
  return { evidence: toApi(row), previousStatus };
}

export async function deleteEvidence(evidenceId: string, adminId: string) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");
  try { await getStorage().delete(evidence.storagePath); } catch { /* ignore */ }
  await db.delete(rgdpEvidences).where(eq(rgdpEvidences.id, evidenceId));
}
