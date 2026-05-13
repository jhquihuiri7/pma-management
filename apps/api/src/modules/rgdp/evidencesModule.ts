import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpEvidences, rgdpPlans } from "../../db/schema/rgdp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
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

export async function createEvidence(adminId: string, input: EvidenceCreateInput) {
  const db = getDb();
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, input.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");

  const storagePath = buildEvidencePath({
    adminId,
    subsystem: "rgdp",
    planId: input.planId,
    planItemId: input.planItemId,
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
  return row;
}

export const getEvidencesByPlan = (planId: string) =>
  getDb().select().from(rgdpEvidences).where(eq(rgdpEvidences.planId, planId)).orderBy(desc(rgdpEvidences.createdAt));

export const getEvidencesByReporter = (userId: string) =>
  getDb().select().from(rgdpEvidences).where(eq(rgdpEvidences.uploadedBy, userId)).orderBy(desc(rgdpEvidences.createdAt));

async function getEvidenceById(id: string) {
  const rows = await getDb().select().from(rgdpEvidences).where(eq(rgdpEvidences.id, id)).limit(1);
  return rows[0] ?? null;
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
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();
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
  return { evidence: row, previousStatus };
}

export async function deleteEvidence(evidenceId: string, adminId: string) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(rgdpPlans).where(eq(rgdpPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();
  try { await getStorage().delete(evidence.storagePath); } catch { /* ignore */ }
  await db.delete(rgdpEvidences).where(eq(rgdpEvidences.id, evidenceId));
}
