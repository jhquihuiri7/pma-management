import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { Evidence, EvidenceValidationStatus } from "@/types";

export async function createEvidence(
  planId: string,
  uploadedBy: string,
  uploaderName: string,
  fileName: string,
  driveFileId: string,
  driveUrl: string,
  description: string,
  planItemId?: string,
  activityMonth?: string
): Promise<Evidence> {
  const ref = adminDb.collection("pma_evidences").doc();

  const evidence: Evidence = {
    id: ref.id,
    planId,
    ...(planItemId ? { planItemId } : {}),
    ...(activityMonth ? { activityMonth } : {}),
    uploadedBy,
    uploaderName,
    fileName,
    driveFileId,
    driveUrl,
    description,
    validationStatus: "pending",
    createdAt: new Date().toISOString(),
  };

  await ref.set(evidence);
  return evidence;
}

export async function getEvidencesByPlan(planId: string): Promise<Evidence[]> {
  const snapshot = await adminDb
    .collection("pma_evidences")
    .where("planId", "==", planId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as Evidence);
}

export async function getEvidencesByReporter(
  userId: string
): Promise<Evidence[]> {
  const snapshot = await adminDb
    .collection("pma_evidences")
    .where("uploadedBy", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as Evidence);
}

export async function updateEvidenceValidation(
  evidenceId: string,
  status: EvidenceValidationStatus,
  adminId: string,
  options?: { validationComment?: string | null; validatedBy?: string }
): Promise<{ evidence: Evidence; previousStatus: EvidenceValidationStatus }> {
  const ref = adminDb.collection("pma_evidences").doc(evidenceId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Evidence not found");

  const current = doc.data() as Evidence;

  const planDoc = await adminDb.collection("pma_plans").doc(current.planId).get();
  if (!planDoc.exists) throw new Error("Plan not found");
  if (planDoc.data()!.adminId !== adminId) throw new Error("Unauthorized");

  const updateData: Partial<Evidence> = {
    validationStatus: status,
    validatedAt: new Date().toISOString(),
  };

  if (options?.validatedBy) {
    updateData.validatedBy = options.validatedBy;
  }

  if (status === "invalid") {
    updateData.validationComment = (options?.validationComment ?? "").trim();
  } else {
    updateData.validationComment = "";
  }

  await ref.update(updateData);

  return {
    evidence: { ...current, ...updateData },
    previousStatus: current.validationStatus ?? "pending",
  };
}

export async function deleteEvidence(
  evidenceId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("pma_evidences").doc(evidenceId).get();
  if (!doc.exists) throw new Error("Evidence not found");

  const evidence = doc.data() as Evidence;

  // Verify the plan belongs to this admin
  const planDoc = await adminDb
    .collection("pma_plans")
    .doc(evidence.planId)
    .get();
  if (!planDoc.exists) throw new Error("Plan not found");
  if (planDoc.data()!.adminId !== adminId) throw new Error("Unauthorized");

  // Delete file from Google Drive
  try {
    const drive = await getAuthenticatedDrive(adminId);
    await drive.files.delete({ fileId: evidence.driveFileId });
  } catch {
    // Continue with Firestore deletion even if Drive delete fails
  }

  await adminDb.collection("pma_evidences").doc(evidenceId).delete();
}
