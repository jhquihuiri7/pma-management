import type { FastifyInstance } from "fastify";
import { authenticate, requireApp } from "../../auth/middleware.js";

/**
 * PG2030 routes — seguimiento al Plan Galápagos 2030.
 *
 * Every endpoint registered here inherits the session and app-access checks,
 * so features only need to add their own routes and role requirements.
 */
export async function pg2030Routes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pg2030"));
}
