import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, sql } from "drizzle-orm";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { geoMapLayers, geoMaps, geoRasterLayers } from "../../db/schema/geo.js";
import { env } from "../../lib/env.js";
import { BadRequest, HttpError, NotFound } from "../../lib/errors.js";
import { assertReaderCanReadMap, readableMapsCondition } from "../../modules/geo/access.js";
import { searchCatalog } from "../../modules/geo/catalogSearch.js";
import { sendStorageFile } from "../../modules/geo/fileDelivery.js";
import { getReadyFgb, requestFgb } from "../../modules/geo/layerArtifacts.js";
import { rasterReadableInPlace } from "../../modules/geo/rustgisProject.js";
import {
  AiProxyError,
  aiApiKey,
  errorBody,
  listModels,
  proxyChatCompletion,
  sendAiError,
} from "../../modules/geo/workspaceAi.js";
import { checkWorkspaceOrigin, requireRustgisWorkspace, workspaceEngineFor, workspaceOrigins } from "../../modules/geo/workspaceAccess.js";
import {
  createProject,
  deleteProject,
  exportLegacyProject,
  importLegacyProject,
  listProjects,
  openMapProject,
  openSavedProject,
  updateProject,
} from "../../modules/geo/workspaceProjects.js";
import { vectorGeojsonFileName } from "../../modules/geo/workspaceUrls.js";

const IMMUTABLE_PRIVATE = "private, max-age=31536000, immutable";

const uuid = z.string().uuid();
const searchQuery = z
  .object({
    q: z.string().max(300).optional(),
    kind: z.enum(["vector", "raster"]).optional(),
    categoryId: z.string().trim().min(1).max(100).optional(),
    mapId: uuid.optional(),
    bbox: z
      .string()
      .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
      .transform((v) => v.split(",").map(Number) as [number, number, number, number])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
const originBody = z.object({ origin: z.string().max(200) }).strict();
const projectCreate = z
  .object({
    title: z.string().trim().min(1).max(200),
    project: z.string().min(2),
    sourceMapId: uuid.nullish(),
  })
  .strict();
const projectUpdate = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    project: z.string().min(2).optional(),
    baseRevision: z.number().int().min(1),
  })
  .strict();
const legacyImport = z.object({ title: z.string().trim().min(1).max(200), document: z.unknown(), origin: z.string().max(200) }).strict();

const rasterVersionSql = sql<string>`floor(extract(epoch from ${geoRasterLayers.processedAt}) * 1000)::bigint`;

/** Bodies of the project routes can be large (a saved RustGIS project). */
const PROJECT_BODY_LIMIT = env.GEO_WORKSPACE_MAX_PROJECT_BYTES + 1024 * 1024;

export async function workspaceV1Routes(app: FastifyInstance) {
  const guard = [authenticate, requireApp("geo")];
  const workspace = [authenticate, requireApp("geo"), requireRustgisWorkspace];

  // Which Workspace this user gets; the page asks first.
  app.get("/config", { preHandler: guard }, async (req) => {
    const engine = workspaceEngineFor(req.user);
    return {
      engine,
      appPath: env.GEO_WORKSPACE_APP_PATH,
      origins: workspaceOrigins(),
      maxProjectBytes: env.GEO_WORKSPACE_MAX_PROJECT_BYTES,
      ai: {
        enabled: engine === "rustgis" && env.WORKSPACE_AI_ENABLED && aiApiKey().length > 0,
        path: "/api-proxy/geo/workspace/ai/v1",
        model: env.WORKSPACE_AI_MODEL_ALIAS,
      },
    };
  });

  app.get("/catalog/search", { preHandler: workspace }, async (req) => {
    const query = searchQuery.parse(req.query);
    return searchCatalog(req.user, query);
  });

  // Maps the user may open, for the «Abrir Mapa» list.
  app.get("/maps", { preHandler: workspace }, async (req) => {
    const rows = await getDb()
      .select({ id: geoMaps.id, title: geoMaps.title, categoryId: geoMaps.categoryId, thematic: geoMaps.thematic, updatedAt: geoMaps.updatedAt })
      .from(geoMaps)
      .where(readableMapsCondition(req.user))
      .orderBy(geoMaps.title);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  });

  app.post("/maps/:mapId/open", { preHandler: workspace }, async (req) => {
    const { mapId } = z.object({ mapId: uuid }).strict().parse(req.params);
    const { origin } = originBody.parse(req.body);
    return openMapProject(req.user!, mapId, checkWorkspaceOrigin(origin));
  });

  // ── Saved projects ──
  app.get("/projects", { preHandler: workspace }, async (req) => listProjects(req.user!));

  app.post("/projects", { preHandler: workspace, bodyLimit: PROJECT_BODY_LIMIT }, async (req, reply) => {
    const body = projectCreate.parse(req.body);
    reply.status(201);
    return createProject(req.user!, body);
  });

  app.put("/projects/:id", { preHandler: workspace, bodyLimit: PROJECT_BODY_LIMIT }, async (req) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.params);
    const body = projectUpdate.parse(req.body);
    return updateProject(req.user!, id, body);
  });

  app.delete("/projects/:id", { preHandler: workspace }, async (req) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.params);
    await deleteProject(req.user!, id);
    return { ok: true };
  });

  app.post("/projects/:id/open", { preHandler: workspace }, async (req) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.params);
    const { origin } = originBody.parse(req.body);
    return openSavedProject(req.user!, id, checkWorkspaceOrigin(origin));
  });

  app.get("/projects/:id/legacy.json", { preHandler: workspace }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).strict().parse(req.params);
    const { title, document } = await exportLegacyProject(req.user!, id);
    const safe = title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "workspace";
    reply.header("Content-Disposition", `attachment; filename="sigtar-workspace-${safe}.json"`);
    return document;
  });

  app.post("/projects/import-legacy", { preHandler: workspace, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const body = legacyImport.parse(req.body);
    reply.status(201);
    return importLegacyProject(req.user!, { title: body.title, document: body.document, origin: checkWorkspaceOrigin(body.origin) });
  });

  // ── Data for RustGIS (same origin; the session cookie authorises each request) ──
  app.get("/vectors/:layerId/r/:revision/:file", { preHandler: workspace }, async (req, reply) => {
    const { layerId, revision, file } = z
      .object({ layerId: uuid, revision: z.coerce.number().int().min(1), file: z.string().max(120) })
      .strict()
      .parse(req.params);
    const [layer] = await getDb()
      .select({ id: geoMapLayers.id, mapId: geoMapLayers.mapId, dataRevision: geoMapLayers.dataRevision })
      .from(geoMapLayers)
      .where(eq(geoMapLayers.id, layerId))
      .limit(1);
    if (!layer) throw NotFound("Layer not found");
    await assertReaderCanReadMap(req.user, layer.mapId);
    if (file === "data.fgb") {
      const fgb = await getReadyFgb(layerId, revision);
      if (!fgb) {
        if (revision === layer.dataRevision) await requestFgb(layerId, revision).catch(() => undefined);
        throw NotFound("La versión para el Workspace de esta capa aún se está preparando");
      }
      return sendStorageFile(req, reply, {
        storagePath: fgb.path,
        contentType: "application/octet-stream",
        cacheControl: IMMUTABLE_PRIVATE,
        etag: `"fgb-${layerId}-r${revision}-${fgb.sizeBytes}"`,
        ranges: true,
      });
    }
    if (file === vectorGeojsonFileName(layerId, revision)) {
      const rows = await getDb().execute(
        sql`select data_path from geo_layer_revisions where layer_id = ${layerId} and revision = ${revision} limit 1`,
      );
      const path = (rows.rows[0] as { data_path?: string } | undefined)?.data_path;
      if (!path) throw NotFound("Layer revision not found");
      return sendStorageFile(req, reply, {
        storagePath: path,
        contentType: "application/geo+json",
        contentEncoding: "gzip",
        cacheControl: IMMUTABLE_PRIVATE,
        etag: `"geojson-${layerId}-r${revision}"`,
        ranges: false,
      });
    }
    throw NotFound();
  });

  app.get("/rasters/:rasterId/v/:version/cog.tif", { preHandler: workspace }, async (req, reply) => {
    const { rasterId, version } = z.object({ rasterId: uuid, version: z.coerce.number().int().min(0) }).strict().parse(req.params);
    const raster = await loadProcessedRaster(rasterId, version);
    await assertReaderCanReadMap(req.user, raster.mapId);
    if (!rasterReadableInPlace(raster)) throw NotFound("Este ráster se sirve por teselas");
    return sendStorageFile(req, reply, {
      storagePath: raster.cogPath,
      contentType: "image/tiff",
      cacheControl: IMMUTABLE_PRIVATE,
      etag: `"cog-${rasterId}-v${version}"`,
      ranges: true,
    });
  });

  app.get("/rasters/:rasterId/v/:version/tiles/:z/:x/:y", { preHandler: workspace }, async (req, reply) => {
    const params = z
      .object({
        rasterId: uuid,
        version: z.coerce.number().int().min(0),
        z: z.string().regex(/^\d{1,2}$/),
        x: z.string().regex(/^\d+$/),
        y: z.string().regex(/^\d+(?:\.png)?$/),
      })
      .strict()
      .parse(req.params);
    const Z = Number(params.z);
    const X = Number(params.x);
    const Y = parseInt(params.y, 10);
    const limit = 2 ** Z;
    if (Z > 22 || X >= limit || Y >= limit) throw BadRequest("Invalid tile coordinates");
    const raster = await loadProcessedRaster(params.rasterId, params.version);
    await assertReaderCanReadMap(req.user, raster.mapId);
    const fileUrl = `${env.TITILER_DATA_ROOT.replace(/\/+$/, "")}/${raster.cogPath.replace(/^\/+/, "")}`;
    const titilerUrl =
      `${env.TITILER_INTERNAL_URL.replace(/\/+$/, "")}/cog/tiles/WebMercatorQuad/${Z}/${X}/${Y}.png` +
      `?url=${encodeURIComponent(fileUrl)}`;
    let resp: globalThis.Response;
    try {
      resp = await fetch(titilerUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw new HttpError(504, "Tile service timed out");
      throw new HttpError(502, "Tile service unavailable");
    }
    if (resp.status === 404) {
      reply.status(404);
      return reply.send();
    }
    if (!resp.ok) throw new HttpError(502, `Tile service error ${resp.status}`);
    reply.header("Content-Type", resp.headers.get("content-type") ?? "image/png");
    reply.header("Cache-Control", IMMUTABLE_PRIVATE);
    return reply.send(Buffer.from(await resp.arrayBuffer()));
  });
}

async function loadProcessedRaster(rasterId: string, version: number) {
  const [row] = await getDb()
    .select({
      id: geoRasterLayers.id,
      mapId: geoRasterLayers.mapId,
      status: geoRasterLayers.status,
      cogPath: geoRasterLayers.cogPath,
      bandCount: geoRasterLayers.bandCount,
      hasAlpha: geoRasterLayers.hasAlpha,
      version: rasterVersionSql,
    })
    .from(geoRasterLayers)
    .where(eq(geoRasterLayers.id, rasterId))
    .limit(1);
  // An old version answers 404: its address named other bytes.
  if (!row || row.status !== "processed" || !row.cogPath || Number(row.version) !== version) throw NotFound("Raster not found");
  return { id: row.id, mapId: row.mapId, cogPath: row.cogPath, bandCount: row.bandCount, hasAlpha: row.hasAlpha };
}

/**
 * The assistant's model proxy. Its own error handler answers in the shape
 * RustGIS reads (`{"error":{"message","type","code"}}`), including for an
 * expired session (401, never a redirect: RustGIS turns redirects into network
 * failures).
 */
export async function workspaceAiRoutes(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AiProxyError) return sendAiError(reply, err);
    if (err instanceof ZodError) return reply.status(400).send(errorBody("invalid_body", "La consulta no es válida."));
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 401) {
      return reply
        .status(401)
        .send(errorBody("session_expired", "Tu sesión del geoportal expiró. Vuelve a iniciar sesión y recarga el Workspace.", "authentication_error"));
    }
    if (status === 403 || status === 404) {
      return reply.status(403).send(errorBody("forbidden", "Tu usuario no tiene acceso al asistente del Workspace.", "permission_error"));
    }
    if (status === 413) {
      return reply.status(413).send(errorBody("request_too_large", "La conversación es demasiado grande; usa «Compactar» o empieza una nueva."));
    }
    if (status >= 500) req.log.error(err);
    return reply.status(status >= 400 ? status : 500).send(errorBody("server_error", "Error del servidor del asistente.", "server_error"));
  });

  const guard = [authenticate, requireApp("geo"), requireRustgisWorkspace];

  app.addHook("onRequest", async (req) => {
    const origin = req.headers.origin;
    if (origin && !workspaceOrigins().includes(origin.replace(/\/+$/, ""))) {
      throw new AiProxyError(403, "forbidden_origin", "Origen no permitido.", "permission_error");
    }
  });

  app.get("/models", { preHandler: guard }, async () => listModels());

  app.post("/chat/completions", { preHandler: guard, bodyLimit: env.WORKSPACE_AI_MAX_BODY_BYTES }, async (req, reply) => {
    return proxyChatCompletion(req, reply, req.user!.sub);
  });
}
