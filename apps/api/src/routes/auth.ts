import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { env } from "../lib/env.js";
import { BadRequest, Unauthorized, NotFound } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} from "../auth/jwt.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/middleware.js";
import {
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  updateUserPassword,
  insertPasswordReset,
  findActivePasswordReset,
  markPasswordResetUsed,
} from "../modules/shared/userRepo.js";
import { getMail } from "../mail/index.js";
import { passwordResetEmail } from "../mail/templates.js";

const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

function cookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax" as const,
    path: "/",
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: maxAgeSec,
  };
}

async function issueTokens(reply: FastifyReply, user: Awaited<ReturnType<typeof findUserById>>, req: FastifyRequest) {
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
  await insertRefreshToken({
    userId: user.id,
    tokenHash: hashRefreshToken(refresh.token),
    expiresAt: refresh.expiresAt,
    userAgent: req.headers["user-agent"] ?? undefined,
    ip: req.ip,
  });
  reply.setCookie(ACCESS_COOKIE, access, cookieOpts(15 * 60));
  reply.setCookie(REFRESH_COOKIE, refresh.token, cookieOpts(7 * 24 * 60 * 60));
  return { access, refreshExpiresAt: refresh.expiresAt };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await findUserByEmail(body.email.toLowerCase());
    if (!user || !user.passwordHash) throw Unauthorized("Invalid credentials");
    if (!user.passwordSet) throw Unauthorized("Password not set; check your email for setup link");
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
    const tokenHash = hashRefreshToken(token);
    const stored = await findActiveRefreshToken(tokenHash);
    if (!stored || stored.userId !== claims.sub) {
      // possible reuse — revoke all to be safe
      if (typeof claims.sub === "string") {
        await revokeAllRefreshTokensForUser(claims.sub);
      }
      throw Unauthorized("Refresh token revoked");
    }
    await revokeRefreshToken(tokenHash);
    const user = await findUserById(claims.sub as string);
    if (!user) throw Unauthorized();
    await issueTokens(reply, user, req);
    return { ok: true };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      await revokeRefreshToken(hashRefreshToken(token));
    }
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/forgot-password", async (req) => {
    const body = forgotSchema.parse(req.body);
    const user = await findUserByEmail(body.email.toLowerCase());
    // Always succeed to avoid email enumeration
    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashRefreshToken(token); // reuse sha256 hasher
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
      await insertPasswordReset({ userId: user.id, tokenHash, expiresAt });
      const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${token}`;
      const content = passwordResetEmail({ name: user.name, link });
      try {
        await getMail().send({
          to: user.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });
      } catch {
        throw BadRequest("No se pudo enviar el correo de recuperación. Inténtalo de nuevo más tarde.");
      }
    }
    return { ok: true };
  });

  app.post("/reset-password", async (req) => {
    const body = resetSchema.parse(req.body);
    const tokenHash = hashRefreshToken(body.token);
    const reset = await findActivePasswordReset(tokenHash);
    if (!reset) throw BadRequest("Token inválido o expirado");
    const user = await findUserById(reset.userId);
    if (!user) throw NotFound("Usuario no encontrado");
    const hashed = await hashPassword(body.password);
    await updateUserPassword(user.id, hashed);
    await markPasswordResetUsed(tokenHash);
    await revokeAllRefreshTokensForUser(user.id);
    return { ok: true };
  });

  app.post("/set-password", async (req) => {
    const body = resetSchema.parse(req.body);
    const tokenHash = hashRefreshToken(body.token);
    const reset = await findActivePasswordReset(tokenHash);
    if (!reset) throw BadRequest("Token inválido o expirado");
    const user = await findUserById(reset.userId);
    if (!user) throw NotFound("Usuario no encontrado");
    const hashed = await hashPassword(body.password);
    await updateUserPassword(user.id, hashed);
    await markPasswordResetUsed(tokenHash);
    return { ok: true };
  });

  app.get("/me", async (req) => {
    if (!req.user) throw Unauthorized();
    return { user: req.user };
  });
}
