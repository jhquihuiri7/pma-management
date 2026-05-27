import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extname } from "node:path";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import {
  createMap, listMaps, getMapById, updateMap, updateMapViewport, deleteMap,
} from "../../modules/geo/mapsModule.js";
import {
  listLayers, createLayer, updateLayer, deleteLayer, getLayerDataPath,
} from "../../modules/geo/layersModule.js";
import { getStorage } from "../../storage/index.js";
import { BadRequest, NotFound } from "../../lib/errors.js";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  arcgisUrl: z.string().optional(),
  layers: z.array(z.unknown()).optional(),
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().int().min(0).max(22).optional(),
  tags: z.array(z.string()).optional(),
});
const updateSchema = createSchema.partial();

export async function geoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("geo"));

  app.get("/maps", async (req) => listMaps(req.user!.adminId));

  app.get("/maps/:id", async (req) => {
    const { id } = req.params as { id: string };
    return getMapById(id, req.user!.adminId);
  });

  app.post("/maps", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createMap(req.user!.adminId, req.user!.sub, body);
  });

  app.put("/maps/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return updateMap(id, req.user!.adminId, body);
  });

  app.delete("/maps/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteMap(id, req.user!.adminId);
    return { ok: true };
  });

  // Save the remembered viewport. Any geo user (incl. VIEWER) may call this.
  app.patch("/maps/:id/viewport", async (req) => {
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
  app.post("/maps/:id/layers", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
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

    const layer = await createLayer(id, req.user!.sub, {
      name: fields.name,
      geometryType: fields.geometryType,
      crs: fields.crs || "EPSG:4326",
      featureCount: fields.featureCount ? parseInt(fields.featureCount, 10) : 0,
      bbox: parseJson<number[] | null>(fields.bbox, null),
      sourceFormat: fields.sourceFormat || (source ? "shapefile" : "geojson"),
      data,
      source,
      style: parseJson<unknown>(fields.style, {}),
      visible: fields.visible ? fields.visible === "true" : true,
      zIndex: fields.zIndex ? parseInt(fields.zIndex, 10) : 0,
    });
    reply.status(201);
    return layer;
  });

  app.patch("/maps/:id/layers/:layerId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    const body = updateLayerSchema.parse(req.body);
    return updateLayer(id, layerId, body);
  });

  app.delete("/maps/:id/layers/:layerId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id, layerId } = req.params as { id: string; layerId: string };
    await deleteLayer(id, layerId);
    return { ok: true };
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
