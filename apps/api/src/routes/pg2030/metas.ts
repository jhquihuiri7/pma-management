import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../auth/middleware.js";
import { pg2030FuenteFinanciamientoEnum } from "../../db/schema/enums.js";
import {
  createMeta,
  deleteMeta,
  listMetas,
  reportarMes,
  updateMeta,
  updatePlanificacion,
} from "../../modules/pg2030/metasModule.js";

/** Required text: trimmed, never blank. */
const requiredText = (max: number) => z.string().trim().min(1, "No puede quedar vacío").max(max);

/** Optional text: an empty string clears the field. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  ).optional();

const fuente = z.preprocess(
  (value) => (value === "" ? null : value),
  z.enum(pg2030FuenteFinanciamientoEnum.enumValues).nullable(),
).optional();

// numeric(18,4) for physical progress and numeric(14,2) for money.
const fisico = z.number({ invalid_type_error: "Debe ser un número" }).min(0, "No puede ser negativo").max(99_999_999_999_999);
const dinero = z.number({ invalid_type_error: "Debe ser un número" }).min(0, "No puede ser negativo").max(999_999_999_999.99);

/** All twelve months, once each: the yearly target is their sum. */
export const planificacionSchema = z
  .array(z.object({ mes: z.number().int().min(1).max(12), fisico, presupuesto: dinero }).strict())
  .length(12, "La planificación lleva los 12 meses")
  .refine((meses) => new Set(meses.map((m) => m.mes)).size === 12, "Cada mes debe aparecer una sola vez");

const camposMeta = {
  nombre: requiredText(500),
  descripcion: optionalText(5_000),
  unidadMedida: requiredText(100),
  fuenteFinanciamiento: fuente,
  beneficiariosDirectos: optionalText(2_000),
  personalTecnico: optionalText(2_000),
  responsablesInternos: optionalText(2_000),
  entidadesCoordinacion: optionalText(2_000),
};

export const crearMetaSchema = z.object({
  anio: z.number().int().min(2020).max(2100),
  institucionId: z.string().uuid(),
  proyectoId: z.string().uuid(),
  ...camposMeta,
  planificacion: planificacionSchema,
}).strict();

export const actualizarMetaSchema = z.object({
  proyectoId: z.string().uuid().optional(),
  nombre: camposMeta.nombre.optional(),
  descripcion: camposMeta.descripcion,
  unidadMedida: camposMeta.unidadMedida.optional(),
  fuenteFinanciamiento: camposMeta.fuenteFinanciamiento,
  beneficiariosDirectos: camposMeta.beneficiariosDirectos,
  personalTecnico: camposMeta.personalTecnico,
  responsablesInternos: camposMeta.responsablesInternos,
  entidadesCoordinacion: camposMeta.entidadesCoordinacion,
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

export const ejecucionSchema = z.object({
  fisicoEjecutado: fisico,
  presupuestoDevengado: dinero,
  hitosAlcanzados: optionalText(5_000),
  observaciones: optionalText(5_000),
}).strict();

const listQuery = z.object({
  anio: z.coerce.number().int().min(2020).max(2100),
  institucionId: z.string().uuid().optional(),
});
const idParams = z.object({ id: z.string().uuid() });
const mesParams = idParams.extend({ mes: z.coerce.number().int().min(1).max(12) });

/**
 * Institutional goals: the yearly plan and the monthly report (§5, §6). A
 * reporter works only on their institution's goals; an administrator plans
 * for any institution and reports for one only inside the initial load.
 */
export async function pg2030MetasRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const { anio, institucionId } = listQuery.parse(req.query);
    return listMetas(req.user!, anio, institucionId);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req, reply) => {
    const body = crearMetaSchema.parse(req.body);
    const created = await createMeta(req.user!.sub, body);
    reply.status(201);
    return created;
  });

  app.patch("/:id", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = actualizarMetaSchema.parse(req.body);
    return updateMeta(req.user!.sub, id, body);
  });

  app.put("/:id/planificacion", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ planificacion: planificacionSchema }).strict().parse(req.body);
    return updatePlanificacion(req.user!.sub, id, body.planificacion);
  });

  app.put("/:id/meses/:mes/ejecucion", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { id, mes } = mesParams.parse(req.params);
    const body = ejecucionSchema.parse(req.body);
    return reportarMes(req.user!.sub, id, mes, body);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { id } = idParams.parse(req.params);
    return deleteMeta(req.user!.sub, id);
  });
}
