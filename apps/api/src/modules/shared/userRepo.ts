import { eq, and, gt, isNull } from "drizzle-orm";
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
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      passwordSet: users.passwordSet,
      name: users.name,
      role: users.role,
      unit: users.unit,
      position: users.position,
      appKey: userApps.appKey,
    })
    .from(users)
    .leftJoin(userApps, eq(userApps.userId, users.id))
    .where(eq(users.email, email));
  const u = rows[0];
  if (!u) return null;
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
    apps: rows.flatMap((row) => row.appKey ? [row.appKey as AppKey] : []),
  };
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      passwordSet: users.passwordSet,
      name: users.name,
      role: users.role,
      unit: users.unit,
      position: users.position,
      appKey: userApps.appKey,
    })
    .from(users)
    .leftJoin(userApps, eq(userApps.userId, users.id))
    .where(eq(users.id, id));
  const u = rows[0];
  if (!u) return null;
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
    apps: rows.flatMap((row) => row.appKey ? [row.appKey as AppKey] : []),
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
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * Consume one refresh token and insert its replacement in the same transaction.
 * The conditional UPDATE is the race arbiter: concurrent requests cannot both
 * rotate the same token.
 */
export async function rotateRefreshToken(args: {
  currentTokenHash: string;
  userId: string;
  nextTokenHash: string;
  nextExpiresAt: Date;
  userAgent?: string;
  ip?: string;
}): Promise<boolean> {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const consumed = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(
        eq(refreshTokens.tokenHash, args.currentTokenHash),
        eq(refreshTokens.userId, args.userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, now)
      ))
      .returning({ id: refreshTokens.id });
    if (consumed.length === 0) return false;
    if (consumed.length !== 1) {
      throw new Error("Refresh token hash is not unique");
    }

    await tx.insert(refreshTokens).values({
      userId: args.userId,
      tokenHash: args.nextTokenHash,
      expiresAt: args.nextExpiresAt,
      userAgent: args.userAgent ?? null,
      ip: args.ip ?? null,
    });
    return true;
  });
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
    .where(and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt)));
}

/**
 * Atomically consumes a still-active reset token, changes the password, expires
 * every sibling reset token, and revokes every active refresh session.
 */
export async function consumePasswordReset(args: {
  tokenHash: string;
  passwordHash: string;
}): Promise<{ userId: string } | null> {
  return getDb().transaction(async (tx) => {
    const lookupNow = new Date();
    const [candidate] = await tx
      .select({ userId: passwordResets.userId })
      .from(passwordResets)
      .where(and(
        eq(passwordResets.tokenHash, args.tokenHash),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, lookupNow)
      ))
      .limit(1);
    if (!candidate) return null;

    // Lock the account before consuming the token. Locking the token itself is
    // insufficient: two distinct active tokens for one user are different rows
    // and could otherwise both change the password (or deadlock while each
    // invalidates the other's row).
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .limit(1)
      .for("update");
    if (!lockedUser) return null;

    // Recheck after waiting for the user lock: a preceding request may have
    // consumed this token or invalidated it as a sibling.
    const now = new Date();
    const consumed = await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResets.tokenHash, args.tokenHash),
        eq(passwordResets.userId, candidate.userId),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, now)
      ))
      .returning({ userId: passwordResets.userId });
    if (consumed.length === 0) return null;
    if (consumed.length !== 1) {
      throw new Error("Password reset token hash is not unique");
    }
    const reset = consumed[0];

    const updatedUsers = await tx
      .update(users)
      .set({ passwordHash: args.passwordHash, passwordSet: true, updatedAt: now })
      .where(eq(users.id, reset.userId))
      .returning({ id: users.id });
    if (updatedUsers.length !== 1) {
      throw new Error("Password reset references a missing user");
    }

    await tx
      .update(passwordResets)
      .set({ usedAt: now })
      .where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.usedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, reset.userId), isNull(refreshTokens.revokedAt)));
    return { userId: reset.userId };
  });
}
