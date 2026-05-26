import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users, userApps, refreshTokens, passwordResets } from "../../db/schema/shared.js";
import type { AppKey, UserRole } from "@pma/types";

export interface DbUser {
  id: string;
  adminId: string;
  email: string;
  passwordHash: string | null;
  passwordSet: boolean;
  name: string;
  role: UserRole;
  unit: string | null;
  position: string | null;
  apps: AppKey[];
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  const appRows = await db.select().from(userApps).where(eq(userApps.userId, u.id));
  return {
    id: u.id,
    adminId: u.id,
    email: u.email,
    passwordHash: u.passwordHash,
    passwordSet: u.passwordSet,
    name: u.name,
    role: u.role as UserRole,
    unit: u.unit,
    position: u.position,
    apps: appRows.map((r) => r.appKey as AppKey),
  };
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const u = rows[0];
  if (!u) return null;
  const appRows = await db.select().from(userApps).where(eq(userApps.userId, u.id));
  return {
    id: u.id,
    adminId: u.id,
    email: u.email,
    passwordHash: u.passwordHash,
    passwordSet: u.passwordSet,
    name: u.name,
    role: u.role as UserRole,
    unit: u.unit,
    position: u.position,
    apps: appRows.map((r) => r.appKey as AppKey),
  };
}

export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ passwordHash, passwordSet: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function insertRefreshToken(args: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}): Promise<void> {
  const db = getDb();
  await db.insert(refreshTokens).values({
    userId: args.userId,
    tokenHash: args.tokenHash,
    expiresAt: args.expiresAt,
    userAgent: args.userAgent ?? null,
    ip: args.ip ?? null,
  });
}

export async function findActiveRefreshToken(tokenHash: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  const db = getDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revokedAt as any, null as any)));
}

export async function insertPasswordReset(args: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  const db = getDb();
  await db.insert(passwordResets).values({
    userId: args.userId,
    tokenHash: args.tokenHash,
    expiresAt: args.expiresAt,
  });
}

export async function findActivePasswordReset(tokenHash: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, tokenHash))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.usedAt) return null;
  if (r.expiresAt.getTime() < Date.now()) return null;
  return r;
}

export async function markPasswordResetUsed(tokenHash: string): Promise<void> {
  const db = getDb();
  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(passwordResets.tokenHash, tokenHash));
}
