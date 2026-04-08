import { adminDb } from "@/lib/firebase-admin";
import { Evidence } from "@/types";

export async function createEvidence(
  planId: string,
  uploadedBy: string,
  uploaderName: string,
  fileName: string,
  driveFileId: string,
  driveUrl: string,
  description: string
): Promise<Evidence> {
  const ref = adminDb.collection("evidences").doc();

  const evidence: Evidence = {
    id: ref.id,
    planId,
    uploadedBy,
    uploaderName,
    fileName,
    driveFileId,
    driveUrl,
    description,
    createdAt: new Date().toISOString(),
  };

  await ref.set(evidence);
  return evidence;
}

export async function getEvidencesByPlan(planId: string): Promise<Evidence[]> {
  const snapshot = await adminDb
    .collection("evidences")
    .where("planId", "==", planId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as Evidence);
}

export async function getEvidencesByReporter(
  userId: string
): Promise<Evidence[]> {
  const snapshot = await adminDb
    .collection("evidences")
    .where("uploadedBy", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as Evidence);
}

export async function deleteEvidence(
  evidenceId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("evidences").doc(evidenceId).get();
  if (!doc.exists) throw new Error("Evidence not found");

  const evidence = doc.data() as Evidence;

  // Verify the plan belongs to this admin
  const planDoc = await adminDb
    .collection("plans")
    .doc(evidence.planId)
    .get();
  if (!planDoc.exists) throw new Error("Plan not found");
  if (planDoc.data()!.adminId !== adminId) throw new Error("Unauthorized");

  await adminDb.collection("evidences").doc(evidenceId).delete();
}
