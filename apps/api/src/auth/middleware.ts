import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";
import { findUserById } from "../modules/shared/userRepo.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AccessTokenClaims;
  }
}

export const ACCESS_COOKIE = "pma_access";
export const REFRESH_COOKIE = "pma_refresh";

export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  if (!token) throw Unauthorized("Missing token");
  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw Unauthorized("Invalid token");
  }
  if (typeof claims.sub !== "string") throw Unauthorized("Invalid token subject");

  // JWT claims are an identity hint, not the current authorization source.
  // Rehydrate role/apps on every protected request so deletion, demotion or
  // app removal takes effect immediately instead of waiting for token expiry.
  // Keep this outside the JWT catch: a database outage is a 5xx, never a fake
  // authentication failure that could trigger pointless refresh loops.
  const user = await findUserById(claims.sub);
  if (!user) throw Unauthorized("User no longer exists");
  req.user = {
    ...claims,
    sub: user.id,
    adminId: user.adminId,
    email: user.email,
    name: user.name,
    role: user.role,
    apps: user.apps,
  };

  // Bind the resolved identity to the request-scoped logger so every line for
  // this request — including Fastify's automatic "request completed" — carries
  // who made it. Enables per-user tracking without correlating IPs by hand.
  req.log = req.log.child({ userId: user.id, userEmail: user.email });
}

export function requireRole(...allowed: Array<AccessTokenClaims["role"]>) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw Unauthorized();
    if (!allowed.includes(req.user.role)) throw Forbidden(`Requires role: ${allowed.join("|")}`);
  };
}

export function requireApp(app: AccessTokenClaims["apps"][number]) {
  return async (req: FastifyRequest) => {
    if (!req.user) throw Unauthorized();
    // Admins have implicit access to every subsystem.
    if (req.user.role === "ADMIN") return;
    if (!req.user.apps.includes(app)) throw Forbidden(`Requires app access: ${app}`);
  };
}

function extractToken(req: FastifyRequest): string | null {
  const cookieToken = req.cookies?.[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    const error = err instanceof Error ? err : new Error("Unknown error");
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        message: "Invalid request data",
        details: err.flatten(),
      });
    }
    const status = (err as any).statusCode ?? 500;
    const details = (err as any).details;
    // Unexpected 5xx errors can carry internal details (stack traces, DB driver
    // messages, file paths). Log them server-side but never leak to the client.
    if (status >= 500) {
      req.log.error(err);
      return reply.status(status).send({ error: "InternalServerError", message: "Internal server error" });
    }
    reply.status(status).send({
      error: error.name || "Error",
      message: error.message,
      ...(details ? { details } : {}),
    });
  });
}
