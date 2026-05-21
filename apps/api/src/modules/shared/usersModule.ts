import { eq, and, desc, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../../db/client.js";
import { users, userApps, passwordResets } from "../../db/schema/shared.js";
import { Conflict, NotFound, Forbidden, BadRequest } from "../../lib/errors.js";
import { getMail } from "../../mail/index.js";
import { env } from "../../lib/env.js";
import { hashRefreshToken } from "../../auth/jwt.js";
import type { UserRole } from "@pma/types";

// API-side AppKey: legacy "pg" is normalized at the API boundary and never
// reaches Postgres. The Drizzle enum only contains the canonical four keys.
export type AppKey = "pma" | "rgdp" | "pglp" | "geo";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type ManagedRole = "REPORTER" | "VIEWER";

export type CreateManagedUserInput = {
  adminId: string;
  name: string;
  email: string;
  role: ManagedRole;
  unit?: string;
  position?: string;
  app: AppKey;
};

export type CreateUserGlobalInput = {
  adminId: string;
  name: string;
  email: string;
  role: ManagedRole;
  unit?: string;
  position?: string;
  apps?: AppKey[];
};

async function findUserRowByEmail(email: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

async function getUserApps(userId: string): Promise<AppKey[]> {
  const db = getDb();
  const rows = await db.select().from(userApps).where(eq(userApps.userId, userId));
  return rows.map((r) => r.appKey as AppKey);
}

async function buildSetPasswordToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const db = getDb();
  await db.insert(passwordResets).values({
    userId,
    tokenHash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return raw;
}

function invitationHtml(name: string, link: string) {
  return `<p>Hola ${name},</p>
  <p>Te han invitado a la plataforma. Establece tu contraseña con este enlace:</p>
  <p><a href="${link}">${link}</a></p>
  <p>El enlace expira en 24 horas.</p>`;
}

async function sendInvitation(email: string, name: string, token: string) {
  const link = `${env.FRONTEND_ORIGIN}/set-password?token=${token}`;
  await getMail().send({
    to: email,
    subject: "Establece tu contraseña",
    html: invitationHtml(name, link),
  });
}

// ---------------------------------------------------------------------------
// Global user management (central /api/users module)
// ---------------------------------------------------------------------------

export async function createUserGlobal(input: CreateUserGlobalInput) {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await findUserRowByEmail(normalizedEmail);

  if (existing) {
    if (existing.adminId !== input.adminId)
      throw Conflict("Ya existe un usuario con ese correo");
    if (existing.role !== "REPORTER" && existing.role !== "VIEWER")
      throw Forbidden("No puedes gestionar este usuario");
    if (existing.role !== input.role)
      throw Conflict("Ya existe un usuario con ese correo y un rol diferente");

    await db
      .update(users)
      .set({ name: input.name, unit: input.unit ?? null, position: input.position ?? null, updatedAt: new Date() })
      .where(eq(users.id, existing.id));

    const currentApps = await getUserApps(existing.id);
    const newApps = (input.apps ?? []).filter((a) => !currentApps.includes(a));
    for (const appKey of newApps) {
      await db.insert(userApps).values({ userId: existing.id, appKey }).onConflictDoNothing();
    }
    const allApps = [...new Set([...currentApps, ...newApps])];
    return { id: existing.id, email: normalizedEmail, name: input.name, role: input.role, apps: allApps };
  }

  const [row] = await db
    .insert(users)
    .values({
      adminId: input.adminId,
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
    await db.insert(userApps).values({ userId: row.id, appKey }).onConflictDoNothing();
  }

  const token = await buildSetPasswordToken(row.id);
  try { await sendInvitation(normalizedEmail, input.name, token); } catch { /* ignore */ }

  return { id: row.id, email: row.email, name: row.name, role: row.role, apps: assignedApps };
}

export async function updateManagedUser(
  userId: string,
  adminId: string,
  updates: { name?: string; unit?: string | null; position?: string | null },
) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.adminId !== adminId) throw Forbidden();
  if (u.role !== "REPORTER" && u.role !== "VIEWER")
    throw Forbidden("No puedes gestionar este usuario");

  await db.update(users).set({
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit } : {}),
    ...(updates.position !== undefined ? { position: updates.position } : {}),
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

export async function deleteUserGlobal(userId: string, adminId: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.adminId !== adminId) throw Forbidden();
  if (u.role !== "REPORTER" && u.role !== "VIEWER")
    throw Forbidden("No puedes eliminar usuarios administradores");

  // FK cascades remove userApps, plan/item assignments and notifications.
  await db.delete(users).where(eq(users.id, userId));
}

export async function assignUserToApp(userId: string, adminId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.adminId !== adminId) throw Forbidden();
  if (u.role !== "REPORTER" && u.role !== "VIEWER")
    throw Forbidden("No puedes gestionar este usuario");

  const apps = await getUserApps(userId);
  if (apps.includes(app)) throw Conflict("El usuario ya tiene acceso a esta aplicación");

  await db.insert(userApps).values({ userId, appKey: app }).onConflictDoNothing();
}

export async function resendInvitationGlobal(userId: string, adminId: string) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.adminId !== adminId) throw Forbidden();
  if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");

  const token = await buildSetPasswordToken(u.id);
  await sendInvitation(u.email, u.name, token);
}

// ---------------------------------------------------------------------------
// Per-app user management (subsystem routes)
// ---------------------------------------------------------------------------

export async function resendInvitation(userId: string, adminId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("Usuario no encontrado");
  if (u.adminId !== adminId) throw Forbidden();
  if (u.passwordSet) throw BadRequest("Este usuario ya estableció su contraseña");
  const apps = await getUserApps(u.id);
  if (!apps.includes(app)) throw BadRequest("El usuario no tiene acceso a esta aplicación");
  const token = await buildSetPasswordToken(u.id);
  await sendInvitation(u.email, u.name, token);
}

export async function deleteManagedUser(userId: string, adminId: string, app: AppKey) {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u) throw NotFound("User not found");
  if (u.adminId !== adminId) throw Forbidden();
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

export async function listManagedUsersForAdmin(adminId: string, app?: AppKey) {
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
    .where(and(eq(users.adminId, adminId), inArray(users.role, ["REPORTER", "VIEWER"] as const)))
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
