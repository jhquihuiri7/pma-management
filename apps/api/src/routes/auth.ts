import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../lib/env.js";
import { BadRequest, Unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  isPasswordWithinBcryptLimit,
  PASSWORD_MIN_CHARACTERS,
} from "../auth/passwordPolicy.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
  ttlToSeconds,
} from "../auth/jwt.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/middleware.js";
import {
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  findActivePasswordReset,
  consumePasswordReset,
} from "../modules/shared/userRepo.js";
import { passwordResetEmail } from "../mail/templates.js";
import { getDb } from "../db/client.js";
import { passwordResets, users } from "../db/schema/shared.js";
import { enqueueMail } from "../modules/shared/mailOutbox.js";
import { enforceAuthRateLimit } from "../auth/rateLimit.js";

const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1_024).refine(
    isPasswordWithinBcryptLimit,
    `La contraseña no puede superar ${BCRYPT_MAX_PASSWORD_BYTES} bytes`,
  ),
}).strict();

const forgotSchema = z.object({ email: z.string().trim().email().max(320) }).strict();
const resetSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  password: z.string().min(PASSWORD_MIN_CHARACTERS).refine(
    isPasswordWithinBcryptLimit,
    `La contraseña no puede superar ${BCRYPT_MAX_PASSWORD_BYTES} bytes`,
  ),
}).strict();

function cookieBaseOpts() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    domain: env.COOKIE_DOMAIN || undefined,
  };
}

function cookieOpts(maxAgeSec: number) {
  return {
    ...cookieBaseOpts(),
    maxAge: maxAgeSec,
  };
}

async function issueTokens(
  reply: FastifyReply,
  user: Awaited<ReturnType<typeof findUserById>>,
  req: FastifyRequest,
  currentRefreshTokenHash?: string
) {
  if (!user) throw Unauthorized();
  const access = await signAccessToken({
    sub: user.id,
    adminId: user.adminId,
    email: user.email,
    name: user.name,
    role: user.role,
    apps: user.apps,
  });
  const refresh = await signRefreshToken(user.id);
  const nextTokenHash = hashRefreshToken(refresh.token);
  if (currentRefreshTokenHash) {
    const rotated = await rotateRefreshToken({
      currentTokenHash: currentRefreshTokenHash,
      userId: user.id,
      nextTokenHash,
      nextExpiresAt: refresh.expiresAt,
      userAgent: req.headers["user-agent"] ?? undefined,
      ip: req.ip,
    });
    if (!rotated) throw Unauthorized("Refresh token revoked");
  } else {
    await insertRefreshToken({
      userId: user.id,
      tokenHash: nextTokenHash,
      expiresAt: refresh.expiresAt,
      userAgent: req.headers["user-agent"] ?? undefined,
      ip: req.ip,
    });
  }
  reply.setCookie(ACCESS_COOKIE, access, cookieOpts(ttlToSeconds(env.JWT_ACCESS_TTL)));
  reply.setCookie(
    REFRESH_COOKIE,
    refresh.token,
    cookieOpts(Math.max(1, Math.ceil((refresh.expiresAt.getTime() - Date.now()) / 1000)))
  );
  return { access, refreshExpiresAt: refresh.expiresAt };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    await enforceAuthRateLimit({
      request: req,
      reply,
      scope: "login",
      subject: (req.body as { email?: unknown } | null)?.email,
      limit: 10,
      windowMs: 15 * 60_000,
    });
    const body = loginSchema.parse(req.body);
    const user = await findUserByEmail(body.email.toLowerCase());
    if (!user) throw Unauthorized("Invalid credentials");
    if (!user.passwordSet || !user.passwordHash) {
      throw Unauthorized("Password not set; check your email for setup link");
    }
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw Unauthorized("Invalid credentials");
    await issueTokens(reply, user, req);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        adminId: user.adminId,
        apps: user.apps,
      },
    };
  });

  app.post("/refresh", async (req, reply) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw Unauthorized("Missing refresh token");
    let claims;
    try {
      claims = await verifyRefreshToken(token);
    } catch {
      throw Unauthorized("Invalid refresh token");
    }
    if (typeof claims.sub !== "string") throw Unauthorized("Invalid refresh token");
    const tokenHash = hashRefreshToken(token);
    const user = await findUserById(claims.sub);
    if (!user) throw Unauthorized();
    await issueTokens(reply, user, req, tokenHash);
    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await revokeRefreshToken(hashRefreshToken(token));
    }
    reply.clearCookie(ACCESS_COOKIE, cookieBaseOpts());
    reply.clearCookie(REFRESH_COOKIE, cookieBaseOpts());
    return { ok: true };
  });

  app.post("/forgot-password", async (req, reply) => {
    await enforceAuthRateLimit({
      request: req,
      reply,
      scope: "forgot-password",
      subject: (req.body as { email?: unknown } | null)?.email,
      limit: 5,
      windowMs: 60 * 60_000,
    });
    const body = forgotSchema.parse(req.body);
    const user = await findUserByEmail(body.email.toLowerCase());
    // Always succeed to avoid email enumeration
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashRefreshToken(token); // reuse sha256 hasher
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
      const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${token}`;
      const content = passwordResetEmail({ name: user.name, link });
      await getDb().transaction(async (tx) => {
        // The user row is the lifecycle lock for password resets. Concurrent
        // forgot/reset/set-password requests for the same account therefore
        // serialize before replacing or consuming any token.
        const [lockedUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
          .for("update");
        // Account deletion may race the enumeration-safe lookup above.
        if (!lockedUser) return;
        await tx
          .update(passwordResets)
          .set({ usedAt: new Date() })
          .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
        await tx.insert(passwordResets).values({ userId: user.id, tokenHash, expiresAt });
        await enqueueMail(tx, {
          to: user.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
        }, expiresAt);
      });
    }
    return { ok: true };
  });

  app.post("/reset-password", async (req, reply) => {
    await enforceAuthRateLimit({
      request: req,
      reply,
      scope: "reset-password",
      subject: (req.body as { token?: unknown } | null)?.token,
      limit: 10,
      windowMs: 15 * 60_000,
    });
    const body = resetSchema.parse(req.body);
    const tokenHash = hashRefreshToken(body.token);
    const reset = await findActivePasswordReset(tokenHash);
    if (!reset) throw BadRequest("Token inválido o expirado");
    const hashed = await hashPassword(body.password);
    const consumed = await consumePasswordReset({ tokenHash, passwordHash: hashed });
    if (!consumed) throw BadRequest("Token inválido o expirado");
    return { ok: true };
  });

  app.post("/set-password", async (req, reply) => {
    await enforceAuthRateLimit({
      request: req,
      reply,
      scope: "set-password",
      subject: (req.body as { token?: unknown } | null)?.token,
      limit: 10,
      windowMs: 15 * 60_000,
    });
    const body = resetSchema.parse(req.body);
    const tokenHash = hashRefreshToken(body.token);
    const reset = await findActivePasswordReset(tokenHash);
    if (!reset) throw BadRequest("Token inválido o expirado");
    const hashed = await hashPassword(body.password);
    const consumed = await consumePasswordReset({ tokenHash, passwordHash: hashed });
    if (!consumed) throw BadRequest("Token inválido o expirado");
    return { ok: true };
  });

  app.get("/me", async (req) => {
    if (!req.user) throw Unauthorized();
    return { user: req.user };
  });
}
