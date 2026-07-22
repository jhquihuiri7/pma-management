import { and, eq, desc, isNull, lt } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users, userApps } from "../../db/schema/shared.js";
import { rgdpNotifications, rgdpPlanAssignments } from "../../db/schema/rgdp.js";
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

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function dedupeNotifications(inputs: NotificationInput[]) {
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = [
      input.userId,
      input.type,
      input.planId,
      input.planItemId ?? "",
      input.evidenceId ?? "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function createNotifications(inputs: NotificationInput[], tx?: DbTransaction) {
  const uniqueInputs = dedupeNotifications(inputs);
  if (uniqueInputs.length === 0) return [];
  const db = tx ?? getDb();
  const now = new Date();
  const expires = new Date(Date.now() + RETENTION_DAYS * DAY_MS);
  const confirmed = [];

  for (const input of uniqueInputs) {
    const values = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      planId: input.planId,
      planItemId: input.planItemId ?? null,
      evidenceId: input.evidenceId ?? null,
      metadata: input.metadata ?? null,
      expiresAt: expires,
    };
    const [inserted] = await db
      .insert(rgdpNotifications)
      .values(values)
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      confirmed.push(inserted);
      continue;
    }

    if (!input.evidenceId || input.type === "generation_threshold_reached") {
      throw new Error("RGDP notification insert was not confirmed");
    }
    const [refreshed] = await db
      .update(rgdpNotifications)
      .set({
        title: input.title,
        message: input.message,
        planId: input.planId,
        planItemId: input.planItemId ?? null,
        metadata: input.metadata ?? null,
        readAt: null,
        createdAt: now,
        expiresAt: expires,
      })
      .where(and(
        eq(rgdpNotifications.userId, input.userId),
        eq(rgdpNotifications.type, input.type),
        eq(rgdpNotifications.evidenceId, input.evidenceId)
      ))
      .returning();
    if (!refreshed) throw new Error("RGDP notification upsert was not confirmed");
    confirmed.push(refreshed);
  }

  if (confirmed.length !== uniqueInputs.length) {
    throw new Error(`Expected ${uniqueInputs.length} RGDP notifications, confirmed ${confirmed.length}`);
  }
  return confirmed;
}

export async function getEvidenceSubmittedRecipientIds(
  tx: DbTransaction,
  planId: string,
  uploaderId: string
) {
  const explicitViewers = await tx
    .select({ userId: users.id })
    .from(rgdpPlanAssignments)
    .innerJoin(users, eq(users.id, rgdpPlanAssignments.userId))
    .innerJoin(
      userApps,
      and(eq(userApps.userId, users.id), eq(userApps.appKey, "rgdp"))
    )
    .where(and(
      eq(rgdpPlanAssignments.planId, planId),
      eq(rgdpPlanAssignments.explicitAccess, true),
      eq(users.role, "VIEWER")
    ));
  const admins = await tx
    .select({ userId: users.id })
    .from(users)
    .where(eq(users.role, "ADMIN"));

  return [...new Set([...explicitViewers, ...admins].map((row) => row.userId))]
    .filter((userId) => userId !== uploaderId);
}

export async function getEvidenceResultRecipientIds(
  tx: DbTransaction,
  uploaderId: string | null,
  validatorId: string
) {
  if (!uploaderId || uploaderId === validatorId) return [];
  const [uploader] = await tx
    .select({ userId: users.id })
    .from(users)
    .where(eq(users.id, uploaderId))
    .limit(1);
  return uploader ? [uploader.userId] : [];
}

export async function getNotificationsForUser(userId: string, _adminId?: string, limit = 30) {
  const db = getDb();
  await db.delete(rgdpNotifications).where(lt(rgdpNotifications.expiresAt, new Date()));
  return db
    .select()
    .from(rgdpNotifications)
    .where(eq(rgdpNotifications.userId, userId))
    .orderBy(desc(rgdpNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(notificationId: string, userId: string, _adminId?: string) {
  const db = getDb();
  const [updated] = await db
    .update(rgdpNotifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(rgdpNotifications.id, notificationId),
      eq(rgdpNotifications.userId, userId),
      isNull(rgdpNotifications.readAt)
    ))
    .returning({ id: rgdpNotifications.id });
  if (updated) return;

  const [notification] = await db
    .select({ userId: rgdpNotifications.userId })
    .from(rgdpNotifications)
    .where(eq(rgdpNotifications.id, notificationId))
    .limit(1);
  if (!notification) throw NotFound("Notification not found");
  if (notification.userId !== userId) throw Forbidden();
}
