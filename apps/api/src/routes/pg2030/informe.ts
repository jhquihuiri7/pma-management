import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../auth/middleware.js";
import { pg2030InstitucionTipoEnum } from "../../db/schema/enums.js";
import { BadRequest, Conflict, HttpError, NotFound } from "../../lib/errors.js";
import type { Trimestre } from "../../modules/pg2030/cortes.js";
import { CLAVES_GRAFICO, plantilla, type ClaveGrafico } from "../../modules/pg2030/informe/documento.js";
import { generarInforme, hechosDelInforme, redactorPg2030 } from "../../modules/pg2030/informe/informeModule.js";
import { tamanoPng } from "../../modules/pg2030/informe/ooxml.js";
import { crearTrabajo, obtenerTrabajo, posicionEnCola, trabajoActivoDe } from "../../modules/pg2030/informe/trabajos.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PNG = 4 * 1024 * 1024;

const cuerpo = z.object({
  anio: z.number().int().min(2020).max(2100),
  trimestre: z.number().int().min(1).max(4).transform((t) => t as Trimestre),
  tipoInstitucion: z.enum(pg2030InstitucionTipoEnum.enumValues).optional(),
  campos: z.object({
    numeroInforme: z.string().trim().max(80).default(""),
    fecha: z.string().regex(ISO, "Fecha inválida"),
    oficiosMetas: z.string().trim().max(800).default(""),
    oficioAvances: z.string().trim().max(500).default(""),
    fechaLimite: z.union([z.string().regex(ISO, "Fecha límite inválida"), z.literal("")]).default(""),
    enlaceAnexo: z.union([z.string().trim().url("El enlace del anexo no es una URL").max(600), z.literal("")]).default(""),
    observaciones: z.string().trim().max(4000).default(""),
  }),
  /** PNG data URLs of the dashboard charts, captured in the browser. */
  graficos: z.record(z.string(), z.string()).default({}),
});

function png(dataUrl: string, clave: string): Buffer {
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw BadRequest(`El gráfico «${clave}» no es una imagen PNG`);
  const datos = Buffer.from(m[1], "base64");
  if (datos.length > MAX_PNG) throw BadRequest(`El gráfico «${clave}» pesa más de 4 MB`);
  tamanoPng(datos); // throws on anything that is not a PNG
  return datos;
}

/**
 * The quarterly Word report (decisions in docs: cifras del panel, a form for
 * what the system does not store, the local model for the analysis). Not for
 * reporters: the report covers every institution.
 */
export async function pg2030InformeRoutes(app: FastifyInstance) {
  const lectores = { preHandler: requireRole("ADMIN", "VIEWER") };

  app.post("/", { ...lectores, bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    const s = cuerpo.parse(req.body);
    const user = req.user!;
    if (trabajoActivoDe(user.sub)) throw Conflict("Ya estás generando un informe; espera a que termine.");
    const graficos: Partial<Record<ClaveGrafico, Buffer>> = {};
    for (const [clave, dataUrl] of Object.entries(s.graficos)) {
      if (!(CLAVES_GRAFICO as readonly string[]).includes(clave)) throw BadRequest(`Gráfico desconocido: ${clave}`);
      graficos[clave as ClaveGrafico] = png(dataUrl, clave);
    }
    // Validates the cutoff and the template before answering, so a closed year
    // is a 400 and a missing template a 503, not a job that fails minutes later.
    const hechos = await hechosDelInforme(user, s);
    try {
      plantilla();
    } catch (error) {
      req.log.error({ err: error }, "pg2030 informe: plantilla no disponible");
      throw new HttpError(503, "Falta la plantilla del informe en el servidor; avisa al administrador.");
    }
    const nombre = `Informe PG2030 ${s.anio} T${s.trimestre}.docx`;
    const trabajo = crearTrabajo(user.sub, nombre, (avance, aviso) => generarInforme(hechos, s.campos, graficos, redactorPg2030, avance, aviso));
    return reply.code(202).send({ id: trabajo.id });
  });

  app.get("/:id", lectores, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = obtenerTrabajo(id, req.user!.sub);
    if (!t) throw NotFound("El informe ya no está disponible. Si el servidor se reinició, vuelve a generarlo.");
    return {
      estado: t.estado,
      paso: t.paso,
      pasos: t.pasos,
      detalle: t.detalle,
      enCola: posicionEnCola(t),
      avisos: t.avisos,
      error: t.error,
      nombreArchivo: t.nombreArchivo,
    };
  });

  app.get("/:id/archivo", lectores, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const t = obtenerTrabajo(id, req.user!.sub);
    if (!t || t.estado !== "listo" || !t.archivo) throw NotFound("El informe no está listo o ya no está disponible");
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("Content-Disposition", `attachment; filename="informe.docx"; filename*=UTF-8''${encodeURIComponent(t.nombreArchivo)}`)
      .header("Cache-Control", "no-store")
      .send(t.archivo);
  });
}
