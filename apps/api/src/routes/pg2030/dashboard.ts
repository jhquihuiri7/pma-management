import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pg2030InstitucionTipoEnum } from "../../db/schema/enums.js";
import { getDashboard } from "../../modules/pg2030/dashboardModule.js";
import type { Trimestre } from "../../modules/pg2030/cortes.js";

const query = z.object({
  anio: z.coerce.number().int().min(2020).max(2100).optional(),
  trimestre: z.coerce.number().int().min(1).max(4).transform((t) => t as Trimestre).optional(),
  ejeId: z.string().uuid().optional(),
  institucionId: z.string().uuid().optional(),
  tipoInstitucion: z.enum(pg2030InstitucionTipoEnum.enumValues).optional(),
});

/** The cutoff dashboard (plan §10). A reporter's request is scoped to their institution. */
export async function pg2030DashboardRoutes(app: FastifyInstance) {
  app.get("/", async (req) => getDashboard(req.user!, query.parse(req.query)));
}
