import type { FastifyRequest } from "fastify";
import { env } from "../lib/env.js";
import { Forbidden } from "../lib/errors.js";

function acceptedOrigins(): Set<string> {
  const configured = new URL(env.FRONTEND_ORIGIN);
  const values = new Set([configured.origin]);
  if (env.NODE_ENV === "development") {
    const alternate = configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    values.add(`${configured.protocol}//${alternate}${configured.port ? `:${configured.port}` : ""}`);
  }
  return values;
}

/**
 * Public, unauthenticated writes (Plan Familiar, Gestión de Riesgos) accept
 * only requests sent by our own pages: a form posted from another site, or a
 * script with no Origin at all, is refused before anything is stored.
 */
export function assertPublicWriteOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin || !acceptedOrigins().has(origin)) {
    throw Forbidden("Origen no autorizado");
  }
}
