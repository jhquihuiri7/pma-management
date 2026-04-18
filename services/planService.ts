import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { Plan, Assignment, PlanReporte, PlanTipo, PlanFase, PlanEnfoque, Evidence } from "@/types";

export async function createPlan(
  adminId: string,
  title: string,
  description: string,
  report_per: PlanReporte = "6 meses",
  driveFolderId?: string,
  tipo?: PlanTipo,
  start_date?: string,
  fase?: PlanFase,
  enfoque?: PlanEnfoque
): Promise<Plan> {
  const planRef = adminDb.collection("pma_plans").doc();
  const now = new Date().toISOString();

  const plan: Plan = {
    id: planRef.id,
    adminId,
    title,
    description,
    ...(tipo ? { tipo } : {}),
    ...(fase ? { fase } : {}),
    ...(enfoque ? { enfoque } : {}),
    report_per,
    ...(start_date ? { start_date } : {}),
    ...(driveFolderId ? { driveFolderId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await planRef.set(plan);
  return plan;
}

export async function getPlansByAdmin(adminId: string): Promise<Plan[]> {
  const snapshot = await adminDb
    .collection("pma_plans")
    .where("adminId", "==", adminId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
  });
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const doc = await adminDb.collection("pma_plans").doc(planId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
}

export async function updatePlan(
  planId: string,
  adminId: string,
  updates: { title?: string; description?: string; report_per?: PlanReporte; tipo?: PlanTipo; start_date?: string; fase?: PlanFase; enfoque?: PlanEnfoque }
): Promise<Plan> {
  const doc = await adminDb.collection("pma_plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const plan = doc.data() as Plan;
  if (plan.adminId !== adminId) throw new Error("Unauthorized");

  const updateData = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await adminDb.collection("pma_plans").doc(planId).update(updateData);
  return { ...plan, ...updateData };
}

export async function deletePlan(
  planId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("pma_plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const plan = doc.data() as Plan;
  if (plan.adminId !== adminId) throw new Error("Unauthorized");

  // Delete the entire plan Drive folder (cascades all subfolders and evidence files)
  if (plan.driveFolderId) {
    try {
      const drive = await getAuthenticatedDrive(adminId);
      await drive.files.delete({ fileId: plan.driveFolderId });
    } catch {
      // Continue with Firestore deletion even if Drive deletion fails
    }
  }

  // Query all related Firestore collections in parallel
  const [assignments, evidences, planItems, periodCompliance, notifications] =
    await Promise.all([
      adminDb.collection("pma_assignments").where("planId", "==", planId).get(),
      adminDb.collection("pma_evidences").where("planId", "==", planId).get(),
      adminDb.collection("pma_planItems").where("planId", "==", planId).get(),
      adminDb.collection("pma_periodCompliance").where("planId", "==", planId).get(),
      adminDb.collection("pma_notifications").where("planId", "==", planId).get(),
    ]);

  // Collect all refs to delete (including the plan document itself)
  const allRefs = [
    ...assignments.docs.map((d) => d.ref),
    ...evidences.docs.map((d) => d.ref),
    ...planItems.docs.map((d) => d.ref),
    ...periodCompliance.docs.map((d) => d.ref),
    ...notifications.docs.map((d) => d.ref),
    adminDb.collection("pma_plans").doc(planId),
  ];

  // Firestore batch limit is 500 — split into chunks
  const CHUNK_SIZE = 499;
  for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
    const batch = adminDb.batch();
    allRefs.slice(i, i + CHUNK_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// --- Assignment management ---

export async function assignUserToPlan(
  userId: string,
  planId: string,
  adminId: string
): Promise<Assignment> {
  // Verify plan belongs to admin
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw new Error("Unauthorized");

  // Check for duplicate
  const existing = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .where("planId", "==", planId)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error("User is already assigned to this plan");
  }

  const ref = adminDb.collection("pma_assignments").doc();
  const assignment: Assignment = {
    id: ref.id,
    userId,
    planId,
    createdAt: new Date().toISOString(),
  };

  await ref.set(assignment);
  return assignment;
}

export async function unassignUserFromPlan(
  userId: string,
  planId: string,
  adminId: string
): Promise<void> {
  const plan = await getPlanById(planId);
  if (!plan || plan.adminId !== adminId) throw new Error("Unauthorized");

  const snapshot = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .where("planId", "==", planId)
    .limit(1)
    .get();

  if (snapshot.empty) throw new Error("Assignment not found");
  await snapshot.docs[0].ref.delete();
}

export async function getPlansForReporter(userId: string): Promise<Plan[]> {
  // Collect planIds from plan-level assignments
  const assignmentSnap = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .get();
  const planIdSet = new Set<string>(
    assignmentSnap.docs.map((doc) => doc.data().planId as string)
  );

  // Also collect planIds from item-level assignments
  const itemSnap = await adminDb.collection("pma_planItems").get();
  itemSnap.docs.forEach((doc) => {
    const users: { userId: string }[] = doc.data().assignedUsers ?? [];
    if (users.some((u) => u.userId === userId)) {
      planIdSet.add(doc.data().planId as string);
    }
  });

  if (planIdSet.size === 0) return [];

  const refs = Array.from(planIdSet).map((pid) =>
    adminDb.collection("pma_plans").doc(pid)
  );
  const snapshots = await adminDb.getAll(...refs);
  return snapshots
    .filter((doc) => doc.exists)
    .map((doc) => {
      const data = doc.data()!;
      return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
    });
}

export async function getPlansForViewer(userId: string): Promise<Plan[]> {
  // Viewer only sees plans assigned at the plan level (not via items)
  const assignmentSnap = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .get();

  const planIds = assignmentSnap.docs.map((doc) => doc.data().planId as string);

  if (planIds.length === 0) return [];

  const refs = planIds.map((pid) => adminDb.collection("pma_plans").doc(pid));
  const snapshots = await adminDb.getAll(...refs);
  return snapshots
    .filter((doc) => doc.exists)
    .map((doc) => {
      const data = doc.data()!;
      return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
    });
}

export async function isUserAssignedToPlan(userId: string, planId: string): Promise<boolean> {
  const snap = await adminDb
    .collection("pma_assignments")
    .where("userId", "==", userId)
    .where("planId", "==", planId)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function getAssignedUsers(planId: string): Promise<string[]> {
  const snapshot = await adminDb
    .collection("pma_assignments")
    .where("planId", "==", planId)
    .get();

  return snapshot.docs.map((doc) => doc.data().userId);
}
