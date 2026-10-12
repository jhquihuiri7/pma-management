import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../auth/middleware.js";
import {
  abrirAnio,
  ampliarCarga,
  crearReapertura,
  listAnios,
  listBitacora,
  listInstitucionesDelAnio,
  listReaperturas,
  setConvocatoria,
  setSinAcciones,
} from "../../modules/pg2030/aniosModule.js";
import type { Trimestre } from "../../modules/pg2030/cortes.js";

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A calendar date, read as "until the end of that day in Galápagos". */
export const fechaSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Fecha inválida (AAAA-MM-DD)")
  .refine(isRealDate, "Fecha inválida");

const anioParams = z.object({ anio: z.coerce.number().int().min(2020).max(2100) });
const anioInstParams = anioParams.extend({ institucionId: z.string().uuid() });
const trimestre = z.coerce.number().int().min(1).max(4).transform((t) => t as Trimestre);

export const abrirAnioSchema = z.object({
  anio: z.number().int().min(2020).max(2100),
  primerCorte: trimestre,
  fechaLimiteCarga: fechaSchema.nullable().optional(),
}).strict();

const ampliarCargaSchema = z.object({ fechaLimiteCarga: fechaSchema }).strict();
const convocatoriaSchema = z.object({ convocada: z.boolean() }).strict();
const sinAccionesSchema = z.object({ declarada: z.boolean() }).strict();

export const reaperturaSchema = z.object({
  trimestre,
  institucionId: z.string().uuid(),
  fechaLimite: fechaSchema,
  motivo: z.string().trim().min(1, "Indica el motivo de la reapertura").max(2_000),
}).strict();

const bitacoraQuery = z.object({ institucionId: z.string().uuid().optional() });

/**
 * Fiscal years, their cutoffs and the yearly call (docs/pg2030-plan.md §7).
 * Opening years, calling institutions and reopening cutoffs are an
 * administrator's; the "sin acciones" declaration is also the institution's.
 */
export async function pg2030AniosRoutes(app: FastifyInstance) {
  app.get("/", async () => listAnios());

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = abrirAnioSchema.parse(req.body);
    const created = await abrirAnio(req.user!.sub, {
      anio: body.anio,
      primerCorte: body.primerCorte,
      fechaLimiteCarga: body.fechaLimiteCarga ?? null,
    });
    reply.status(201);
    return created;
  });

  app.patch("/:anio", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { anio } = anioParams.parse(req.params);
    const body = ampliarCargaSchema.parse(req.body);
    return ampliarCarga(req.user!.sub, anio, body.fechaLimiteCarga);
  });

  app.get("/:anio/instituciones", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { anio } = anioParams.parse(req.params);
    return listInstitucionesDelAnio(anio);
  });

  app.put("/:anio/convocatoria/:institucionId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { anio, institucionId } = anioInstParams.parse(req.params);
    const body = convocatoriaSchema.parse(req.body);
    return setConvocatoria(req.user!.sub, anio, institucionId, body.convocada);
  });

  app.put("/:anio/sin-acciones/:institucionId", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { anio, institucionId } = anioInstParams.parse(req.params);
    const body = sinAccionesSchema.parse(req.body);
    return setSinAcciones(req.user!.sub, anio, institucionId, body.declarada);
  });

  app.get("/:anio/reaperturas", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { anio } = anioParams.parse(req.params);
    return listReaperturas(anio);
  });

  app.post("/:anio/reaperturas", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { anio } = anioParams.parse(req.params);
    const body = reaperturaSchema.parse(req.body);
    const created = await crearReapertura(req.user!.sub, anio, body);
    reply.status(201);
    return created;
  });

  app.get("/:anio/bitacora", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { anio } = anioParams.parse(req.params);
    const { institucionId } = bitacoraQuery.parse(req.query);
    return listBitacora(anio, institucionId);
  });
}
