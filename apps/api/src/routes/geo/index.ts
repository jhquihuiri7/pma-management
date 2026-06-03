import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import {
  createMap, listMaps, getMapById, updateMap, updateMapViewport, deleteMap,
} from "../../modules/geo/mapsModule.js";
import {
  listLayers, createLayer, updateLayer, deleteLayer, getLayerDataPath,
} from "../../modules/geo/layersModule.js";
import { open } from "node:fs/promises";
import {
  listRasterLayers, createRasterLayer, updateRasterLayer, deleteRasterLayer, getProcessedCogPath,
  resetRasterForRetry,
} from "../../modules/geo/rasterLayersModule.js";
import { enqueueRasterProcessing } from "../../jobs/boss.js";
import { getStorage, buildGeoRasterOriginalPath, buildGeoRasterDir } from "../../storage/index.js";
import { BadRequest, NotFound, HttpError } from "../../lib/errors.js";
import { env } from "../../lib/env.js";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  layers: z.array(z.unknown()).optional(),
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().int().min(0).max(22).optional(),
  tags: z.array(z.string()).optional(),
});
const updateSchema = createSchema.partial();

// Mutations require a logged-in ADMIN with geo access. Reads are public so the
// Geoportal can be browsed without a session (see middleware in apps/web).
const adminOnly = [authenticate, requireApp("geo"), requireRole("ADMIN")];

export async function geoRoutes(app: FastifyInstance) {
  // NOTE: no global auth hook — read routes below are intentionally public.

  app.get("/maps", async () => listMaps());

  app.get("/maps/:id", async (req) => {
    const { id } = req.params as { id: string };
    return getMapById(id);
  });

  app.post("/maps", { preHandler: adminOnly }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createMap(req.user!.adminId, req.user!.sub, body);
  });

  app.put("/maps/:id", { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return updateMap(id, req.user!.adminId, body);
  });

  app.delete("/maps/:id", { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteMap(id, req.user!.adminId);
    return { ok: true };
  });

  // Save the remembered viewport. Any logged-in geo user (incl. VIEWER) may call
  // this; public visitors do not persist viewport (the web app skips the call).
  app.patch("/maps/:id/viewport", { preHandler: [authenticate, requireApp("geo")] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = viewportSchema.parse(req.body);
    return updateMapViewport(id, body.center, body.zoom);
  });

  // ── Layers (GIS visualizer) ──────────────────────────────────────────────
  app.get("/maps/:id/layers", async (req) => {
    const { id } = req.params as { id: string };
    return listLayers(id);
  });

  // Stream a layer's normalized GeoJSON from the NAS.
  app.get("/maps/:id/layers/:layerId/data", async (req, reply) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    const path = await getLayerDataPath(id, layerId);
    const storage = getStorage();
    if (!(await storage.exists(path))) throw NotFound("Layer data not found");
    // Bytes are gzip on disk; the browser transparently inflates. Layer data is
    // immutable per layer id, so it can be cached aggressively.
    reply.header("Content-Type", "application/geo+json");
    reply.header("Content-Encoding", "gzip");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(await storage.stream(path));
  });

  // Create a layer. Multipart: file "data" (GeoJSON, required),
  // file "source" (original .zip/.shp, optional), plus text fields.
  app.post("/maps/:id/layers", { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    let data: Buffer | null = null;
    let source: { data: Buffer; ext: string } | null = null;
    const fields: Record<string, string> = {};

    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        if (part.fieldname === "data") data = buf;
        else if (part.fieldname === "source") {
          source = { data: buf, ext: extname(part.filename || "").replace(".", "") || "bin" };
        }
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!data) throw BadRequest('file "data" (GeoJSON) is required');
    if (!fields.name || !fields.geometryType) throw BadRequest("name and geometryType are required");

    const parseJson = <T,>(v: string | undefined, fallback: T): T => {
      if (!v) return fallback;
      try { return JSON.parse(v) as T; } catch { return fallback; }
    };

    const sourceFormat = fields.sourceFormat || (source ? "shapefile" : "geojson");
    if (sourceFormat === "sample") {
      throw BadRequest("Las capas de muestra ya no están permitidas.");
    }

    const layer = await createLayer(id, req.user!.sub, {
      name: fields.name,
      geometryType: fields.geometryType,
      crs: fields.crs || "EPSG:4326",
      featureCount: fields.featureCount ? parseInt(fields.featureCount, 10) : 0,
      bbox: parseJson<number[] | null>(fields.bbox, null),
      sourceFormat,
      data,
      source,
      style: parseJson<unknown>(fields.style, {}),
      visible: fields.visible ? fields.visible === "true" : true,
      zIndex: fields.zIndex ? parseInt(fields.zIndex, 10) : 0,
    });
    reply.status(201);
    return layer;
  });

  app.patch("/maps/:id/layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    const body = updateLayerSchema.parse(req.body);
    return updateLayer(id, layerId, body);
  });

  app.delete("/maps/:id/layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    await deleteLayer(id, layerId);
    return { ok: true };
  });

  // ── Raster layers (orthophotos) ──────────────────────────────────────────
  // Public read (geoportal is browsable without a session); mutations are ADMIN.
  app.get("/maps/:id/raster-layers", async (req) => {
    const { id } = req.params as { id: string };
    return listRasterLayers(id);
  });

  // Public XYZ tile proxy. Resolves layerId → cog_path, then fetches the tile
  // from the INTERNAL TiTiler, injecting the COG path server-side. The browser
  // never sees TiTiler or the NAS path. `:y` absorbs the ".png" suffix (parseInt
  // strips it), so no fragile route-suffix matching is needed.
  app.get("/maps/:id/raster-layers/:layerId/tiles/:z/:x/:y", async (req, reply) => {
    const { id, layerId, z, x, y } = req.params as {
      id: string; layerId: string; z: string; x: string; y: string;
    };
    const Z = parseInt(z, 10), X = parseInt(x, 10), Y = parseInt(y, 10);
    if (![Z, X, Y].every((n) => Number.isInteger(n))) throw BadRequest("Invalid tile coordinates");

    const cogPath = await getProcessedCogPath(id, layerId);
    const fileUrl = `${env.TITILER_DATA_ROOT.replace(/\/+$/, "")}/${cogPath.replace(/^\/+/, "")}`;
    const titilerUrl =
      `${env.TITILER_INTERNAL_URL.replace(/\/+$/, "")}/cog/tiles/WebMercatorQuad/${Z}/${X}/${Y}.png` +
      `?url=${encodeURIComponent(fileUrl)}`;

    let resp: globalThis.Response;
    try {
      resp = await fetch(titilerUrl);
    } catch {
      throw new HttpError(502, "Tile service unavailable");
    }
    // Tiles outside the raster's coverage are a normal 404 — pass through so
    // Leaflet just shows nothing there (and don't cache the miss).
    if (resp.status === 404) {
      reply.status(404);
      return reply.send();
    }
    if (!resp.ok) throw new HttpError(502, `Tile service error ${resp.status}`);

    const body = Buffer.from(await resp.arrayBuffer());
    reply.header("Content-Type", resp.headers.get("content-type") ?? "image/png");
    // The COG is immutable per layer id, so tiles can be cached hard.
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(body);
  });

  // Upload an orthophoto. Multipart: one file ".tif/.tiff" (required) plus
  // optional sidecars (.tfw/.wld/.prj/.ovr/.cpg/.xml) and text fields (name,
  // visible, zIndex, opacity). The .tif is streamed straight to the NAS — never
  // buffered in memory — and a worker (Phase 4/5) turns it into a COG.
  app.post("/maps/:id/raster-layers", { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Validate the map exists before streaming gigabytes to the NAS.
    await getMapById(id);

    const storage = getStorage();
    const rasterLayerId = randomUUID();
    const fields: Record<string, string> = {};
    const auxFiles: string[] = [];
    let mainFilename: string | null = null;
    let mainPath: string | null = null;
    let mainSize = 0;
    let truncated = false;
    let extraMain = false;
    let rejected: string | null = null;

    const cleanup = () => storage.deleteDir(buildGeoRasterDir(id, rasterLayerId)).catch(() => {});

    try {
      for await (const part of req.parts({ limits: { fileSize: env.RASTER_MAX_UPLOAD_BYTES } })) {
        if (part.type !== "file") {
          fields[part.fieldname] = String(part.value);
          continue;
        }
        const kind = classifyRasterFile(part.filename || "");
        if (kind === null) {
          rejected = part.filename || "(sin nombre)";
          await drain(part.file);
          continue;
        }
        if (kind === "main") {
          if (mainFilename) { extraMain = true; await drain(part.file); continue; }
          mainFilename = part.filename!;
          mainPath = buildGeoRasterOriginalPath(id, rasterLayerId, mainFilename);
          mainSize = await storage.uploadStream(mainPath, part.file);
        } else {
          const sidecarPath = buildGeoRasterOriginalPath(id, rasterLayerId, part.filename!);
          await storage.uploadStream(sidecarPath, part.file);
          auxFiles.push(part.filename!);
        }
        if ((part.file as unknown as { truncated?: boolean }).truncated) truncated = true;
      }
    } catch (err) {
      // Includes @fastify/multipart's RequestFileTooLargeError (>limit).
      await cleanup();
      throw err;
    }

    if (truncated) {
      await cleanup();
      throw new HttpError(413, `El archivo supera el límite de ${env.RASTER_MAX_UPLOAD_BYTES} bytes.`);
    }
    if (rejected) {
      await cleanup();
      throw BadRequest(`Extensión no permitida: ${rejected}. Solo .tif/.tiff (+ sidecars .tfw/.wld/.prj/.ovr/.cpg/.xml).`);
    }
    if (extraMain) {
      await cleanup();
      throw BadRequest("Solo se permite un archivo .tif/.tiff por capa ráster.");
    }
    if (!mainPath || !mainFilename) {
      await cleanup();
      throw BadRequest('Falta el archivo .tif/.tiff (campo "file").');
    }

    // MIME hardening: the extension can lie, so confirm the bytes are a TIFF
    // before registering the layer. (gdalinfo in the worker is the deeper check.)
    if (!(await isTiffFile(getStorage().resolve(mainPath)))) {
      await cleanup();
      throw BadRequest("El archivo no es un TIFF válido (.tif/.tiff).");
    }

    const fileType = (/\.(tiff?)$/i.exec(mainFilename)?.[1] ?? "tif").toLowerCase();
    const name = (fields.name || "").trim() || mainFilename.replace(/\.(tiff?)$/i, "");

    try {
      const layer = await createRasterLayer(id, req.user!.sub, {
        id: rasterLayerId,
        name,
        originalFilename: mainFilename,
        originalPath: mainPath,
        sizeBytes: mainSize,
        fileType,
        auxFiles: auxFiles.length ? auxFiles : null,
        visible: fields.visible ? fields.visible === "true" : true,
        zIndex: fields.zIndex ? parseInt(fields.zIndex, 10) : 0,
        opacity: fields.opacity ? Number(fields.opacity) : 1,
      });

      // Enqueue COG processing. Best-effort: the upload already succeeded, so an
      // enqueue failure must not fail the request — it leaves the layer at
      // 'uploaded' to be retried later (Phase 8) rather than losing the file.
      try {
        await enqueueRasterProcessing({ mapId: id, rasterLayerId: layer.id });
      } catch (err) {
        req.log.error({ err }, "failed to enqueue raster processing");
      }

      reply.status(201);
      return layer;
    } catch (err) {
      // Roll back the NAS files if the DB insert fails (no orphan upload).
      await cleanup();
      throw err;
    }
  });

  app.patch("/maps/:id/raster-layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    const body = updateRasterSchema.parse(req.body);
    return updateRasterLayer(id, layerId, body);
  });

  app.delete("/maps/:id/raster-layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    await deleteRasterLayer(id, layerId);
    return { ok: true };
  });

  // Re-process a failed/stuck raster layer.
  app.post("/maps/:id/raster-layers/:layerId/retry", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    const layer = await resetRasterForRetry(id, layerId);
    try {
      await enqueueRasterProcessing({ mapId: id, rasterLayerId: layerId });
    } catch (err) {
      req.log.error({ err }, "failed to re-enqueue raster processing");
    }
    return layer;
  });
}

const viewportSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().int().min(0).max(22),
});

const updateLayerSchema = z.object({
  name: z.string().min(1).optional(),
  style: z.unknown().optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().int().optional(),
});

const updateRasterSchema = z.object({
  name: z.string().min(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().int().optional(),
});

// Classify an uploaded raster part by extension. `.aux.xml` ends in `.xml` and
// `.tif.ovr` in `.ovr`, so both are covered by the sidecar suffixes below.
function classifyRasterFile(filename: string): "main" | "sidecar" | null {
  const f = filename.toLowerCase();
  if (/\.tiff?$/.test(f)) return "main";
  if (/\.(tfw|wld|prj|ovr|cpg|tab|xml)$/.test(f)) return "sidecar";
  return null;
}

// Fully consume (and discard) a multipart file stream. @fastify/multipart's
// async iterator only advances once the current part's stream is drained, so an
// unwanted part must be drained rather than ignored.
function drain(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
    stream.resume();
  });
}

// TIFF magic numbers: "II*\0" / "MM\0*" (classic) and the 43-variant (BigTIFF).
async function isTiffFile(absPath: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(absPath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    const littleEndian = buf[0] === 0x49 && buf[1] === 0x49 && (buf[2] === 0x2a || buf[2] === 0x2b) && buf[3] === 0x00;
    const bigEndian = buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && (buf[3] === 0x2a || buf[3] === 0x2b);
    return littleEndian || bigEndian;
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}
