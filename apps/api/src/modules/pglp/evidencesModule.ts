import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pglpEvidences, pglpPlans } from "../../db/schema/pglp.js";
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
  const plan = await db.select().from(pglpPlans).where(eq(pglpPlans.id, input.planId)).limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");

  const storagePath = buildEvidencePath({
    adminId,
    subsystem: "pglp",
    planId: input.planId,
    planItemId: input.planItemId,
    fileName: input.fileName,
  });
  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });

  const [row] = await db
    .insert(pglpEvidences)
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
  getDb().select().from(pglpEvidences).where(eq(pglpEvidences.planId, planId)).orderBy(desc(pglpEvidences.createdAt));

export const getEvidencesByReporter = (userId: string) =>
  getDb().select().from(pglpEvidences).where(eq(pglpEvidences.uploadedBy, userId)).orderBy(desc(pglpEvidences.createdAt));

async function getEvidenceById(id: string) {
  const rows = await getDb().select().from(pglpEvidences).where(eq(pglpEvidences.id, id)).limit(1);
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
  const plan = await db.select().from(pglpPlans).where(eq(pglpPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();
  const previousStatus = evidence.validationStatus;
  const [row] = await db
    .update(pglpEvidences)
    .set({
      validationStatus: status,
      validatedAt: new Date(),
      validatedBy,
      validationComment: status === "invalid" ? (validationComment ?? "").trim() : "",
    })
    .where(eq(pglpEvidences.id, evidenceId))
    .returning();
  return { evidence: row, previousStatus };
}

export async function deleteEvidence(evidenceId: string, adminId: string) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(pglpPlans).where(eq(pglpPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();
  try { await getStorage().delete(evidence.storagePath); } catch { /* ignore */ }
  await db.delete(pglpEvidences).where(eq(pglpEvidences.id, evidenceId));
}
