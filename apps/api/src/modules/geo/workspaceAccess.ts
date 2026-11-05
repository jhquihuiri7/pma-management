import type { FastifyRequest } from "fastify";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { env } from "../../lib/env.js";
import { BadRequest, NotFound } from "../../lib/errors.js";

/**
 * Who gets the RustGIS Workspace (GEO_WORKSPACE_ENGINE / GEO_WORKSPACE_PILOT_USERS),
 * and which origins may receive absolute data addresses. Switching back to the
 * old Workspace is a configuration change only (docs/plan-integracion-rustgis.md §9).
 */

export type WorkspaceEngine = "legacy" | "rustgis";

type User = Pick<AccessTokenClaims, "sub" | "email" | "role" | "apps">;

export function pilotUsers(raw = env.GEO_WORKSPACE_PILOT_USERS): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function workspaceEngineFor(user: User | undefined, engine = env.GEO_WORKSPACE_ENGINE, pilots = pilotUsers()): WorkspaceEngine {
  if (!user) return "legacy";
  if (!(user.role === "ADMIN" || user.apps.includes("geo"))) return "legacy";
  if (engine === "rustgis") return "rustgis";
  if (engine === "pilot" && (pilots.has(user.sub.toLowerCase()) || pilots.has((user.email ?? "").toLowerCase()))) {
    return "rustgis";
  }
  return "legacy";
}

/** preHandler for the Workspace routes (after authenticate + requireApp("geo")). */
export async function requireRustgisWorkspace(req: FastifyRequest): Promise<void> {
  if (workspaceEngineFor(req.user) !== "rustgis") throw NotFound("Workspace no disponible");
}

/** The same origins the API accepts for CORS (index.ts). */
export function workspaceOrigins(frontendOrigin = env.FRONTEND_ORIGIN): string[] {
  const origins = [frontendOrigin.replace(/\/+$/, "")];
  try {
    const url = new URL(frontendOrigin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const alt = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
      origins.push(`${url.protocol}//${alt}${url.port ? `:${url.port}` : ""}`);
    }
  } catch {
    // FRONTEND_ORIGIN is validated at start-up by its use in CORS.
  }
  return origins;
}

/**
 * The origin the page runs on, which RustGIS needs in every data address
 * (absolute URLs, same origin so the session cookie goes with them).
 */
export function checkWorkspaceOrigin(origin: unknown, allowed = workspaceOrigins()): string {
  if (typeof origin !== "string") throw BadRequest("Falta el origen de la página");
  const clean = origin.replace(/\/+$/, "");
  if (!allowed.includes(clean)) throw BadRequest("Origen no permitido");
  return clean;
}
