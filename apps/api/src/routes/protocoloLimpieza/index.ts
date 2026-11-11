import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { enqueueNube } from "../../jobs/boss.js";
import { BadRequest, HttpError, NotFound } from "../../lib/errors.js";
import { getStorage, StorageUploadTooLargeError } from "../../storage/index.js";
import { sendStorageFile } from "../../modules/geo/fileDelivery.js";
import { beginDurableStorageIntent } from "../../modules/shared/durableFilePersistence.js";
import { lockAndAssertActor } from "../../modules/shared/transactionalActor.js";
import { FOTO_DEMASIADO_GRANDE, guardarFoto, rutaFotoGuardada } from "../../modules/protocoloLimpieza/fotosModule.js";
import {
  cabeceraDeArchivo,
  compensarNube,
  copcDeNube,
  dirNube,
  editarNube,
  eliminarNube,
  insertarNube,
  listarNubes,
  nombreArchivoNube,
  originalDeNube,
  reintentarNube,
  rutaOriginalNube,
  validarDatosNube,
} from "../../modules/protocoloLimpieza/nubesModule.js";
import { crearRegistro, editarRegistro, listarRegistros, ROLES_PROTOCOLO_LIMPIEZA } from "../../modules/protocoloLimpieza/registrosModule.js";
import { extensionNube, MAX_FOTO_BYTES, MAX_NUBE_BYTES, type DatosNube } from "../../modules/protocoloLimpieza/reglas.js";

// The standalone app capped a report at 20 000 bytes for its fields (about
// twenty of at most 500 characters). Up to 20 resources add about 7 KB more.
const MAX_REPORTE_BYTES = 32_000;

const idParamsSchema = z.object({ id: z.string() }).strict();
const nubeParamsSchema = z.object({ id: z.string().uuid() }).strict();

const NUBE_DEMASIADO_GRANDE = `La nube de puntos supera el límite de ${MAX_NUBE_BYTES / 1024 ** 3} GB.`;
const CAMPOS_NUBE = new Set(["sitio", "fecha", "descripcion"]);

function drenar(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
    stream.resume();
  });
}

/** `attachment` with the original name; plain ASCII for old clients and RFC 5987 for the rest. */
function descarga(nombre: string): string {
  const ascii = nombre.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "_") || "nube";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

function cuerpo(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw BadRequest("Reporte inválido.");
  return body as Record<string, unknown>;
}

/**
 * Protocolo de limpieza: traceability of waste and rubble from Santa Cruz to
 * Guayaquil. Nothing is public: every route needs a session with the module,
 * and every role with it may report and edit. The standalone app's own
 * password gate (REQUIRE_LOGIN, /api/session) is gone.
 */
export async function protocoloLimpiezaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("protocolo_limpieza"));

  app.get("/registros", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { records: await listarRegistros() };
  });

  app.post("/registros", { bodyLimit: MAX_REPORTE_BYTES }, async (request, reply) => {
    const { kind, data, recursos } = cuerpo(request.body);
    const recibo = await crearRegistro(request.user!.sub, kind, data, recursos);
    request.log.info({ registroId: recibo.id, kind }, "protocolo limpieza report created");
    reply.status(201);
    return recibo;
  });

  app.put("/registros/:id", { bodyLimit: MAX_REPORTE_BYTES }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { kind, data, version, recursos } = cuerpo(request.body);
    const recibo = await editarRegistro(request.user!.sub, id, version, kind, data, recursos);
    request.log.info({ registroId: recibo.id, kind, version }, "protocolo limpieza report edited");
    return recibo;
  });

  // Multipart with one file, like every other upload in SIGTAR. The limit is
  // applied while reading, so an oversized photo is never held in memory.
  app.post("/fotos", async (request, reply) => {
    const parte = await request.file({ limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 0, parts: 1 } });
    if (!parte) throw BadRequest("Adjunta la fotografía.");
    let bytes: Buffer;
    try {
      bytes = await parte.toBuffer();
    } catch (error) {
      if ((error as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, FOTO_DEMASIADO_GRANDE);
      throw error;
    }
    const recibo = await guardarFoto(request.user!.sub, bytes);
    request.log.info({ fotoId: recibo.id, bytes: bytes.length }, "protocolo limpieza photo stored");
    reply.status(201);
    return recibo;
  });

  // ── Nubes de puntos (Visualización 3D) ────────────────────────────────────
  app.get("/nubes", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { nubes: await listarNubes() };
  });

  // Multipart: the fields sitio, fecha and descripcion, then the LAS/LAZ in
  // "archivo". The data come first, so a wrong form is refused before reading
  // gigabytes. The file is streamed to the NAS (never held in memory) inside a
  // folder reserved before the first byte: a failure or a crash leaves nothing.
  app.post("/nubes", async (request, reply) => {
    const actorId = request.user!.sub;
    const storage = getStorage();
    const id = randomUUID();
    const intento = await beginDurableStorageIntent({
      path: dirNube(id),
      reason: `protocolo-limpieza:nube:${id}`,
      isDirectory: true,
      availableAfterMs: 24 * 60 * 60_000,
      storage,
    });
    const campos: Record<string, string> = {};
    let datos: DatosNube | null = null;
    let archivo: { nombre: string; ruta: string; bytes: number } | null = null;
    let truncado = false;
    try {
      for await (const parte of request.parts({
        limits: { fileSize: MAX_NUBE_BYTES, files: 1, fields: CAMPOS_NUBE.size, parts: CAMPOS_NUBE.size + 1, fieldSize: 2_000 },
      })) {
        if (parte.type !== "file") {
          if (parte.fieldnameTruncated || parte.valueTruncated) throw BadRequest(`El campo ${parte.fieldname} supera el límite permitido.`);
          if (!CAMPOS_NUBE.has(parte.fieldname)) throw BadRequest(`Campo no permitido: ${parte.fieldname}.`);
          if (campos[parte.fieldname] !== undefined) throw BadRequest(`Campo duplicado: ${parte.fieldname}.`);
          campos[parte.fieldname] = String(parte.value);
          continue;
        }
        if (parte.fieldname !== "archivo" || archivo) {
          await drenar(parte.file);
          throw BadRequest("Sube un solo archivo .las o .laz en el campo «archivo».");
        }
        datos = validarDatosNube(campos);
        const ext = extensionNube(parte.filename ?? "");
        if (!ext) {
          await drenar(parte.file);
          throw BadRequest("Sube un archivo .las o .laz.");
        }
        const ruta = rutaOriginalNube(id, ext);
        const bytes = await storage.uploadStream(ruta, parte.file, { maxBytes: MAX_NUBE_BYTES });
        if ((parte.file as unknown as { truncated?: boolean }).truncated) truncado = true;
        archivo = { nombre: nombreArchivoNube(parte.filename), ruta, bytes };
      }
      if (truncado) throw new HttpError(413, NUBE_DEMASIADO_GRANDE);
      if (!archivo || !datos) throw BadRequest("Adjunta el archivo .las o .laz de la nube de puntos.");
      if (archivo.bytes === 0) throw BadRequest("El archivo está vacío.");
    } catch (error) {
      await intento.compensate().catch((e) => request.log.error({ err: e, nubeId: id }, "point cloud upload compensation failed"));
      const code = (error as { code?: unknown }).code;
      if (error instanceof StorageUploadTooLargeError || code === "FST_REQ_FILE_TOO_LARGE") throw new HttpError(413, NUBE_DEMASIADO_GRANDE);
      throw error;
    }

    const subido = archivo;
    const datosNube = datos;
    let nube;
    try {
      const cabecera = await cabeceraDeArchivo(storage.resolve(subido.ruta), subido.bytes);
      let actor: { id: string; name: string } | null = null;
      nube = await intento.finalize(
        (tx) => insertarNube(tx, actor!, { id, datos: datosNube, archivoNombre: subido.nombre, archivoRuta: subido.ruta, archivoBytes: subido.bytes, puntos: cabecera.puntos }),
        {
          // Lock order: authorization, then the upload intent, then the cloud's row.
          beforeIntentLock: async (tx) => {
            actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
          },
        },
      );
    } catch (error) {
      await intento.compensate().catch((e) => request.log.error({ err: e, nubeId: id }, "point cloud upload compensation failed"));
      throw error;
    }

    // A 201 means the row and its queued conversion both exist.
    let trabajo: string | null = null;
    try {
      trabajo = await enqueueNube({ id });
    } catch (error) {
      request.log.error({ err: error, nubeId: id }, "failed to enqueue point cloud conversion");
    }
    if (!trabajo) {
      await compensarNube(id).catch((e) => request.log.error({ err: e, nubeId: id }, "point cloud compensation failed"));
      throw new HttpError(503, "No se pudo poner la nube en la cola de conversión. Inténtalo de nuevo.");
    }
    request.log.info({ nubeId: id, bytes: subido.bytes, puntos: nube.puntos }, "protocolo limpieza point cloud uploaded");
    reply.status(201);
    return nube;
  });

  app.put("/nubes/:id", { bodyLimit: 4_000 }, async (request) => {
    const { id } = nubeParamsSchema.parse(request.params);
    const { version, ...datos } = cuerpo(request.body);
    const nube = await editarNube(request.user!.sub, id, version, datos);
    request.log.info({ nubeId: id, version }, "protocolo limpieza point cloud edited");
    return nube;
  });

  app.delete("/nubes/:id", { preHandler: requireRole("ADMIN") }, async (request) => {
    const { id } = nubeParamsSchema.parse(request.params);
    await eliminarNube(request.user!.sub, id);
    request.log.info({ nubeId: id }, "protocolo limpieza point cloud deleted");
    return { ok: true };
  });

  app.post("/nubes/:id/reintentar", async (request) => {
    const { id } = nubeParamsSchema.parse(request.params);
    const nube = await reintentarNube(request.user!.sub, id);
    // If the queue does not answer now, the worker's reconciliation queues it within minutes.
    await enqueueNube({ id }).catch((error) => request.log.error({ err: error, nubeId: id }, "failed to enqueue point cloud retry"));
    return nube;
  });

  // The viewer reads the COPC by HTTP ranges (its header first, then the octree nodes in
  // view). In production nginx serves the bytes and the ranges (X-Accel-Redirect).
  app.get("/nubes/:id/copc", async (request, reply) => {
    const { id } = nubeParamsSchema.parse(request.params);
    const copc = await copcDeNube(id);
    return sendStorageFile(request, reply, {
      storagePath: copc.ruta,
      contentType: "application/octet-stream",
      cacheControl: "private, max-age=86400",
      etag: `"${id}-${copc.bytes}-${copc.procesadaEn.getTime()}"`,
      ranges: true,
    });
  });

  app.get("/nubes/:id/original", async (request, reply) => {
    const { id } = nubeParamsSchema.parse(request.params);
    const original = await originalDeNube(id);
    reply.header("Content-Disposition", descarga(original.nombre));
    return sendStorageFile(request, reply, {
      storagePath: original.ruta,
      contentType: "application/octet-stream",
      cacheControl: "private, max-age=86400",
      etag: `"${id}-${original.bytes}"`,
      ranges: true,
    });
  });

  app.get("/fotos/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const path = await rutaFotoGuardada(id);
    const storage = getStorage();
    if (!path || !(await storage.exists(path))) throw NotFound("Fotografía no encontrada.");
    reply.header("Content-Type", "image/jpeg");
    reply.header("Cache-Control", "private, max-age=86400, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(await storage.stream(path));
  });
}
