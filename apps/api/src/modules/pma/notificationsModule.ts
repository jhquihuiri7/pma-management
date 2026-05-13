import { and, eq, desc, lt } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaNotifications } from "../../db/schema/pma.js";
import { Forbidden, NotFound } from "../../lib/errors.js";

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NotificationInput = {
  userId: string;
  adminId: string;
  type: "evidence_submitted" | "evidence_approved" | "evidence_rejected" | "generation_threshold_reached";
  title: string;
  message: string;
  planId: string;
  planItemId?: string;
  evidenceId?: string;
  metadata?: Record<string, string>;
};

export async function createNotifications(inputs: NotificationInput[]) {
  if (inputs.length === 0) return [];
  const db = getDb();
  const now = new Date();
  const expires = new Date(now.getTime() + RETENTION_DAYS * DAY_MS);
  return db
    .insert(pmaNotifications)
    .values(
      inputs.map((i) => ({
        userId: i.userId,
        adminId: i.adminId,
        type: i.type,
        title: i.title,
        message: i.message,
        planId: i.planId,
        planItemId: i.planItemId ?? null,
        evidenceId: i.evidenceId ?? null,
        metadata: i.metadata ?? null,
        expiresAt: expires,
      }))
    )
    .returning();
}

export async function getNotificationsForUser(userId: string, adminId: string, limit = 30) {
  const db = getDb();
  const now = new Date();
  // Best-effort cleanup of expired notifications; safe to ignore failure.
  try {
    await db.delete(pmaNotifications).where(lt(pmaNotifications.expiresAt, now));
  } catch {
    // ignore
  }
  return db
    .select()
    .from(pmaNotifications)
    .where(and(eq(pmaNotifications.userId, userId), eq(pmaNotifications.adminId, adminId)))
    .orderBy(desc(pmaNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(notificationId: string, userId: string, adminId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmaNotifications)
    .where(eq(pmaNotifications.id, notificationId))
    .limit(1);
  const n = rows[0];
  if (!n) throw NotFound("Notification not found");
  if (n.userId !== userId || n.adminId !== adminId) throw Forbidden();
  if (n.readAt) return;
  await db.update(pmaNotifications).set({ readAt: new Date() }).where(eq(pmaNotifications.id, notificationId));
}
