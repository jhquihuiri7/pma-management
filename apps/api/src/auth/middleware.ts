import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { verifyAccessToken, type AccessTokenClaims } from "./jwt.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";

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
  try {
    const claims = await verifyAccessToken(token);
    req.user = claims;
  } catch {
    throw Unauthorized("Invalid token");
  }
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
    const status = (err as any).statusCode ?? 500;
    const details = (err as any).details;
    // Unexpected 5xx errors can carry internal details (stack traces, DB driver
    // messages, file paths). Log them server-side but never leak to the client.
    if (status >= 500) {
      req.log.error(err);
      return reply.status(status).send({ error: "InternalServerError", message: "Internal server error" });
    }
    reply.status(status).send({
      error: err.name ?? "Error",
      message: err.message,
      ...(details ? { details } : {}),
    });
  });
}
