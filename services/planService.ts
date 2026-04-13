import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { Plan, Assignment, PlanReporte, PlanTipo, Evidence } from "@/types";

export async function createPlan(
  adminId: string,
  title: string,
  description: string,
  report_per: PlanReporte = "6 meses",
  driveFolderId?: string,
  tipo?: PlanTipo
): Promise<Plan> {
  const planRef = adminDb.collection("plans").doc();
  const now = new Date().toISOString();

  const plan: Plan = {
    id: planRef.id,
    adminId,
    title,
    description,
    ...(tipo ? { tipo } : {}),
    report_per,
    ...(driveFolderId ? { driveFolderId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await planRef.set(plan);
  return plan;
}

export async function getPlansByAdmin(adminId: string): Promise<Plan[]> {
  const snapshot = await adminDb
    .collection("plans")
    .where("adminId", "==", adminId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
  });
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { ...data, report_per: data.report_per ?? "6 meses" } as Plan;
}

export async function updatePlan(
  planId: string,
  adminId: string,
  updates: { title?: string; description?: string; report_per?: PlanReporte }
): Promise<Plan> {
  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const plan = doc.data() as Plan;
  if (plan.adminId !== adminId) throw new Error("Unauthorized");

  const updateData = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await adminDb.collection("plans").doc(planId).update(updateData);
  return { ...plan, ...updateData };
}

export async function deletePlan(
  planId: string,
  adminId: string
): Promise<void> {
  const doc = await adminDb.collection("plans").doc(planId).get();
  if (!doc.exists) throw new Error("Plan not found");

  const plan = doc.data() as Plan;
  if (plan.adminId !== adminId) throw new Error("Unauthorized");

  // Delete assignments and evidences for this plan
  const [assignments, evidences] = await Promise.all([
    adminDb.collection("assignments").where("planId", "==", planId).get(),
    adminDb.collection("evidences").where("planId", "==", planId).get(),
  ]);

  // Delete evidence files from Google Drive
  if (!evidences.empty) {
    try {
      const drive = await getAuthenticatedDrive(adminId);
      await Promise.all(
        evidences.docs.map((doc) => {
          const evidence = doc.data() as Evidence;
          return drive.files
            .delete({ fileId: evidence.driveFileId })
            .catch(() => {});
        })
      );
    } catch {
      // Continue with Firestore deletion even if Drive deletes fail
    }
  }

  const batch = adminDb.batch();
  assignments.docs.forEach((doc) => batch.delete(doc.ref));
  evidences.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(adminDb.collection("plans").doc(planId));
  await batch.commit();
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
    .collection("assignments")
    .where("userId", "==", userId)
    .where("planId", "==", planId)
    .limit(1)
    .get();

  if (!existing.empty) {
    throw new Error("User is already assigned to this plan");
  }

  const ref = adminDb.collection("assignments").doc();
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
    .collection("assignments")
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
    .collection("assignments")
    .where("userId", "==", userId)
    .get();
  const planIdSet = new Set<string>(
    assignmentSnap.docs.map((doc) => doc.data().planId as string)
  );

  // Also collect planIds from item-level assignments
  const itemSnap = await adminDb.collection("planItems").get();
  itemSnap.docs.forEach((doc) => {
    const users: { userId: string }[] = doc.data().assignedUsers ?? [];
    if (users.some((u) => u.userId === userId)) {
      planIdSet.add(doc.data().planId as string);
    }
  });

  if (planIdSet.size === 0) return [];

  const refs = Array.from(planIdSet).map((pid) =>
    adminDb.collection("plans").doc(pid)
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
    .collection("assignments")
    .where("userId", "==", userId)
    .get();

  const planIds = assignmentSnap.docs.map((doc) => doc.data().planId as string);

  if (planIds.length === 0) return [];

  const refs = planIds.map((pid) => adminDb.collection("plans").doc(pid));
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
    .collection("assignments")
    .where("userId", "==", userId)
    .where("planId", "==", planId)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function getAssignedUsers(planId: string): Promise<string[]> {
  const snapshot = await adminDb
    .collection("assignments")
    .where("planId", "==", planId)
    .get();

  return snapshot.docs.map((doc) => doc.data().userId);
}
