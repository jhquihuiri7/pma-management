import { eq, desc, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaEvidences, pmaPlans } from "../../db/schema/pma.js";
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
  const plan = await db
    .select()
    .from(pmaPlans)
    .where(eq(pmaPlans.id, input.planId))
    .limit(1);
  if (plan.length === 0) throw NotFound("Plan not found");

  const storagePath = buildEvidencePath({
    adminId,
    subsystem: "pma",
    planId: input.planId,
    planItemId: input.planItemId,
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
  return row;
}

export async function getEvidencesByPlan(planId: string) {
  const db = getDb();
  return db
    .select()
    .from(pmaEvidences)
    .where(eq(pmaEvidences.planId, planId))
    .orderBy(desc(pmaEvidences.createdAt));
}

export async function getEvidencesByReporter(userId: string) {
  const db = getDb();
  return db
    .select()
    .from(pmaEvidences)
    .where(eq(pmaEvidences.uploadedBy, userId))
    .orderBy(desc(pmaEvidences.createdAt));
}

export async function getEvidenceById(id: string) {
  const db = getDb();
  const rows = await db.select().from(pmaEvidences).where(eq(pmaEvidences.id, id)).limit(1);
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
  const plan = await db.select().from(pmaPlans).where(eq(pmaPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();

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
  return { evidence: row, previousStatus };
}

export async function deleteEvidence(evidenceId: string, adminId: string) {
  const db = getDb();
  const evidence = await getEvidenceById(evidenceId);
  if (!evidence) throw NotFound("Evidence not found");
  const plan = await db.select().from(pmaPlans).where(eq(pmaPlans.id, evidence.planId)).limit(1);
  if (plan.length === 0 || plan[0].adminId !== adminId) throw Forbidden();

  // Remove the file first; if the DB delete fails we won't leave an orphan file.
  try {
    await getStorage().delete(evidence.storagePath);
  } catch {
    // ignore storage errors; record is still valid to remove
  }
  await db.delete(pmaEvidences).where(eq(pmaEvidences.id, evidenceId));
}
