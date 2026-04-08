import { adminDb } from "@/lib/firebase-admin";
import { ItemAssignment, ItemAssignmentCategory, PlanItem } from "@/types";

export async function createPlanItem(
  planId: string,
  data: Omit<PlanItem, "id" | "planId" | "createdAt">
): Promise<PlanItem> {
  const ref = adminDb.collection("planItems").doc();
  const now = new Date().toISOString();

  const item: PlanItem = {
    id: ref.id,
    planId,
    ...data,
    assignedUsers: [],
    createdAt: now,
  };

  await ref.set(item);
  return item;
}

export async function getPlanItems(planId: string): Promise<PlanItem[]> {
  const snapshot = await adminDb
    .collection("planItems")
    .where("planId", "==", planId)
    .orderBy("createdAt", "asc")
    .get();

  return snapshot.docs.map((doc) => doc.data() as PlanItem);
}

export async function assignReporterToItem(
  itemId: string,
  userId: string,
  category: ItemAssignmentCategory
): Promise<void> {
  const ref = adminDb.collection("planItems").doc(itemId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Item not found");

  const item = doc.data() as PlanItem;
  const current: ItemAssignment[] = item.assignedUsers ?? [];
  const filtered = current.filter((a) => a.userId !== userId);
  await ref.update({ assignedUsers: [...filtered, { userId, category }] });

  // Ensure a plan-level assignment exists so the reporter can see the plan
  const existing = await adminDb
    .collection("assignments")
    .where("userId", "==", userId)
    .where("planId", "==", item.planId)
    .limit(1)
    .get();

  if (existing.empty) {
    const assignRef = adminDb.collection("assignments").doc();
    await assignRef.set({
      id: assignRef.id,
      userId,
      planId: item.planId,
      createdAt: new Date().toISOString(),
    });
  }
}

export async function unassignReporterFromItem(
  itemId: string,
  userId: string
): Promise<void> {
  const ref = adminDb.collection("planItems").doc(itemId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Item not found");

  const item = doc.data() as PlanItem;
  const current: ItemAssignment[] = item.assignedUsers ?? [];
  await ref.update({ assignedUsers: current.filter((a) => a.userId !== userId) });

  // Check if the user is still assigned to any other item in this plan
  const remainingItems = await adminDb
    .collection("planItems")
    .where("planId", "==", item.planId)
    .get();

  const stillAssigned = remainingItems.docs.some((d) => {
    if (d.id === itemId) return false; // skip the current item (just unassigned)
    const users: ItemAssignment[] = d.data().assignedUsers ?? [];
    return users.some((a) => a.userId === userId);
  });

  // If no more item assignments, remove the plan-level assignment
  if (!stillAssigned) {
    const planAssignment = await adminDb
      .collection("assignments")
      .where("userId", "==", userId)
      .where("planId", "==", item.planId)
      .limit(1)
      .get();

    if (!planAssignment.empty) {
      await planAssignment.docs[0].ref.delete();
    }
  }
}

export async function updatePlanItem(
  itemId: string,
  planId: string,
  data: Partial<Omit<PlanItem, "id" | "planId" | "createdAt" | "assignedUsers">>
): Promise<void> {
  const ref = adminDb.collection("planItems").doc(itemId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Item not found");
  if ((doc.data() as PlanItem).planId !== planId) throw new Error("Unauthorized");
  await ref.update(data);
}

export async function updatePlanItemObservation(
  itemId: string,
  planId: string,
  observation: string
): Promise<void> {
  const ref = adminDb.collection("planItems").doc(itemId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Item not found");
  if ((doc.data() as PlanItem).planId !== planId) throw new Error("Unauthorized");
  await ref.update({ observation });
}

export async function deletePlanItem(
  itemId: string,
  planId: string
): Promise<void> {
  const doc = await adminDb.collection("planItems").doc(itemId).get();
  if (!doc.exists) throw new Error("Item not found");

  const item = doc.data() as PlanItem;
  if (item.planId !== planId) throw new Error("Unauthorized");

  await doc.ref.delete();
}
