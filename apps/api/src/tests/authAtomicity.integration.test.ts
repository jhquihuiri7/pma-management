import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { mailOutboxJobs, passwordResets, refreshTokens, users } from "../db/schema/shared.js";
import { consumePasswordReset, rotateRefreshToken } from "../modules/shared/userRepo.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { authRoutes } from "../routes/auth.js";

test(
  "login distinguishes a pending invitation and persists the session before returning success",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const email = `login-persistence-${userId}@example.invalid`;
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(cookie, { secret: "test-cookie-secret-with-more-than-32-characters" });
    await app.register(authRoutes, { prefix: "/auth" });

    try {
      await db.insert(users).values({
        id: userId,
        email,
        name: "Login persistence test",
        role: "REPORTER",
        passwordHash: null,
        passwordSet: false,
      });

      const pending = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "temporary" },
      });
      assert.equal(pending.statusCode, 401);
      assert.match(pending.json().message, /Password not set/i);

      const oversized = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "é".repeat(37) },
      });
      assert.equal(oversized.statusCode, 400);

      const password = "valid-password";
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password), passwordSet: true })
        .where(eq(users.id, userId));

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().user.id, userId);
      const sessions = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
      assert.equal(sessions.length, 1);
      const setCookie = response.headers["set-cookie"];
      const cookieText = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie ?? "");
      assert.match(cookieText, /pma_access=/);
      assert.match(cookieText, /pma_refresh=/);
    } finally {
      await app.close();
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
    }
  }
);

test(
  "refresh rotation and password reset have one atomic winner",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const currentRefreshHash = randomUUID();
    const resetHashA = `${randomUUID()}-a`;
    const resetHashB = `${randomUUID()}-b`;

    try {
      await db.insert(users).values({
        id: userId,
        email: `auth-atomicity-${userId}@example.invalid`,
        name: "Atomicity test",
        role: "REPORTER",
        passwordHash: "old-hash",
        passwordSet: true,
      });
      await db.insert(refreshTokens).values({
        userId,
        tokenHash: currentRefreshHash,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const rotationResults = await Promise.all([
        rotateRefreshToken({
          currentTokenHash: currentRefreshHash,
          userId,
          nextTokenHash: `${currentRefreshHash}-next-a`,
          nextExpiresAt: new Date(Date.now() + 120_000),
        }),
        rotateRefreshToken({
          currentTokenHash: currentRefreshHash,
          userId,
          nextTokenHash: `${currentRefreshHash}-next-b`,
          nextExpiresAt: new Date(Date.now() + 120_000),
        }),
      ]);
      assert.equal(rotationResults.filter(Boolean).length, 1);
      const activeRefresh = await db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      assert.equal(activeRefresh.length, 1);

      await db.insert(passwordResets).values([
        {
          userId,
          tokenHash: resetHashA,
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          userId,
          tokenHash: resetHashB,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]);
      const resetResults = await Promise.all([
        consumePasswordReset({ tokenHash: resetHashA, passwordHash: "new-hash-a" }),
        consumePasswordReset({ tokenHash: resetHashB, passwordHash: "new-hash-b" }),
      ]);
      assert.equal(resetResults.filter(Boolean).length, 1);
      const [savedUser] = await db.select().from(users).where(eq(users.id, userId));
      assert.match(savedUser.passwordHash ?? "", /^new-hash-[ab]$/);
      const stillActive = await db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      assert.equal(stillActive.length, 0);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
    }
  }
);

test(
  "concurrent forgot-password requests leave exactly one active reset",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const email = `forgot-atomicity-${userId}@example.invalid`;
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(cookie, { secret: "test-cookie-secret-with-more-than-32-characters" });
    await app.register(authRoutes, { prefix: "/auth" });

    try {
      await db.insert(users).values({
        id: userId,
        email,
        name: "Forgot password atomicity test",
        role: "REPORTER",
        passwordHash: "old-hash",
        passwordSet: true,
      });

      const responses = await Promise.all(
        Array.from({ length: 4 }, () => app.inject({
          method: "POST",
          url: "/auth/forgot-password",
          payload: { email },
        }))
      );
      assert.ok(responses.every((response) => response.statusCode === 200));

      const resetRows = await db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.userId, userId));
      assert.equal(resetRows.length, 4);
      assert.equal(resetRows.filter((row) => row.usedAt === null && row.expiresAt > new Date()).length, 1);

      const queuedMail = await db
        .select()
        .from(mailOutboxJobs)
        .where(eq(mailOutboxJobs.recipient, email));
      assert.equal(queuedMail.length, 4);
    } finally {
      await app.close();
      await db.delete(mailOutboxJobs).where(eq(mailOutboxJobs.recipient, email));
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
    }
  }
);
