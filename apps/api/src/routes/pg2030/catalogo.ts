import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../auth/middleware.js";
import { pg2030PresupuestoEstadoEnum, pg2030ProyectoTipoEnum } from "../../db/schema/enums.js";
import {
  getCatalogo,
  marcarConflictoRevisado,
  updateEje,
  updateMetaPlan,
  updateProyecto,
  updateTextoNivel,
} from "../../modules/pg2030/catalogoModule.js";

const idParamsSchema = z.object({ id: z.string().uuid() });
const nivelParamsSchema = z.object({
  nivel: z.enum(["objetivos", "politicas", "estrategias"]),
  id: z.string().uuid(),
});

/** Required catalog text: trimmed, never blank. */
const requiredText = z.string().trim().min(1, "No puede quedar vacío").max(5_000);

/** Optional catalog text: an empty string clears the field. */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(5_000).nullable(),
).optional();

export const proyectoPatchSchema = z.object({
  nombre: requiredText.optional(),
  tipo: z.enum(pg2030ProyectoTipoEnum.enumValues).optional(),
  plazo: optionalText,
  presupuestoEstado: z.enum(pg2030PresupuestoEstadoEnum.enumValues).optional(),
  // numeric(14,2): up to 999.999.999.999,99.
  presupuestoReferencial: z.number().positive("El monto debe ser mayor que 0").max(999_999_999_999.99).nullable().optional(),
  tipoEntidadResponsable: optionalText,
  responsablesPlan: optionalText,
  entidadesEjecutoras: optionalText,
  hito2023: optionalText,
  hito2030: optionalText,
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

const ejePatchSchema = z.object({ nombre: requiredText }).strict();
const textoPatchSchema = z.object({ texto: requiredText }).strict();
const metaPatchSchema = z.object({
  texto: requiredText.optional(),
  cuantificable: z.boolean().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

/**
 * The Plan Galápagos 2030 catalog. Everyone with PG2030 access reads it; only
 * an administrator corrects it, and nobody adds or deletes rows. Session and
 * app access come from the parent plugin (routes/pg2030/index.ts).
 */
export async function pg2030CatalogoRoutes(app: FastifyInstance) {
  app.get("/", async () => getCatalogo());

  app.patch("/proyectos/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = proyectoPatchSchema.parse(req.body);
    return updateProyecto(req.user!.sub, id, body);
  });

  app.patch("/ejes/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = ejePatchSchema.parse(req.body);
    return updateEje(req.user!.sub, id, body.nombre);
  });

  app.patch("/metas/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = metaPatchSchema.parse(req.body);
    return updateMetaPlan(req.user!.sub, id, body);
  });

  app.patch("/:nivel/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { nivel, id } = nivelParamsSchema.parse(req.params);
    const body = textoPatchSchema.parse(req.body);
    return updateTextoNivel(req.user!.sub, nivel, id, body.texto);
  });

  app.post("/conflictos/:id/revisado", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return marcarConflictoRevisado(req.user!.sub, id);
  });
}
