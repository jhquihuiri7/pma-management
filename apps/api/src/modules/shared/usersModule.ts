import { eq, and, desc, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../../db/client.js";
import { users, userApps, passwordResets } from "../../db/schema/shared.js";
import { Conflict, NotFound, Forbidden, BadRequest } from "../../lib/errors.js";
import { getMail } from "../../mail/index.js";
import { invitationEmail } from "../../mail/templates.js";
import { env } from "../../lib/env.js";
import { hashRefreshToken } from "../../auth/jwt.js";
import type { UserRole } from "@pma/types";

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

async function getUserApps(userId: string): Promise<AppKey[]> {
  return getUserAppsFrom(getDb(), userId);
}

async function insertSetPasswordToken(db: any, userId: string): Promise<string> {
  const token = createSetPasswordToken();
  await db.insert(passwordResets).values({
    userId,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
  });
  return token.raw;
}

async function buildSetPasswordToken(userId: string): Promise<string> {
  return insertSetPasswordToken(getDb(), userId);
}

function mailErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "El servicio de correo no respondió correctamente";
}

async function sendInvitation(email: string, name: string, token: string) {
  const link = `${env.FRONTEND_ORIGIN}/set-password?token=${token}`;
  const content = invitationEmail({ name, link });
  try {
    await getMail().send({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
  } catch (error) {
    throw BadRequest(`No se pudo enviar el correo de invitación: ${mailErrorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Global user management (central /api/users module)
// ---------------------------------------------------------------------------

export async function createUserGlobal(input: CreateUserGlobalInput) {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const existingRows = await tx.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const existing = existingRows[0] ?? null;

    if (existing) {
      if (existing.role !== input.role)
        throw Conflict("Ya existe un usuario con ese correo y un rol diferente");

      await tx
        .update(users)
        .set({ name: input.name, unit: input.unit ?? null, position: input.position ?? null, updatedAt: new Date() })
        .where(eq(users.id, existing.id));

      const currentApps = await getUserAppsFrom(tx, existing.id);
      const newApps = (input.apps ?? []).filter((a) => !currentApps.includes(a));
      for (const appKey of newApps) {
        await tx.insert(userApps).values({ userId: existing.id, appKey }).onConflictDoNothing();
      }
      const allApps = [...new Set([...currentApps, ...newApps])];
      if (!existing.passwordSet) {
        const token = await insertSetPasswordToken(tx, existing.id);
        await sendInvitation(normalizedEmail, input.name, token);
      }
      return { id: existing.id, email: normalizedEmail, name: input.name, role: input.role, apps: allApps };
    }

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

    const assignedApps = input.apps ?? [];
    for (const appKey of assignedApps) {
      await tx.insert(userApps).values({ userId: row.id, appKey }).onConflictDoNothing();
    }

    const token = await insertSetPasswordToken(tx, row.id);
    await sendInvitation(normalizedEmail, input.name, token);

    return { id: row.id, email: row.email, name: row.name, role: row.role, apps: assignedApps };
  });
}

export async function updateManagedUser(
  userId: string,
  updates: { name?: string; unit?: string | null; position?: string | null; role?: ManagedRole },
  requesterId?: string,
) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");

  // Role changes carry lockout risks: block self-demotion and removing the last
  // admin so the org can never end up without an administrator.
  if (updates.role !== undefined && updates.role !== u.role) {
    if (requesterId && u.id === requesterId)
      throw Forbidden("No puedes cambiar tu propio rol");
    if (u.role === "ADMIN") {
      const adminRows = await db.select({ id: users.id }).from(users).where(eq(users.role, "ADMIN"));
      if (adminRows.length <= 1)
        throw Forbidden("No puedes cambiar el rol del único administrador");
    }
  }

  await db.update(users).set({
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit } : {}),
    ...(updates.position !== undefined ? { position: updates.position } : {}),
    ...(updates.role !== undefined ? { role: updates.role as UserRole } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

export async function deleteUserGlobal(userId: string, requesterId: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.id === requesterId)
    throw Forbidden("No puedes eliminar tu propia cuenta");

  // FK cascades remove userApps, plan/item assignments and notifications.
  await db.delete(users).where(eq(users.id, userId));
}

export async function assignUserToApp(userId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");

  const apps = await getUserApps(userId);
  if (apps.includes(app)) throw Conflict("El usuario ya tiene acceso a esta aplicación");

  await db.insert(userApps).values({ userId, appKey: app }).onConflictDoNothing();
}

export async function resendInvitationGlobal(userId: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");

  const token = await buildSetPasswordToken(u.id);
  await sendInvitation(u.email, u.name, token);
}

// ---------------------------------------------------------------------------
// Per-app user management (subsystem routes)
// ---------------------------------------------------------------------------

export async function resendInvitation(userId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");
  const apps = await getUserApps(u.id);
  if (!apps.includes(app)) throw BadRequest("El usuario no tiene acceso a esta aplicación");
  const token = await buildSetPasswordToken(u.id);
  await sendInvitation(u.email, u.name, token);
}

export async function deleteManagedUser(userId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("User not found");
  if (u.role !== "REPORTER" && u.role !== "VIEWER")
    throw Forbidden("Cannot delete admin users");

  const apps = await getUserApps(u.id);
  if (!apps.includes(app)) throw BadRequest("El usuario no tiene acceso a esta aplicación");

  await db
    .delete(userApps)
    .where(and(eq(userApps.userId, u.id), eq(userApps.appKey, app)));

  const remaining = apps.filter((a) => a !== app);
  if (remaining.length === 0) {
    // FK cascades remove plan/item assignments and notifications.
    await db.delete(users).where(eq(users.id, u.id));
  }
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
