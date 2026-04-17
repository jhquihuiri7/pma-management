import { adminDb } from "@/lib/firebase-admin";
import { AppNotification, NotificationType } from "@/types";

const NOTIFICATION_RETENTION_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type NotificationInput = {
  userId: string;
  adminId: string;
  type: NotificationType;
  title: string;
  message: string;
  planId: string;
  planItemId?: string;
  evidenceId?: string;
  metadata?: Record<string, string>;
};

function buildNotification(input: NotificationInput, createdAt: string): AppNotification {
  const id = adminDb.collection("notifications").doc().id;
  const expiresAt = new Date(
    new Date(createdAt).getTime() + NOTIFICATION_RETENTION_DAYS * DAY_IN_MS
  ).toISOString();

  return {
    id,
    userId: input.userId,
    adminId: input.adminId,
    type: input.type,
    title: input.title,
    message: input.message,
    planId: input.planId,
    ...(input.planItemId ? { planItemId: input.planItemId } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    readAt: null,
    createdAt,
    expiresAt,
  };
}

function sortByCreatedAtDesc(items: AppNotification[]): AppNotification[] {
  return [...items].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

export async function createNotifications(
  inputs: NotificationInput[]
): Promise<AppNotification[]> {
  if (inputs.length === 0) return [];

  const now = new Date().toISOString();
  const notifications = inputs.map((input) => buildNotification(input, now));

  const batch = adminDb.batch();
  notifications.forEach((notification) => {
    const ref = adminDb.collection("notifications").doc(notification.id);
    batch.set(ref, notification);
  });
  await batch.commit();

  return notifications;
}

export async function getNotificationsForUser(
  userId: string,
  adminId: string,
  limit = 30
): Promise<AppNotification[]> {
  const snapshot = await adminDb
    .collection("notifications")
    .where("userId", "==", userId)
    .where("adminId", "==", adminId)
    .get();

  const nowMs = Date.now();
  const cutoffMs = nowMs - NOTIFICATION_RETENTION_DAYS * DAY_IN_MS;

  const staleRefs: FirebaseFirestore.DocumentReference[] = [];
  const active: AppNotification[] = [];

  snapshot.docs.forEach((doc) => {
    const notification = doc.data() as AppNotification;

    const createdAtMs = new Date(notification.createdAt).getTime();
    const expiresAtMs = new Date(notification.expiresAt).getTime();
    const isStale =
      Number.isNaN(createdAtMs) ||
      Number.isNaN(expiresAtMs) ||
      createdAtMs < cutoffMs ||
      expiresAtMs <= nowMs;

    if (isStale) {
      staleRefs.push(doc.ref);
      return;
    }

    active.push(notification);
  });

  if (staleRefs.length > 0) {
    const batch = adminDb.batch();
    staleRefs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  return sortByCreatedAtDesc(active).slice(0, limit);
}

export async function markNotificationAsRead(
  notificationId: string,
  userId: string,
  adminId: string
): Promise<void> {
  const ref = adminDb.collection("notifications").doc(notificationId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Notification not found");

  const notification = doc.data() as AppNotification;
  if (notification.userId !== userId || notification.adminId !== adminId) {
    throw new Error("Unauthorized");
  }

  if (notification.readAt) return;

  await ref.update({ readAt: new Date().toISOString() });
}
