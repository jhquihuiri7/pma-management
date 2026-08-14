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
  resetRasterForRetry, markRasterError, compensateRasterLayerCreation,
} from "../../modules/geo/rasterLayersModule.js";
import { enqueueRasterProcessing } from "../../jobs/boss.js";
import {
  getStorage,
  buildGeoRasterOriginalPath,
  buildGeoRasterDir,
  StorageUploadTooLargeError,
} from "../../storage/index.js";
import { BadRequest, NotFound, HttpError } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { beginDurableStorageIntent } from "../../modules/shared/durableFilePersistence.js";
import { lockAndAssertGeoEditor } from "../../modules/geo/authorization.js";
import { listWorkspaceCatalog } from "../../modules/geo/workspaceModule.js";
import {
  createVisualization,
  deleteVisualization,
  listVisualizations,
  reorderVisualizations,
  updateVisualization,
} from "../../modules/geo/visualizationsModule.js";
import { GEO_CHART_AGGREGATIONS, GEO_CHART_TYPES } from "@pma/types/geo";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000).optional(),
  categoryId: z.string().trim().min(1).max(100),
  thematic: z.string().max(200).optional(),
  layers: z.array(z.unknown()).max(1_000).optional(),
  center: z.tuple([
    z.number().finite().min(-90).max(90),
    z.number().finite().min(-180).max(180),
  ]).optional(),
  zoom: z.number().int().min(0).max(22).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
}).strict();
const updateSchema = createSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Debes enviar al menos un campo",
);

const mapParamsSchema = z.object({ id: z.string().uuid() }).strict();
const workspaceCatalogQuerySchema = z.object({
  categoryId: z.string().trim().min(1).max(100).optional(),
}).strict();
const layerParamsSchema = z.object({ id: z.string().uuid(), layerId: z.string().uuid() }).strict();
const visualizationParamsSchema = layerParamsSchema.extend({ visualizationId: z.string().uuid() });
const tileParamsSchema = layerParamsSchema.extend({
  z: z.string().regex(/^\d{1,2}$/),
  x: z.string().regex(/^\d+$/),
  // Leaflet appends ".png" to the URL template used by the web client.
  y: z.string().regex(/^\d+(?:\.png)?$/),
});

const VECTOR_MAX_FILE_BYTES = 50 * 1024 * 1024;
const VECTOR_MAX_TOTAL_BYTES = 75 * 1024 * 1024;
const RASTER_MAX_SIDECAR_BYTES = 100 * 1024 * 1024;

const bboxSchema = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(),
]).refine(([minX, minY, maxX, maxY]) => minX <= maxX && minY <= maxY, "Invalid bbox order");

const vectorFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  geometryType: z.enum(["Point", "LineString", "Polygon"]),
  crs: z.string().trim().regex(/^EPSG:\d{3,6}$/i).default("EPSG:4326"),
  sourceFormat: z.string().trim().regex(/^[a-z0-9_-]{1,32}$/i).default("geojson"),
  style: z.record(z.unknown()),
  visible: z.boolean(),
  zIndex: z.number().int().min(-10_000).max(10_000),
  bbox: bboxSchema.nullable(),
}).strict();

const rasterFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  visible: z.boolean().default(true),
  zIndex: z.number().int().min(-10_000).max(10_000).default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
}).strict();

// Reads are public so the Geoportal can be browsed without a session (see
// middleware in apps/web). For writes we distinguish two levels:
//   - geoEditor: create/edit content — any logged-in user with geo access
//     (incl. VIEWER). They can add maps, GIS layers and orthophotos and edit
//     them, but not delete.
//   - adminOnly: destructive ops (delete) stay restricted to ADMIN.
const geoEditor = [authenticate, requireApp("geo")];
const adminOnly = [authenticate, requireApp("geo"), requireRole("ADMIN")];

export async function geoRoutes(app: FastifyInstance) {
  // NOTE: no global auth hook — read routes below are intentionally public.

  app.get("/workspace/catalog", async (req) => {
    const { categoryId } = workspaceCatalogQuerySchema.parse(req.query);
    return listWorkspaceCatalog(categoryId);
  });

  app.get("/maps", async () => listMaps());

  app.get("/maps/:id", async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    return getMapById(id);
  });

  app.post("/maps", { preHandler: geoEditor }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createMap(req.user!.sub, body);
  });

  app.put("/maps/:id", { preHandler: geoEditor }, async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    return updateMap(id, req.user!.sub, body);
  });

  app.patch("/maps/:id", { preHandler: geoEditor }, async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    return updateMap(id, req.user!.sub, body);
  });

  app.delete("/maps/:id", { preHandler: adminOnly }, async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    await deleteMap(id, req.user!.sub);
    return { ok: true };
  });

  // Save the remembered viewport. Any logged-in geo user (incl. VIEWER) may call
  // this; public visitors do not persist viewport (the web app skips the call).
  app.patch("/maps/:id/viewport", { preHandler: [authenticate, requireApp("geo")] }, async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    const body = viewportSchema.parse(req.body);
    return updateMapViewport(id, req.user!.sub, body.center, body.zoom);
  });

  // ── Layers (GIS visualizer) ──────────────────────────────────────────────
  app.get("/maps/:id/layers", async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    return listLayers(id);
  });

  // Stream a layer's normalized GeoJSON from the NAS.
  app.get("/maps/:id/layers/:layerId/data", async (req, reply) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
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
  app.post("/maps/:id/layers", { preHandler: geoEditor }, async (req, reply) => {
    const { id } = mapParamsSchema.parse(req.params);
    let data: Buffer | null = null;
    let source: { data: Buffer; ext: string } | null = null;
    const fields: Record<string, string> = {};
    const allowedFields = new Set(["name", "geometryType", "crs", "featureCount", "bbox", "sourceFormat", "style", "visible", "zIndex"]);

    let uploadedBytes = 0;
    for await (const part of req.parts({
      limits: {
        fileSize: VECTOR_MAX_FILE_BYTES,
        files: 2,
        fields: allowedFields.size,
        parts: allowedFields.size + 2,
        fieldSize: 100_000,
      },
    })) {
      if (part.type === "file") {
        if (part.fieldname !== "data" && part.fieldname !== "source") {
          throw BadRequest(`Campo de archivo no permitido: ${part.fieldname}`);
        }
        if (part.fieldname === "data" && data) {
          throw BadRequest('Solo se permite un archivo "data".');
        }
        if (part.fieldname === "source" && source) {
          throw BadRequest('Solo se permite un archivo "source".');
        }
        const sourceExt = extname(part.filename || "").slice(1).toLowerCase();
        if (part.fieldname === "source" && !["zip", "shp"].includes(sourceExt)) {
          throw BadRequest('El archivo "source" debe ser .zip o .shp.');
        }
        const buf = await part.toBuffer();
        uploadedBytes += buf.byteLength;
        if (uploadedBytes > VECTOR_MAX_TOTAL_BYTES) {
          throw new HttpError(413, "Los archivos de la capa superan el límite total de 75 MB.");
        }
        if (part.fieldname === "data") {
          data = buf;
        } else {
          source = { data: buf, ext: sourceExt };
        }
      } else {
        if (part.fieldnameTruncated || part.valueTruncated) {
          throw BadRequest(`El campo multipart ${part.fieldname} supera el límite permitido.`);
        }
        if (!allowedFields.has(part.fieldname)) throw BadRequest(`Campo no permitido: ${part.fieldname}`);
        if (fields[part.fieldname] !== undefined) throw BadRequest(`Campo duplicado: ${part.fieldname}`);
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!data) throw BadRequest('file "data" (GeoJSON) is required');
    if (data.byteLength === 0) throw BadRequest('El archivo "data" está vacío.');
    const parsedFields = vectorFieldsSchema.parse({
      name: fields.name,
      geometryType: fields.geometryType,
      crs: fields.crs || "EPSG:4326",
      sourceFormat: fields.sourceFormat || (source ? "shapefile" : "geojson"),
      style: parseJsonField(fields.style, "style", {}),
      visible: parseBooleanField(fields.visible, "visible", true),
      zIndex: parseNumberField(fields.zIndex, "zIndex", 0),
      bbox: parseJsonField(fields.bbox, "bbox", null),
    });
    if (parsedFields.sourceFormat === "sample") {
      throw BadRequest("Las capas de muestra ya no están permitidas.");
    }
    if (parsedFields.crs.toUpperCase() !== "EPSG:4326") {
      throw BadRequest("El GeoJSON normalizado debe estar en EPSG:4326.");
    }
    const geojson = parseFeatureCollection(data, parsedFields.geometryType);
    if (fields.featureCount !== undefined) {
      const declaredFeatureCount = parseNumberField(fields.featureCount, "featureCount", 0);
      if (!Number.isInteger(declaredFeatureCount) || declaredFeatureCount !== geojson.featureCount) {
        throw BadRequest("featureCount no coincide con las entidades recibidas.");
      }
    }
    if (parsedFields.bbox && !sameBbox(parsedFields.bbox, geojson.bbox)) {
      throw BadRequest("El bbox declarado no coincide con las geometrías recibidas.");
    }

    const layer = await createLayer(id, req.user!.sub, {
      name: parsedFields.name,
      geometryType: parsedFields.geometryType,
      crs: parsedFields.crs.toUpperCase(),
      featureCount: geojson.featureCount,
      bbox: geojson.bbox,
      sourceFormat: parsedFields.sourceFormat,
      data,
      source,
      style: parsedFields.style,
      visible: parsedFields.visible,
      zIndex: parsedFields.zIndex,
    });
    reply.status(201);
    return { ...layer, persisted: true };
  });

  app.patch("/maps/:id/layers/:layerId", { preHandler: geoEditor }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    const body = updateLayerSchema.parse(req.body);
    return updateLayer(id, layerId, req.user!.sub, body);
  });

  // ── Layer visualizations ────────────────────────────────────────────────
  app.get("/maps/:id/layers/:layerId/visualizations", async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    return listVisualizations(id, layerId);
  });

  app.post("/maps/:id/layers/:layerId/visualizations", { preHandler: geoEditor }, async (req, reply) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    const body = visualizationCreateSchema.parse(req.body);
    reply.status(201);
    return createVisualization(id, layerId, req.user!.sub, body);
  });

  app.put("/maps/:id/layers/:layerId/visualizations/order", { preHandler: geoEditor }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    const { ids } = visualizationOrderSchema.parse(req.body);
    return reorderVisualizations(id, layerId, req.user!.sub, ids);
  });

  app.patch("/maps/:id/layers/:layerId/visualizations/:visualizationId", { preHandler: geoEditor }, async (req) => {
    const { id, layerId, visualizationId } = visualizationParamsSchema.parse(req.params);
    const body = visualizationUpdateSchema.parse(req.body);
    return updateVisualization(id, layerId, visualizationId, req.user!.sub, body);
  });

  app.delete("/maps/:id/layers/:layerId/visualizations/:visualizationId", { preHandler: geoEditor }, async (req) => {
    const { id, layerId, visualizationId } = visualizationParamsSchema.parse(req.params);
    await deleteVisualization(id, layerId, visualizationId, req.user!.sub);
    return { ok: true };
  });

  app.delete("/maps/:id/layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    await deleteLayer(id, layerId, req.user!.sub);
    return { ok: true };
  });

  // ── Raster layers (orthophotos) ──────────────────────────────────────────
  // Public read (geoportal is browsable without a session); mutations are ADMIN.
  app.get("/maps/:id/raster-layers", async (req) => {
    const { id } = mapParamsSchema.parse(req.params);
    return listRasterLayers(id);
  });

  // Public XYZ tile proxy. Resolves layerId → cog_path, then fetches the tile
  // from the INTERNAL TiTiler, injecting the COG path server-side. The browser
  // never sees TiTiler or the NAS path. `:y` absorbs the ".png" suffix (parseInt
  // strips it), so no fragile route-suffix matching is needed.
  app.get("/maps/:id/raster-layers/:layerId/tiles/:z/:x/:y", async (req, reply) => {
    const { id, layerId, z: zRaw, x, y } = tileParamsSchema.parse(req.params);
    const Z = parseInt(zRaw, 10), X = parseInt(x, 10), Y = parseInt(y, 10);
    const tileLimit = 2 ** Z;
    if (Z > 22 || X >= tileLimit || Y >= tileLimit) throw BadRequest("Invalid tile coordinates");

    const cogPath = await getProcessedCogPath(id, layerId);
    const fileUrl = `${env.TITILER_DATA_ROOT.replace(/\/+$/, "")}/${cogPath.replace(/^\/+/, "")}`;
    const titilerUrl =
      `${env.TITILER_INTERNAL_URL.replace(/\/+$/, "")}/cog/tiles/WebMercatorQuad/${Z}/${X}/${Y}.png` +
      `?url=${encodeURIComponent(fileUrl)}`;

    let resp: globalThis.Response;
    try {
      resp = await fetch(titilerUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new HttpError(504, "Tile service timed out");
      }
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

  // Upload an orthophoto. Multipart: one main file — a ".tif/.tiff" or a ".zip"
  // containing one (required) — plus optional loose sidecars
  // (.tfw/.wld/.prj/.ovr/.cpg/.xml) and text fields (name, visible, zIndex,
  // opacity). The file is streamed straight to the NAS — never buffered in
  // memory — and a worker (Phase 4/5) turns it into a COG (reading inside the zip
  // via GDAL's /vsizip/ when needed).
  app.post("/maps/:id/raster-layers", { preHandler: geoEditor }, async (req, reply) => {
    const { id } = mapParamsSchema.parse(req.params);
    // Validate the map exists before streaming gigabytes to the NAS.
    await getMapById(id);

    const storage = getStorage();
    const rasterLayerId = randomUUID();
    const rasterDirectory = buildGeoRasterDir(id, rasterLayerId);
    // A raster consists of a main file plus optional sidecars and is streamed,
    // so reserve its UUID-owned directory before receiving any bytes. The
    // worker can recover it after a process crash instead of leaving an
    // untracked NAS directory.
    const rasterIntent = await beginDurableStorageIntent({
      path: rasterDirectory,
      reason: `geo:raster:${rasterLayerId}`,
      isDirectory: true,
      availableAfterMs: 24 * 60 * 60_000,
      storage,
    });
    const fields: Record<string, string> = {};
    const auxFiles: string[] = [];
    let mainFilename: string | null = null;
    let mainPath: string | null = null;
    let mainSize = 0;
    let truncated = false;
    let extraMain = false;
    let rejected: string | null = null;
    let duplicateFile: string | null = null;
    let sidecarBytes = 0;
    const uploadedPaths = new Set<string>();
    const rasterAllowedFields = new Set(["name", "visible", "zIndex", "opacity"]);

    const cleanup = () => rasterIntent.compensate();

    try {
      for await (const part of req.parts({
        limits: {
          fileSize: env.RASTER_MAX_UPLOAD_BYTES,
          files: 21,
          fields: rasterAllowedFields.size,
          parts: 21 + rasterAllowedFields.size,
          fieldSize: 10_000,
        },
      })) {
        if (part.type !== "file") {
          if (part.fieldnameTruncated || part.valueTruncated) {
            throw BadRequest(`El campo multipart ${part.fieldname} supera el límite permitido.`);
          }
          if (!rasterAllowedFields.has(part.fieldname)) throw BadRequest(`Campo no permitido: ${part.fieldname}`);
          if (fields[part.fieldname] !== undefined) throw BadRequest(`Campo duplicado: ${part.fieldname}`);
          fields[part.fieldname] = String(part.value);
          continue;
        }
        if (part.fieldname !== "file") {
          rejected = part.filename || part.fieldname;
          await drain(part.file);
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
          if (uploadedPaths.has(mainPath)) { duplicateFile = part.filename!; await drain(part.file); continue; }
          uploadedPaths.add(mainPath);
          mainSize = await storage.uploadStream(mainPath, part.file, { maxBytes: env.RASTER_MAX_UPLOAD_BYTES });
        } else {
          if (auxFiles.length >= 20) {
            throw new HttpError(413, "Solo se permiten 20 archivos auxiliares por capa ráster.");
          }
          const sidecarPath = buildGeoRasterOriginalPath(id, rasterLayerId, part.filename!);
          if (uploadedPaths.has(sidecarPath)) { duplicateFile = part.filename!; await drain(part.file); continue; }
          uploadedPaths.add(sidecarPath);
          const remainingSidecarBytes = RASTER_MAX_SIDECAR_BYTES - sidecarBytes;
          sidecarBytes += await storage.uploadStream(sidecarPath, part.file, {
            maxBytes: remainingSidecarBytes,
          });
          auxFiles.push(part.filename!);
          if (sidecarBytes > RASTER_MAX_SIDECAR_BYTES) {
            throw new HttpError(413, "Los archivos auxiliares superan el límite permitido.");
          }
        }
        if ((part.file as unknown as { truncated?: boolean }).truncated) truncated = true;
      }
    } catch (err) {
      // Includes @fastify/multipart's RequestFileTooLargeError (>limit).
      await throwAfterCleanup(
        cleanup,
        err instanceof StorageUploadTooLargeError
          ? new HttpError(413, "Los archivos de la capa superan el límite permitido.")
          : err,
      );
    }

    if (truncated) {
      await throwAfterCleanup(cleanup, new HttpError(413, `El archivo supera el límite de ${env.RASTER_MAX_UPLOAD_BYTES} bytes.`));
    }
    if (rejected) {
      await throwAfterCleanup(cleanup, BadRequest(`Extensión no permitida: ${rejected}. Solo .tif/.tiff o un .zip que lo contenga (+ sidecars .tfw/.wld/.prj/.ovr/.cpg/.xml).`));
    }
    if (extraMain) {
      await throwAfterCleanup(cleanup, BadRequest("Solo se permite un archivo .tif/.tiff o .zip por capa ráster."));
    }
    if (duplicateFile) {
      await throwAfterCleanup(cleanup, BadRequest(`Archivo duplicado: ${duplicateFile}.`));
    }
    if (auxFiles.length > 20 || sidecarBytes > RASTER_MAX_SIDECAR_BYTES) {
      await throwAfterCleanup(cleanup, new HttpError(413, "Los archivos auxiliares superan el límite permitido."));
    }
    if (!mainPath || !mainFilename) {
      return await throwAfterCleanup(cleanup, BadRequest('Falta el archivo .tif/.tiff o .zip (campo "file").'));
    }
    if (mainSize === 0) {
      await throwAfterCleanup(cleanup, BadRequest("El archivo ráster está vacío."));
    }

    // MIME hardening: the extension can lie, so confirm the magic bytes match the
    // declared kind before registering the layer. For a .zip the worker's unzip +
    // gdalinfo is the deeper check; for a .tif gdalinfo is.
    const isZip = /\.zip$/i.test(mainFilename);
    const absMain = getStorage().resolve(mainPath);
    const validBytes = isZip ? await isZipFile(absMain) : await isTiffFile(absMain);
    if (!validBytes) {
      await throwAfterCleanup(cleanup, BadRequest(isZip ? "El archivo no es un ZIP válido (.zip)." : "El archivo no es un TIFF válido (.tif/.tiff)."));
    }

    const fileType = isZip ? "zip" : (/\.(tiff?)$/i.exec(mainFilename)?.[1] ?? "tif").toLowerCase();
    const parsedFields = await parseRasterFieldsOrCleanup(fields, mainFilename, cleanup);

    let layer: Awaited<ReturnType<typeof createRasterLayer>> | null = null;
    try {
      layer = await rasterIntent.finalize((tx) => createRasterLayer(id, req.user!.sub, {
          id: rasterLayerId,
          name: parsedFields.name ?? mainFilename,
          originalFilename: mainFilename,
          originalPath: mainPath,
          sizeBytes: mainSize,
          fileType,
          auxFiles: auxFiles.length ? auxFiles : null,
          visible: parsedFields.visible,
          zIndex: parsedFields.zIndex,
          opacity: parsedFields.opacity,
        }, tx), {
          // Lock order is authorization -> upload intent -> map/raster rows.
          // Revocation during a multi-GB stream therefore rolls back the row
          // and the caller compensates the entire UUID-owned directory.
          beforeIntentLock: (tx) => lockAndAssertGeoEditor(tx, req.user!.sub).then(() => undefined),
        });

      // A 201 means both the catalog row and a durable pg-boss job exist. If the
      // queue cannot confirm an id, compensate row + storage and return failure.
      const operationId = await enqueueRasterProcessing({ mapId: id, rasterLayerId: layer.id });
      if (!operationId) throw new HttpError(503, "No se pudo confirmar la cola de procesamiento.");

      reply.status(201);
      return { ...layer, persisted: true, operationId };
    } catch (err) {
      if (layer) {
        try {
          await compensateRasterLayerCreation(id, rasterLayerId);
        } catch (cleanupError) {
          throw new AggregateError([err, cleanupError], "Raster persistence and cleanup both failed");
        }
      } else {
        await throwAfterCleanup(cleanup, err);
      }
      if (err instanceof HttpError) throw err;
      req.log.error({ err }, "failed to enqueue raster processing");
      throw new HttpError(503, "No se pudo confirmar la cola de procesamiento.");
    }
  });

  app.patch("/maps/:id/raster-layers/:layerId", { preHandler: geoEditor }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    const body = updateRasterSchema.parse(req.body);
    return updateRasterLayer(id, layerId, req.user!.sub, body);
  });

  app.delete("/maps/:id/raster-layers/:layerId", { preHandler: adminOnly }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    await deleteRasterLayer(id, layerId, req.user!.sub);
    return { ok: true };
  });

  // Re-process a failed raster layer. The module atomically admits one retry.
  app.post("/maps/:id/raster-layers/:layerId/retry", { preHandler: geoEditor }, async (req) => {
    const { id, layerId } = layerParamsSchema.parse(req.params);
    const layer = await resetRasterForRetry(id, layerId, req.user!.sub);
    try {
      const operationId = await enqueueRasterProcessing({ mapId: id, rasterLayerId: layerId });
      if (!operationId) throw new Error("pg-boss did not return a job id");
      return { ...layer, persisted: true, operationId };
    } catch (err) {
      req.log.error({ err }, "failed to re-enqueue raster processing");
      await markRasterError(id, layerId, "No se pudo encolar el reprocesamiento.");
      throw new HttpError(503, "No se pudo confirmar la cola de reprocesamiento.");
    }
  });
}

const viewportSchema = z.object({
  center: z.tuple([
    z.number().finite().min(-90).max(90),
    z.number().finite().min(-180).max(180),
  ]),
  zoom: z.number().int().min(0).max(22),
}).strict();

const updateLayerSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  style: z.record(z.unknown()).optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().int().min(-10_000).max(10_000).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

const visualizationBindingSchema = z.object({
  role: z.enum(["dimension", "measure", "series", "x", "y", "size", "level", "weight", "value"]),
  field: z.string().trim().min(1).max(200),
  aggregation: z.enum(GEO_CHART_AGGREGATIONS).optional(),
  dateGrain: z.enum(["year", "quarter", "month", "day"]).optional(),
}).strict();

const visualizationOptionsSchema = z.object({
  palette: z.string().trim().min(1).max(50).optional(),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  sort: z.enum(["none", "asc", "desc"]).optional(),
  topN: z.number().int().min(1).max(100).optional(),
  includeNulls: z.boolean().optional(),
  showLegend: z.boolean().optional(),
  showLabels: z.boolean().optional(),
  bins: z.number().int().min(3).max(30).optional(),
}).strict();

const visualizationBaseSchema = z.object({
  type: z.enum(GEO_CHART_TYPES),
  title: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).max(10_000),
  bindings: z.array(visualizationBindingSchema).max(10),
  options: visualizationOptionsSchema,
  version: z.literal(1),
}).strict().superRefine((value, ctx) => {
  const count = (role: string) => value.bindings.filter((binding) => binding.role === role).length;
  const allowedRoles: Record<(typeof GEO_CHART_TYPES)[number], string[]> = {
    kpi: ["value"], bar: ["dimension", "measure"], stackedBar: ["dimension", "series", "measure"],
    line: ["dimension", "measure", "series"], area: ["dimension", "measure"], donut: ["dimension", "measure"],
    histogram: ["value"], scatter: ["x", "y", "size", "series"], sankey: ["level", "weight"], table: ["dimension", "measure"],
  };
  value.bindings.forEach((binding, index) => {
    if (!allowedRoles[value.type].includes(binding.role)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings", index, "role"], message: `El rol ${binding.role} no corresponde a ${value.type}` });
  });
  const exact = (role: string, expected: number) => {
    if (count(role) !== expected) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: `${value.type} requiere ${expected} campo(s) ${role}` });
  };
  if (value.type === "kpi" || value.type === "histogram") exact("value", 1);
  if (["bar", "line", "area", "donut"].includes(value.type)) exact("dimension", 1);
  if (value.type === "stackedBar") { exact("dimension", 1); exact("series", 1); }
  if (value.type === "scatter") { exact("x", 1); exact("y", 1); }
  if (["bar", "stackedBar", "line", "area", "donut"].includes(value.type) && count("measure") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Solo se admite una medida" });
  if (value.type === "line" && count("series") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Solo se admite una serie" });
  if (value.type === "scatter" && (count("size") > 1 || count("series") > 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Dispersión admite un tamaño y un color" });
  if (value.type === "sankey" && (count("level") < 2 || count("level") > 5)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Sankey requiere entre 2 y 5 niveles" });
  }
  if (value.type === "table" && (count("dimension") < 1 || count("dimension") > 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "La tabla requiere entre 1 y 3 dimensiones" });
  }
  if (value.type === "table" && count("measure") > 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "La tabla admite máximo 3 medidas" });
  if (value.type === "sankey" && count("weight") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Sankey admite un solo peso" });
});

const visualizationCreateSchema = visualizationBaseSchema;
// Updates replace the complete recipe so cross-field validation cannot be
// bypassed with a partial patch that leaves an invalid role/type combination.
const visualizationUpdateSchema = visualizationBaseSchema;
const visualizationOrderSchema = z.object({ ids: z.array(z.string().uuid()).max(20) }).strict();

const updateRasterSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  zIndex: z.number().int().min(-10_000).max(10_000).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

function parseJsonField<T>(value: string | undefined, field: string, fallback: T): unknown {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw BadRequest(`El campo ${field} no contiene JSON válido.`);
  }
}

function parseBooleanField(value: string | undefined, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw BadRequest(`El campo ${field} debe ser true o false.`);
}

function parseNumberField(value: string | undefined, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (value.trim() === "") throw BadRequest(`El campo ${field} debe ser numérico.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw BadRequest(`El campo ${field} debe ser numérico.`);
  return parsed;
}

async function parseRasterFieldsOrCleanup(
  fields: Record<string, string>,
  mainFilename: string,
  cleanup: () => Promise<void>,
): Promise<z.infer<typeof rasterFieldsSchema>> {
  try {
    return rasterFieldsSchema.parse({
      name: fields.name?.trim() || mainFilename.replace(/\.(tiff?|zip)$/i, ""),
      visible: parseBooleanField(fields.visible, "visible", true),
      zIndex: parseNumberField(fields.zIndex, "zIndex", 0),
      opacity: parseNumberField(fields.opacity, "opacity", 1),
    });
  } catch (error) {
    return throwAfterCleanup(cleanup, error);
  }
}

function parseFeatureCollection(data: Buffer, declaredType: "Point" | "LineString" | "Polygon") {
  if (data.byteLength > VECTOR_MAX_FILE_BYTES) {
    throw new HttpError(413, "El GeoJSON normalizado supera el límite de 50 MB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8")) as unknown;
  } catch {
    throw BadRequest("El archivo data no contiene JSON válido.");
  }
  if (!isRecord(parsed) || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw BadRequest("data debe ser un GeoJSON FeatureCollection.");
  }
  if (parsed.features.length === 0) throw BadRequest("El GeoJSON no contiene geometrías.");
  if (parsed.features.length > 500_000) throw new HttpError(413, "El GeoJSON contiene demasiadas entidades.");

  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  let coordinateCount = 0;
  const allowed = new Set([declaredType, `Multi${declaredType}`]);

  const visit = (value: unknown, depth: number): void => {
    if (depth > 16 || !Array.isArray(value)) throw BadRequest("Coordenadas GeoJSON inválidas.");
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const x = value[0], y = value[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw BadRequest("El GeoJSON contiene coordenadas no finitas.");
      bbox[0] = Math.min(bbox[0], x);
      bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x);
      bbox[3] = Math.max(bbox[3], y);
      coordinateCount += 1;
      return;
    }
    if (value.length === 0) throw BadRequest("El GeoJSON contiene coordenadas vacías.");
    for (const child of value) visit(child, depth + 1);
  };

  for (const feature of parsed.features) {
    if (!isRecord(feature) || feature.type !== "Feature" || !isRecord(feature.geometry)) {
      throw BadRequest("El GeoJSON contiene una entidad inválida o sin geometría.");
    }
    const geometryType = feature.geometry.type;
    if (typeof geometryType !== "string" || !allowed.has(geometryType)) {
      throw BadRequest(`La geometría ${String(geometryType)} no coincide con ${declaredType}.`);
    }
    visit(feature.geometry.coordinates, 0);
  }
  if (coordinateCount === 0) throw BadRequest("El GeoJSON no contiene coordenadas.");

  return { featureCount: parsed.features.length, bbox };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameBbox(a: readonly number[], b: readonly number[]): boolean {
  return a.length === 4 && b.length === 4 && a.every((value, index) => Math.abs(value - b[index]) < 1e-8);
}

async function throwAfterCleanup(cleanup: () => Promise<void>, error: unknown): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], "Persistence failed and cleanup could not be confirmed");
  }
  throw error;
}

// Classify an uploaded raster part by extension. `.aux.xml` ends in `.xml` and
// `.tif.ovr` in `.ovr`, so both are covered by the sidecar suffixes below.
function classifyRasterFile(filename: string): "main" | "sidecar" | null {
  const f = filename.toLowerCase();
  // A .tif is the orthophoto itself; a .zip is an archive holding the .tif (+ its
  // sidecars) — the worker reads it via GDAL's /vsizip/ virtual filesystem.
  if (/\.(tiff?|zip)$/.test(f)) return "main";
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

// ZIP magic numbers: "PK\x03\x04" (local file header) or "PK\x05\x06" (empty
// archive — End Of Central Directory with no entries).
async function isZipFile(absPath: string): Promise<boolean> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(absPath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    return buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05) && (buf[3] === 0x04 || buf[3] === 0x06);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  } finally {
    await fh?.close();
  }
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  } finally {
    await fh?.close();
  }
}
