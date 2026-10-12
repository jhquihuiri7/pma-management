import type { FastifyInstance } from "fastify";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getPg2030Me } from "../../modules/pg2030/institucionesModule.js";
import { pg2030CatalogoRoutes } from "./catalogo.js";
import { pg2030InstitucionesRoutes } from "./instituciones.js";

/**
 * PG2030 routes — seguimiento al Plan Galápagos 2030.
 *
 * Every endpoint registered here inherits the session and app-access checks,
 * so features only need to add their own routes and role requirements.
 */
export async function pg2030Routes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pg2030"));

  // The caller's role and, for a REPORTER, the institution they report for.
  app.get("/me", async (req) => getPg2030Me(req.user!));

  await app.register(pg2030CatalogoRoutes, { prefix: "/catalogo" });
  await app.register(pg2030InstitucionesRoutes, { prefix: "/instituciones" });
}
