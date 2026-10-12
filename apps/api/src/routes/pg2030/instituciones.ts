import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../auth/middleware.js";
import { pg2030InstitucionTipoEnum } from "../../db/schema/enums.js";
import {
  createInstitucion,
  deleteInstitucion,
  listInstituciones,
  updateInstitucion,
} from "../../modules/pg2030/institucionesModule.js";

const idParamsSchema = z.object({ id: z.string().uuid() });

const nombre = z.string().trim().min(1, "El nombre es obligatorio").max(300);
// Siglas are short codes (CGREG, MAGP, GADM-SC). Inner whitespace is collapsed
// so "GAD  SC" and "GAD SC" cannot coexist as two institutions.
const sigla = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "La sigla es obligatoria").max(40));

export const institucionCreateSchema = z.object({
  nombre,
  sigla,
  tipo: z.enum(pg2030InstitucionTipoEnum.enumValues),
  activa: z.boolean().optional(),
}).strict();

export const institucionPatchSchema = z.object({
  nombre: nombre.optional(),
  sigla: sigla.optional(),
  tipo: z.enum(pg2030InstitucionTipoEnum.enumValues).optional(),
  activa: z.boolean().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

/**
 * The institutions catalog. Every PG2030 user can list it (names and siglas are
 * not sensitive); only an administrator changes it.
 */
export async function pg2030InstitucionesRoutes(app: FastifyInstance) {
  app.get("/", async () => listInstituciones());

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = institucionCreateSchema.parse(req.body);
    const created = await createInstitucion(req.user!.sub, body);
    reply.status(201);
    return created;
  });

  app.patch("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = institucionPatchSchema.parse(req.body);
    return updateInstitucion(req.user!.sub, id, body);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return deleteInstitucion(req.user!.sub, id);
  });
}
