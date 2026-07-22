import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../../db/client.js";
import { users, userApps, passwordResets } from "../../db/schema/shared.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaNotifications,
  pmaPlanAssignments,
} from "../../db/schema/pma.js";
import {
  rgdpEvidences,
  rgdpItemAssignments,
  rgdpNotifications,
  rgdpPlanAssignments,
} from "../../db/schema/rgdp.js";
import { Conflict, NotFound, Forbidden, BadRequest } from "../../lib/errors.js";
import { invitationEmail } from "../../mail/templates.js";
import { env } from "../../lib/env.js";
import { hashRefreshToken } from "../../auth/jwt.js";
import type { UserRole } from "@pma/types";
import { enqueueMail } from "./mailOutbox.js";
import { lockAndAssertActor, lockAndAssertGlobalAdmin } from "./transactionalActor.js";

// API-side AppKey: legacy keys are normalized at the API boundary and never
// reach Postgres. The Drizzle enum only contains the canonical keys.
export type AppKey = "pma" | "rgdp" | "geo";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type ManagedRole = "ADMIN" | "REPORTER" | "VIEWER";

export type CreateUserGlobalInput = {
  name: string;
  email: string;
  role: ManagedRole;
  unit?: string;
  position?: string;
  apps?: AppKey[];
};

function createSetPasswordToken() {
  const raw = randomBytes(32).toString("hex");
  return {
    raw,
    tokenHash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}

async function getUserAppsFrom(db: any, userId: string): Promise<AppKey[]> {
  const rows = await db.select().from(userApps).where(eq(userApps.userId, userId));
  return rows.map((r: { appKey: string }) => r.appKey as AppKey);
}

/**
 * Remove authorization state that must never survive an app revocation.
 * Historical evidence rows remain available to administrators, but their
 * nullable actor references are detached so re-adding the app cannot restore
 * reporter ownership implicitly.
 */
async function revokeSubsystemState(db: any, userId: string, app: AppKey): Promise<void> {
  if (app === "pma") {
    await db.delete(pmaItemAssignments).where(eq(pmaItemAssignments.userId, userId));
    await db.delete(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, userId));
    await db.delete(pmaNotifications).where(eq(pmaNotifications.userId, userId));
    await db
      .update(pmaEvidences)
      .set({ uploadedBy: null })
      .where(eq(pmaEvidences.uploadedBy, userId));
    await db
      .update(pmaEvidences)
      .set({ validatedBy: null })
      .where(eq(pmaEvidences.validatedBy, userId));
    return;
  }

  if (app === "rgdp") {
    await db.delete(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, userId));
    await db.delete(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, userId));
    await db.delete(rgdpNotifications).where(eq(rgdpNotifications.userId, userId));
    await db
      .update(rgdpEvidences)
      .set({ uploadedBy: null })
      .where(eq(rgdpEvidences.uploadedBy, userId));
    await db
      .update(rgdpEvidences)
      .set({ validatedBy: null })
      .where(eq(rgdpEvidences.validatedBy, userId));
  }
}

/**
 * Plan and item grants encode role-specific capabilities. Discard them on
 * every actual role transition so a formerly valid grant cannot acquire a new
 * meaning under the replacement role. App memberships and GEO state remain
 * untouched.
 */
async function revokeRoleBoundAssignments(db: any, userId: string): Promise<void> {
  await db.delete(pmaItemAssignments).where(eq(pmaItemAssignments.userId, userId));
  await db.delete(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, userId));
  await db.delete(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, userId));
  await db.delete(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, userId));
}

async function insertSetPasswordToken(db: any, userId: string) {
  const token = createSetPasswordToken();
  // Only the newest invitation/reset link remains usable.
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  await db.insert(passwordResets).values({
    userId,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
  });
  return token;
}

async function queueInvitation(db: any, userId: string, email: string, name: string) {
  const token = await insertSetPasswordToken(db, userId);
  const link = `${env.FRONTEND_ORIGIN}/set-password?token=${token.raw}`;
  const content = invitationEmail({ name, link });
  const [operationId] = await enqueueMail(db, {
    to: email,
    subject: content.subject,
    html: content.html,
    text: content.text,
  }, token.expiresAt);
  return operationId;
}

// ---------------------------------------------------------------------------
// Global user management (central /api/users module)
// ---------------------------------------------------------------------------

export async function createUserGlobal(requesterId: string, input: CreateUserGlobalInput) {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    await lockAndAssertGlobalAdmin(tx, requesterId);
    const existingRows = await tx.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const existing = existingRows[0] ?? null;
    if (existing) throw Conflict("Ya existe un usuario con ese correo");

    const [row] = await tx
      .insert(users)
      .values({
        email: normalizedEmail,
        name: input.name,
        role: input.role as UserRole,
        passwordSet: false,
        unit: input.unit ?? null,
        position: input.position ?? null,
      })
      .returning();

    const assignedApps = [...new Set(input.apps ?? [])];
    for (const appKey of assignedApps) {
      await tx.insert(userApps).values({ userId: row.id, appKey }).onConflictDoNothing();
    }

    const operationId = await queueInvitation(tx, row.id, normalizedEmail, input.name);

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      apps: assignedApps,
      invitation: { status: "queued" as const, operationId },
    };
  });
}

export async function updateManagedUser(
  userId: string,
  updates: { name?: string; unit?: string | null; position?: string | null; role?: ManagedRole },
  requesterId: string,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertGlobalAdmin(tx, requesterId);
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const u = rows[0];
    if (!u) throw NotFound("Usuario no encontrado");

    // Role changes carry lockout risks: block self-demotion and removing the
    // last admin. The advisory lock makes the count and update one atomic
    // decision even when two administrators act concurrently.
    if (updates.role !== undefined && updates.role !== u.role) {
      if (u.id === requesterId)
        throw Forbidden("No puedes cambiar tu propio rol");
      if (u.role === "ADMIN") {
        const adminRows = await tx.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
        if (adminRows.length <= 1)
          throw Forbidden("No puedes cambiar el rol del único administrador");
      }
      await revokeRoleBoundAssignments(tx, userId);
    }

    const changed = await tx.update(users).set({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.unit !== undefined ? { unit: updates.unit } : {}),
      ...(updates.position !== undefined ? { position: updates.position } : {}),
      ...(updates.role !== undefined ? { role: updates.role as UserRole } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ id: users.id });
    if (changed.length !== 1) throw NotFound("Usuario no encontrado");
    return { ok: true as const, id: userId };
  });
}

export async function deleteUserGlobal(userId: string, requesterId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertGlobalAdmin(tx, requesterId);
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const u = rows[0];
    if (!u) throw NotFound("Usuario no encontrado");
    if (u.id === requesterId)
      throw Forbidden("No puedes eliminar tu propia cuenta");
    if (u.role === "ADMIN") {
      const adminRows = await tx.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      if (adminRows.length <= 1) throw Forbidden("No puedes eliminar al único administrador");
    }

    // FK cascades remove userApps, plan/item assignments and notifications.
    const deleted = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
    if (deleted.length !== 1) throw NotFound("Usuario no encontrado");
    return { ok: true as const, id: userId };
  });
}

export async function assignUserToApp(userId: string, app: AppKey, requesterId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, requesterId, app, ["ADMIN"]);
    const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!rows[0]) throw NotFound("Usuario no encontrado");
    const inserted = await tx
      .insert(userApps)
      .values({ userId, appKey: app })
      .onConflictDoNothing()
      .returning({ userId: userApps.userId });
    if (inserted.length !== 1) throw Conflict("El usuario ya tiene acceso a esta aplicación");
    return { ok: true as const, userId, appKey: app };
  });
}

export async function resendInvitationGlobal(userId: string, requesterId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertGlobalAdmin(tx, requesterId);
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const u = rows[0];
    if (!u) throw NotFound("Usuario no encontrado");
    if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");
    const operationId = await queueInvitation(tx, u.id, u.email, u.name);
    return { invitation: { status: "queued" as const, operationId } };
  });
}

// ---------------------------------------------------------------------------
// Per-app user management (subsystem routes)
// ---------------------------------------------------------------------------

export async function resendInvitation(userId: string, app: AppKey, requesterId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, requesterId, app, ["ADMIN"]);
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const u = rows[0];
    if (!u) throw NotFound("Usuario no encontrado");
    if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");
    const apps = await getUserAppsFrom(tx, u.id);
    if (!apps.includes(app)) throw BadRequest("El usuario no tiene acceso a esta aplicación");
    const operationId = await queueInvitation(tx, u.id, u.email, u.name);
    return { invitation: { status: "queued" as const, operationId } };
  });
}

export async function deleteManagedUser(userId: string, app: AppKey, requesterId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, requesterId, app, ["ADMIN"]);
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const u = rows[0];
    if (!u) throw NotFound("Usuario no encontrado");
    if (u.role !== "REPORTER" && u.role !== "VIEWER")
      throw Forbidden("No se puede quitar el acceso de un administrador");

    const removed = await tx
      .delete(userApps)
      .where(and(eq(userApps.userId, u.id), eq(userApps.appKey, app)))
      .returning({ userId: userApps.userId });
    if (removed.length !== 1) throw BadRequest("El usuario no tiene acceso a esta aplicación");

    const remaining = await getUserAppsFrom(tx, u.id);
    if (remaining.length === 0) {
      // FK cascades remove plan/item assignments and notifications.
      const deleted = await tx.delete(users).where(eq(users.id, u.id)).returning({ id: users.id });
      if (deleted.length !== 1) throw NotFound("Usuario no encontrado");
    } else {
      await revokeSubsystemState(tx, u.id, app);
    }
    return { ok: true as const, userId, appKey: app, accountDeleted: remaining.length === 0 };
  });
}

export async function listManagedUsers(app?: AppKey) {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      unit: users.unit,
      position: users.position,
      passwordSet: users.passwordSet,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(inArray(users.role, ["ADMIN", "REPORTER", "VIEWER"] as const))
    .orderBy(desc(users.createdAt));

  if (rows.length === 0) return [];
  const appsRows = await db.select().from(userApps).where(inArray(userApps.userId, rows.map((r) => r.id)));
  const byUser = new Map<string, AppKey[]>();
  for (const a of appsRows) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a.appKey as AppKey);
    byUser.set(a.userId, list);
  }
  const out = rows.map((r) => ({ ...r, apps: byUser.get(r.id) ?? [] }));
  return app ? out.filter((u) => u.apps.includes(app)) : out;
}
