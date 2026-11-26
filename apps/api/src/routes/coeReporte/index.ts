import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { assertPublicWriteOrigin } from "../../auth/publicOrigin.js";
import { enforceAuthRateLimit } from "../../auth/rateLimit.js";
import { BadRequest, Unauthorized } from "../../lib/errors.js";
import {
  crearActividad,
  crearEvento,
  listarActividades,
  listarEventos,
  listarMias,
  registrarResultado,
} from "../../modules/coeReporte/actividadesModule.js";
import { catalogos } from "../../modules/coeReporte/catalogos.js";
import {
  agregarDelegado,
  agregarDestinatario,
  directorio,
  quitarDelegado,
  quitarDestinatario,
} from "../../modules/coeReporte/directorioModule.js";
import {
  CODIGO_HISTORIAL,
  actividadSchema,
  delegadoSchema,
  destinatarioSchema,
  eventoSchema,
  filtrosSchema,
  propietarioDe,
  resultadoSchema,
} from "../../modules/coeReporte/modelo.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const CABECERA_CODIGO = "x-codigo-historial";
const idParams = z.object({ id: z.string().uuid("Identificador de actividad inválido.") }).strict();

/**
 * The anonymous history code travels in its own header, not in
 * Authorization, so it is never mistaken for a SIGTAR session token. Only its
 * digest is used from here on; the code itself is never logged.
 */
function propietario(request: FastifyRequest): string {
  const codigo = request.headers[CABECERA_CODIGO];
  if (typeof codigo !== "string" || !CODIGO_HISTORIAL.test(codigo)) {
    throw Unauthorized("Abre Mi historial para recuperar tu acceso.");
  }
  return propietarioDe(codigo);
}

/** The public form shows the first rejected field's message. */
function validar<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw BadRequest(issue?.message ?? "Solicitud inválida.", { campo: issue?.path.join(".") ?? "" });
  }
  return result.data;
}

/**
 * Reporte territorial COE. Mixed surface, like Gestión de Riesgos: reporting
 * under /public is open (each browser identified by its history code); the
 * board needs a session with the module. Reading and CSV are for every role
 * with access; recipients and delegates are edited by ADMIN and REPORTER.
 */
export async function coeReporteRoutes(app: FastifyInstance) {
  const conAcceso = [authenticate, requireApp("coe_reporte")];
  const conEdicion = [...conAcceso, requireRole("ADMIN", "REPORTER")];

  app.get("/public/catalogos", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return catalogos();
  });

  app.get("/public/eventos", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return listarEventos();
  });

  app.post("/public/eventos", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const dueno = propietario(request);
    const { titulo } = validar(eventoSchema, request.body);
    await enforceAuthRateLimit({
      request, reply, scope: "coe-evento", subject: dueno, limit: 20, originLimit: 100, windowMs: DAY_MS,
    });
    const { evento, creado } = await crearEvento(titulo);
    if (creado) {
      request.log.info({ eventoId: evento.id }, "coe event created");
      reply.status(201);
    }
    return evento;
  });

  app.get("/public/mis-actividades", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return listarMias(propietario(request));
  });

  app.post("/public/actividades", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const dueno = propietario(request);
    const actividad = validar(actividadSchema, request.body);
    await enforceAuthRateLimit({
      request, reply, scope: "coe-actividad", subject: dueno, limit: 300, originLimit: 2000, windowMs: DAY_MS,
    });
    const resultado = await crearActividad(dueno, actividad);
    if (resultado.creada) {
      request.log.info({ actividadId: actividad.id, estado: actividad.estado, isla: actividad.isla }, "coe activity registered");
      reply.status(201);
    }
    return resultado.actividad;
  });

  app.post("/public/actividades/:id/resultado", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const dueno = propietario(request);
    const { id } = validar(idParams, request.params);
    const resultado = validar(resultadoSchema, request.body);
    await enforceAuthRateLimit({
      request, reply, scope: "coe-actividad", subject: dueno, limit: 300, originLimit: 2000, windowMs: DAY_MS,
    });
    const guardado = await registrarResultado(dueno, id, resultado);
    if (guardado.creada) request.log.info({ actividadId: id, estado: resultado.estado }, "coe result registered");
    return guardado.actividad;
  });

  // ----------------------------------------------------------------- board

  app.get("/actividades", { preHandler: conAcceso }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return listarActividades(filtrosSchema.parse(request.query));
  });

  app.get("/directorio", { preHandler: conAcceso }, async (_request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return directorio();
  });

  app.post("/destinatarios", { preHandler: conEdicion, bodyLimit: 4 * 1024 }, async (request) => {
    const { email } = validar(destinatarioSchema, request.body);
    return agregarDestinatario(email, request.user!.sub);
  });

  app.delete("/destinatarios", { preHandler: conEdicion, bodyLimit: 4 * 1024 }, async (request) => {
    const { email } = validar(destinatarioSchema, request.body);
    return quitarDestinatario(email);
  });

  app.post("/delegados", { preHandler: conEdicion, bodyLimit: 4 * 1024 }, async (request) => {
    return agregarDelegado(validar(delegadoSchema, request.body));
  });

  app.delete("/delegados/:id", { preHandler: conEdicion }, async (request) => {
    const { id } = validar(idParams, request.params);
    return quitarDelegado(id);
  });
}
