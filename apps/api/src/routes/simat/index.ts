import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { authenticate, optionalAuthenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { BadRequest } from "../../lib/errors.js";
import type { SimatConector } from "@pma/types";
import { estado } from "../../modules/simat/estadoModule.js";
import { mareografo, obtenerEstacion, serieLluvia, listarNivelMar, nivelMarPuerto } from "../../modules/simat/lecturas.js";
import { pronosticoLluvia } from "../../modules/simat/conectores/openMeteo.js";
import { guardarCriterio } from "../../modules/simat/criteriosModule.js";
import { ESTADOS_VALIDACION } from "../../modules/simat/riesgo.js";
import { registrarNivelObservado } from "../../modules/simat/nivelModule.js";
import { CONECTORES_KEYS, sincronizar } from "../../modules/simat/sincronizacionModule.js";

const idParams = z.object({ id: z.string().min(1).max(60) }).strict();
const codigoParams = z.object({ codigo: z.string().min(1).max(20) }).strict();
const mareasQuery = z.object({ puerto: z.string().min(1).max(100).optional() }).strict();
// Período (h) y paso (min) de la serie del mareógrafo; por defecto 12 h minuto a minuto.
const mareografoQuery = z
  .object({ horas: z.coerce.number().int().min(1).max(72).optional(), paso: z.coerce.number().int().min(1).max(30).optional() })
  .strict();

const criterioSchema = z
  .object({
    id: z.string().uuid().optional(),
    estacion: z.string().min(1).max(60).nullable(),
    puerto: z.string().min(1).max(100),
    datum: z.string().min(1).max(80),
    sector: z.string().min(1).max(120),
    respaldo: z.string().max(500).default(""),
    ventanaMin: z.number().int(),
    vigenciaMin: z.number().int(),
    desfaseMin: z.number().int(),
    lluvia: z
      .object({ vigilancia: z.number().finite(), preparacion: z.number().finite(), respuesta: z.number().finite() })
      .strict(),
    marM: z.number().finite().nullable(),
    estadoValidacion: z.enum(ESTADOS_VALIDACION),
    alertasPublicas: z.boolean(),
    activo: z.boolean(),
  })
  .strict();

const nivelSchema = z
  .object({
    puerto: z.string().min(1).max(100),
    instante: z.string().min(1).max(40),
    valor: z.number().finite(),
    unidad: z.string().max(10).default("m"),
    referencia: z.string().min(1).max(80),
    calidad: z.string().max(80).default("validado"),
    fuente: z.string().max(160).optional(),
  })
  .strict();

function puedeEditar(user?: AccessTokenClaims): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REPORTER" && user.apps.includes("simat");
}

function actor(user: AccessTokenClaims): { id: string; name: string } {
  return { id: user.sub, name: user.name ?? user.email ?? "Usuario SIMAT" };
}

/**
 * SIMAT-GAL. Public read (decision D2): the state, series, gauges, tides and
 * forecast are open. Configuring criteria and registering observed levels need a
 * session with the `simat` app (ADMIN or REPORTER); forcing a sync is ADMIN.
 */
export async function simatRoutes(app: FastifyInstance) {
  const conEdicion = [authenticate, requireApp("simat"), requireRole("ADMIN", "REPORTER")];

  app.get("/estado", { preHandler: optionalAuthenticate }, async (request) => estado(puedeEditar(request.user)));

  app.get("/estaciones/:id/lluvia", async (request) => {
    const { id } = idParams.parse(request.params);
    return serieLluvia(id);
  });

  app.get("/estaciones/:id/pronostico", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const estacion = await obtenerEstacion(id);
    if (!estacion) throw BadRequest("Estación desconocida.");
    try {
      const pron = await pronosticoLluvia({ id: estacion.id, lat: estacion.lat, lon: estacion.lon });
      reply.header("Cache-Control", "public, max-age=300");
      return pron;
    } catch {
      return reply.status(502).send({ error: "Pronóstico temporalmente no disponible." });
    }
  });

  app.get("/mareografos/:codigo", async (request, reply) => {
    const { codigo } = codigoParams.parse(request.params);
    const { horas, paso } = mareografoQuery.parse(request.query);
    const data = await mareografo(codigo, { horas, pasoMin: paso });
    reply.header("Cache-Control", "public, max-age=300");
    return data;
  });

  app.get("/mareas", async (request) => {
    const { puerto } = mareasQuery.parse(request.query);
    // With a port: its tide table plus recent observed levels (the panels split
    // them by `tipo`). Without one: every published prediction, as before.
    if (puerto) return nivelMarPuerto(puerto);
    const rows = await listarNivelMar();
    return rows.filter((r) => r.tipo === "Predicción astronómica");
  });

  app.put("/criterios", { preHandler: conEdicion }, async (request) => {
    const entrada = criterioSchema.parse(request.body);
    return guardarCriterio(entrada, actor(request.user!));
  });

  app.post("/nivel-observado", { preHandler: conEdicion }, async (request) => {
    const entrada = nivelSchema.parse(request.body);
    return registrarNivelObservado(entrada, actor(request.user!));
  });

  app.post("/sincronizar/:conector", { preHandler: [authenticate, requireApp("simat"), requireRole("ADMIN")] }, async (request) => {
    const { conector } = z.object({ conector: z.string() }).parse(request.params);
    if (!CONECTORES_KEYS.includes(conector as SimatConector)) throw BadRequest("Conector desconocido.");
    return sincronizar(conector as SimatConector);
  });
}
