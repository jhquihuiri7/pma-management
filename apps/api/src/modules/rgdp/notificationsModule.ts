import { and, eq, desc, lt } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpNotifications } from "../../db/schema/rgdp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NotificationInput = {
  userId: string;
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
  const expires = new Date(Date.now() + RETENTION_DAYS * DAY_MS);
  return getDb()
    .insert(rgdpNotifications)
    .values(inputs.map((i) => ({
      userId: i.userId, type: i.type, title: i.title, message: i.message,
      planId: i.planId, planItemId: i.planItemId ?? null, evidenceId: i.evidenceId ?? null,
      metadata: i.metadata ?? null, expiresAt: expires,
    })))
    .returning();
}

export async function getNotificationsForUser(userId: string, _adminId?: string, limit = 30) {
  const db = getDb();
  try { await db.delete(rgdpNotifications).where(lt(rgdpNotifications.expiresAt, new Date())); } catch { /* ignore */ }
  return db
    .select()
    .from(rgdpNotifications)
    .where(eq(rgdpNotifications.userId, userId))
    .orderBy(desc(rgdpNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(notificationId: string, userId: string, _adminId?: string) {
  const db = getDb();
  const rows = await db.select().from(rgdpNotifications).where(eq(rgdpNotifications.id, notificationId)).limit(1);
  const n = rows[0];
  if (!n) throw NotFound("Notification not found");
  if (n.userId !== userId) throw Forbidden();
  if (n.readAt) return;
  await db.update(rgdpNotifications).set({ readAt: new Date() }).where(eq(rgdpNotifications.id, notificationId));
}
