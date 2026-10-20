import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { assertPublicWriteOrigin } from "../../auth/publicOrigin.js";
import { enforceAuthRateLimit } from "../../auth/rateLimit.js";
import { BadRequest } from "../../lib/errors.js";
import { catalogos } from "../../modules/riesgos/catalogos.js";
import { crearDelegacion, listarDelegaciones, reciboDelegacion } from "../../modules/riesgos/delegacionesModule.js";
import { tablaDelegaciones, tablaRecursos } from "../../modules/riesgos/exportacion.js";
import {
  crearFicha,
  listarFichas,
  listarRecursos,
  obtenerFicha,
  reciboFicha,
  resumen,
  revisarFicha,
} from "../../modules/riesgos/fichasModule.js";
import {
  camposInvalidos,
  claveInstitucion,
  delegacionSchema,
  fichaSchema,
  filtrosDelegacionesSchema,
  filtrosFichasSchema,
  filtrosRecursosSchema,
  revisionSchema,
} from "../../modules/riesgos/modelo.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** A public form gets every rejected field back, keyed by the form's own paths. */
function validarFormulario<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw BadRequest("Revise los campos marcados.", { campos: camposInvalidos(result.error) });
  }
  return result.data;
}

/**
 * Gestión de Riesgos. Mixed surface, like Plan Familiar: the two forms under
 * /public are open to any institution; everything else needs a session with
 * access to the module. Exports are open to every role with that access;
 * reviewing a ficha is for administrators.
 */
export async function riesgosRoutes(app: FastifyInstance) {
  const conAcceso = [authenticate, requireApp("riesgos")];

  app.get("/public/catalogos", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return catalogos();
  });

  app.post("/public/fichas", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const ficha = validarFormulario(fichaSchema, request.body);
    const existente = await reciboFicha(ficha.id);
    if (existente) return existente;

    await enforceAuthRateLimit({
      request,
      reply,
      scope: "riesgos-ficha",
      subject: claveInstitucion(ficha.institucionNombre),
      limit: 10,
      originLimit: 60,
      windowMs: DAY_MS,
    });
    const { recibo, creada } = await crearFicha(ficha);
    if (creada) {
      request.log.info({ fichaId: recibo.id, recursos: ficha.recursos.length, isla: ficha.isla }, "riesgos ficha registered");
      reply.status(201);
    }
    return recibo;
  });

  app.post("/public/delegaciones", { bodyLimit: 32 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const delegacion = validarFormulario(delegacionSchema, request.body);
    const existente = await reciboDelegacion(delegacion.id);
    if (existente) return existente;

    await enforceAuthRateLimit({
      request,
      reply,
      scope: "riesgos-delegacion",
      subject: claveInstitucion(delegacion.institucionNombre),
      limit: 10,
      originLimit: 60,
      windowMs: DAY_MS,
    });
    const { recibo, creada } = await crearDelegacion(delegacion);
    if (creada) {
      request.log.info({ delegacionId: recibo.id, isla: delegacion.isla }, "riesgos delegacion registered");
      reply.status(201);
    }
    return recibo;
  });

  app.get("/resumen", { preHandler: conAcceso }, async () => resumen());

  app.get("/recursos", { preHandler: conAcceso }, async (request) =>
    listarRecursos(filtrosRecursosSchema.parse(request.query)));

  app.get("/fichas", { preHandler: conAcceso }, async (request) =>
    listarFichas(filtrosFichasSchema.parse(request.query)));

  app.get("/fichas/:id", { preHandler: conAcceso }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return obtenerFicha(id);
  });

  app.put("/fichas/:id/revision", { preHandler: [...conAcceso, requireRole("ADMIN")] }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = revisionSchema.parse(request.body);
    const ficha = await revisarFicha(id, input, request.user!.sub);
    request.log.info({ fichaId: id, estado: input.estado }, "riesgos ficha reviewed");
    return ficha;
  });

  app.get("/delegaciones", { preHandler: conAcceso }, async (request) =>
    listarDelegaciones(filtrosDelegacionesSchema.parse(request.query)));

  app.get("/exportar/recursos", { preHandler: conAcceso }, async (request, reply) => {
    const tabla = await tablaRecursos(filtrosRecursosSchema.parse(request.query));
    request.log.info({ exportedRows: tabla.filas.length }, "riesgos resources exported");
    reply.header("Cache-Control", "private, no-store");
    return tabla;
  });

  app.get("/exportar/delegaciones", { preHandler: conAcceso }, async (request, reply) => {
    const tabla = await tablaDelegaciones(filtrosDelegacionesSchema.parse(request.query));
    request.log.info({ exportedRows: tabla.filas.length }, "riesgos delegations exported");
    reply.header("Cache-Control", "private, no-store");
    return tabla;
  });
}
