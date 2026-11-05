import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { eq, inArray } from "drizzle-orm";
import { signAccessToken } from "../auth/jwt.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { closeDb, getDb } from "../db/client.js";
import { geoLayerRevisions, geoMapAccess, geoMapLayers, geoMaps, geoRasterLayers } from "../db/schema/geo.js";
import { userApps, users } from "../db/schema/shared.js";
import { env } from "../lib/env.js";
import { geoRoutes } from "../routes/geo/index.js";
import { getStorage } from "../storage/index.js";
import { invalidateMapAccess } from "../modules/geo/access.js";
import { markFgbReady } from "../modules/geo/layerArtifacts.js";
import { upstream } from "../modules/geo/workspaceAi.js";
import { stopBoss } from "../jobs/boss.js";

/**
 * The RustGIS Workspace routes against a real database and storage. Run with a
 * throw-away database and storage root, and the Workspace switched on:
 *
 *   DATABASE_URL=… STORAGE_ROOT=$(mktemp -d) GEO_WORKSPACE_ENGINE=rustgis \
 *   WORKSPACE_AI_ENABLED=true WORKSPACE_AI_API_KEY=test-key FRONTEND_ORIGIN=https://sigtar.test \
 *   node --import tsx --test src/tests/geoWorkspaceRoutes.integration.test.ts
 */
const enabled =
  !!process.env.DATABASE_URL &&
  env.GEO_WORKSPACE_ENGINE === "rustgis" &&
  env.WORKSPACE_AI_ENABLED &&
  env.FRONTEND_ORIGIN === "https://sigtar.test";

const ORIGIN = "https://sigtar.test";

test("RustGIS Workspace: search, data, access, projects and the model proxy", { skip: !enabled }, async (t) => {
  const db = getDb();
  const storage = getStorage();
  const app: FastifyInstance = Fastify();
  registerErrorHandler(app);
  await app.register(cookie);
  await app.register(geoRoutes, { prefix: "/geo" });

  const tag = randomUUID().slice(0, 8);
  const ids = {
    viewer: randomUUID(),
    granted: randomUUID(),
    outsider: randomUUID(),
    publicMap: randomUUID(),
    restrictedMap: randomUUID(),
    vector: randomUUID(),
    vectorNoFgb: randomUUID(),
    restrictedVector: randomUUID(),
    dem: randomUUID(),
    ortho: randomUUID(),
  };
  const userIds = [ids.viewer, ids.granted, ids.outsider];
  const tokens: Record<string, string> = {};
  const geojson = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { nombre: "A" }, geometry: { type: "Point", coordinates: [-90.3, -0.7] } }] });
  const fgbBytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  const cogBytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 256));

  try {
    await db.insert(users).values([
      { id: ids.viewer, email: `ws-viewer-${tag}@example.invalid`, name: "Visor", role: "VIEWER" },
      { id: ids.granted, email: `ws-granted-${tag}@example.invalid`, name: "Autorizado", role: "VIEWER" },
      { id: ids.outsider, email: `ws-outsider-${tag}@example.invalid`, name: "Ajeno", role: "VIEWER" },
    ]);
    await db.insert(userApps).values([
      { userId: ids.viewer, appKey: "geo" },
      { userId: ids.granted, appKey: "geo" },
      { userId: ids.outsider, appKey: "pma" },
    ]);
    for (const [key, id, apps] of [
      ["viewer", ids.viewer, ["geo"]],
      ["granted", ids.granted, ["geo"]],
      ["outsider", ids.outsider, ["pma"]],
    ] as const) {
      tokens[key] = await signAccessToken({ sub: id, adminId: id, email: `ws-${key}-${tag}@example.invalid`, name: key, role: "VIEWER", apps: [...apps] });
    }

    await db.insert(geoMaps).values([
      { id: ids.publicMap, title: `Geomorfología ${tag}`, categoryId: `ws-${tag}`, thematic: "Relieve", layers: [], centerLat: -0.94, centerLng: -91, zoom: 14 },
      { id: ids.restrictedMap, title: `Restringido ${tag}`, categoryId: `ws-${tag}`, thematic: "", layers: [], centerLat: -0.9, centerLng: -89.6, zoom: 12, visibility: "restricted" },
    ]);
    await db.insert(geoMapAccess).values({ mapId: ids.restrictedMap, userId: ids.granted });
    invalidateMapAccess();

    const vectorRow = (mapId: string, id: string, name: string) => ({
      id, mapId, name, geometryType: "Point", crs: "EPSG:4326", featureCount: 1, bbox: [-90.4, -0.8, -90.2, -0.6],
      dataPath: `GEO/maps/${mapId}/layers/${id}/data.geojson.gz`, sizeBytes: geojson.length, style: { color: "#3366cc", labels: true, labelField: "nombre" }, visible: true, zIndex: 1,
    });
    await db.insert(geoMapLayers).values([
      vectorRow(ids.publicMap, ids.vector, `Puntos ${tag}`),
      vectorRow(ids.publicMap, ids.vectorNoFgb, `Sin FGB ${tag}`),
      vectorRow(ids.restrictedMap, ids.restrictedVector, `Secreto ${tag}`),
    ]);
    for (const [mapId, id] of [[ids.publicMap, ids.vector], [ids.publicMap, ids.vectorNoFgb], [ids.restrictedMap, ids.restrictedVector]] as const) {
      const dataPath = `GEO/maps/${mapId}/layers/${id}/data.geojson.gz`;
      await storage.upload({ path: dataPath, data: gzipSync(geojson) });
      await db.insert(geoLayerRevisions).values({ layerId: id, revision: 1, dataPath, featureCount: 1, sizeBytes: geojson.length, action: "snapshot" });
    }
    for (const id of [ids.vector, ids.restrictedVector]) {
      const map = id === ids.vector ? ids.publicMap : ids.restrictedMap;
      const path = `GEO/maps/${map}/layers/${id}/artifacts/r1.fgb`;
      await storage.upload({ path, data: fgbBytes });
      await markFgbReady(id, 1, path, fgbBytes.length);
    }
    const processedAt = new Date("2026-11-01T12:00:00.123Z");
    await db.insert(geoRasterLayers).values([
      {
        id: ids.dem, mapId: ids.publicMap, name: `MDT ${tag}`, status: "processed", originalFilename: "dem.tif", originalPath: "x",
        cogPath: `GEO/maps/${ids.publicMap}/rasters/${ids.dem}/cog/cog.tif`, sizeBytes: cogBytes.length, bandCount: 1, hasAlpha: false,
        crs: "EPSG:32715", bbox: [-91, -1, -90.9, -0.9], processedAt, zIndex: 0,
      },
      {
        id: ids.ortho, mapId: ids.publicMap, name: `Mosaico ${tag}`, status: "processed", originalFilename: "o.tif", originalPath: "x",
        cogPath: `GEO/maps/${ids.publicMap}/rasters/${ids.ortho}/cog/cog.tif`, sizeBytes: 999, bandCount: 4, hasAlpha: true,
        crs: "EPSG:32715", bbox: [-91, -1, -90.9, -0.9], processedAt, zIndex: 5, opacity: 0.8,
      },
    ]);
    await storage.upload({ path: `GEO/maps/${ids.publicMap}/rasters/${ids.dem}/cog/cog.tif`, data: cogBytes });
    const version = Math.floor(processedAt.getTime());

    const as = (who: keyof typeof tokens) => ({ cookie: `pma_access=${tokens[who]}` });
    const get = (url: string, who?: keyof typeof tokens, headers: Record<string, string> = {}) =>
      app.inject({ method: "GET", url, headers: { ...(who ? as(who) : {}), ...headers } });

    await t.test("search shows only readable layers, accent-insensitively, with how to load each", async () => {
      const res = await get(`/geo/workspace/v1/catalog/search?categoryId=ws-${tag}&limit=50`, "viewer");
      assert.equal(res.statusCode, 200);
      const items = res.json().items as Array<{ id: string; load: { mode: string; path: string | null; copyPath: string | null } }>;
      const byId = new Map(items.map((i) => [i.id, i]));
      assert.ok(byId.has(ids.vector) && byId.has(ids.dem) && byId.has(ids.ortho));
      assert.equal(byId.has(ids.restrictedVector), false, "a restricted map's layer doesn't appear");
      assert.equal(byId.get(ids.vector)!.load.mode, "stream");
      assert.match(byId.get(ids.vector)!.load.path!, /\/data\.fgb$/);
      assert.equal(byId.get(ids.vectorNoFgb)!.load.mode, "preparing");
      assert.match(byId.get(ids.vectorNoFgb)!.load.copyPath!, /\.geojson$/);
      assert.equal(byId.get(ids.dem)!.load.mode, "stream");
      assert.equal(byId.get(ids.ortho)!.load.mode, "tiles", "RGBA (WEBP) is drawn from tiles");

      const granted = await get(`/geo/workspace/v1/catalog/search?categoryId=ws-${tag}&limit=50`, "granted");
      assert.ok((granted.json().items as Array<{ id: string }>).some((i) => i.id === ids.restrictedVector));

      const accents = await get(`/geo/workspace/v1/catalog/search?q=${encodeURIComponent(`GEOMORFOLOGIA ${tag}`)}`, "viewer");
      assert.ok((accents.json().items as Array<{ mapId: string }>).every((i) => i.mapId === ids.publicMap));
      assert.ok((accents.json().items as unknown[]).length >= 4);

      assert.equal((await get("/geo/workspace/v1/catalog/search", "outsider")).statusCode, 403);
      assert.equal((await get("/geo/workspace/v1/catalog/search")).statusCode, 401);
    });

    await t.test("data is served by range to readable users only", async () => {
      const fgbUrl = `/geo/workspace/v1/vectors/${ids.vector}/r/1/data.fgb`;
      const ranged = await get(fgbUrl, "viewer", { range: "bytes=0-9" });
      assert.equal(ranged.statusCode, 206);
      assert.equal(ranged.headers["content-range"], `bytes 0-9/${fgbBytes.length}`);
      assert.equal(ranged.rawPayload.length, 10);
      assert.deepEqual([...ranged.rawPayload], [...fgbBytes.subarray(0, 10)]);
      const head = await app.inject({ method: "HEAD", url: fgbUrl, headers: as("viewer") });
      assert.equal(head.statusCode, 200);
      assert.equal(head.headers["accept-ranges"], "bytes");
      assert.equal(String(head.headers["content-length"]), String(fgbBytes.length));
      assert.match(String(head.headers["cache-control"]), /private/);

      assert.equal((await get(`/geo/workspace/v1/vectors/${ids.restrictedVector}/r/1/data.fgb`, "viewer")).statusCode, 404);
      assert.equal((await get(`/geo/workspace/v1/vectors/${ids.restrictedVector}/r/1/data.fgb`, "granted", { range: "bytes=0-1" })).statusCode, 206);
      assert.equal((await get(`/geo/workspace/v1/vectors/${ids.vectorNoFgb}/r/1/data.fgb`, "viewer")).statusCode, 404);

      const copy = await get(`/geo/workspace/v1/vectors/${ids.vector}/r/1/${ids.vector}-r1.geojson`, "viewer");
      assert.equal(copy.statusCode, 200);
      assert.equal(copy.headers["content-encoding"], "gzip");
      assert.equal((await get(`/geo/workspace/v1/vectors/${ids.vector}/r/1/${ids.vectorNoFgb}-r1.geojson`, "viewer")).statusCode, 404);

      const cog = await get(`/geo/workspace/v1/rasters/${ids.dem}/v/${version}/cog.tif`, "viewer", { range: "bytes=-16" });
      assert.equal(cog.statusCode, 206);
      assert.equal(cog.headers["content-range"], `bytes ${cogBytes.length - 16}-${cogBytes.length - 1}/${cogBytes.length}`);
      assert.equal((await get(`/geo/workspace/v1/rasters/${ids.dem}/v/${version}/cog.tif`, "viewer", { range: "bytes=99999-" })).statusCode, 416);
      assert.equal((await get(`/geo/workspace/v1/rasters/${ids.dem}/v/${version - 1}/cog.tif`, "viewer")).statusCode, 404, "an old version");
      assert.equal((await get(`/geo/workspace/v1/rasters/${ids.ortho}/v/${version}/cog.tif`, "viewer")).statusCode, 404, "WEBP isn't served as COG");
    });

    await t.test("the public geoportal routes hide restricted maps", async () => {
      const anonymous = await get("/geo/maps");
      assert.equal(anonymous.statusCode, 200);
      const anonIds = new Set((anonymous.json() as Array<{ id: string }>).map((m) => m.id));
      assert.ok(anonIds.has(ids.publicMap));
      assert.equal(anonIds.has(ids.restrictedMap), false);
      assert.ok((await get("/geo/maps", "granted")).json().some((m: { id: string }) => m.id === ids.restrictedMap));
      assert.equal((await get(`/geo/maps/${ids.restrictedMap}`)).statusCode, 404);
      assert.equal((await get(`/geo/maps/${ids.restrictedMap}/layers/${ids.restrictedVector}/data`)).statusCode, 404);
      assert.equal((await get(`/geo/maps/${ids.restrictedMap}/raster-layers/${ids.dem}/tiles/1/0/0.png`)).statusCode, 404);
      assert.equal((await get(`/geo/maps/${ids.restrictedMap}`, "granted")).statusCode, 200);
      assert.equal((await get(`/geo/maps/${ids.publicMap}`)).statusCode, 200);
    });

    await t.test("projects: open a map, save, conflict, re-open after a layer disappears", async () => {
      const opened = await app.inject({ method: "POST", url: `/geo/workspace/v1/maps/${ids.publicMap}/open`, headers: as("viewer"), payload: { origin: ORIGIN } });
      assert.equal(opened.statusCode, 200);
      const { project, notices } = opened.json() as { project: string; notices: Array<{ kind: string }> };
      const doc = JSON.parse(project);
      const map = doc.maps[0];
      assert.equal(map.layers.length, 1, "only the vector whose FlatGeobuf is ready");
      assert.equal(map.layers[0].source.path, `${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${ids.vector}/r/1/data.fgb`);
      assert.deepEqual(map.tiles.map((x: { kind: string }) => x.kind), ["raster", "cog", "style"]);
      assert.deepEqual(map.sigtar_active, { layer: 1 });
      assert.ok(notices.some((n) => n.kind === "preparing"));
      assert.equal(
        (await app.inject({ method: "POST", url: `/geo/workspace/v1/maps/${ids.publicMap}/open`, headers: as("viewer"), payload: { origin: "https://evil.example" } })).statusCode,
        400,
      );
      assert.equal(
        (await app.inject({ method: "POST", url: `/geo/workspace/v1/maps/${ids.restrictedMap}/open`, headers: as("viewer"), payload: { origin: ORIGIN } })).statusCode,
        404,
      );

      const created = await app.inject({ method: "POST", url: "/geo/workspace/v1/projects", headers: as("viewer"), payload: { title: "Mi proyecto", project, sourceMapId: ids.publicMap } });
      assert.equal(created.statusCode, 201);
      const saved = created.json() as { id: string; revision: number; layerCount: number };
      assert.equal(saved.layerCount, 3);
      const list = await get("/geo/workspace/v1/projects", "viewer");
      assert.ok((list.json() as Array<{ id: string }>).some((p) => p.id === saved.id));
      assert.equal((await get("/geo/workspace/v1/projects", "granted")).json().some((p: { id: string }) => p.id === saved.id), false, "projects are private");

      const updated = await app.inject({ method: "PUT", url: `/geo/workspace/v1/projects/${saved.id}`, headers: as("viewer"), payload: { project, baseRevision: saved.revision } });
      assert.equal(updated.statusCode, 200);
      const stale = await app.inject({ method: "PUT", url: `/geo/workspace/v1/projects/${saved.id}`, headers: as("viewer"), payload: { project, baseRevision: saved.revision } });
      assert.equal(stale.statusCode, 409);

      await db.delete(geoMapLayers).where(eq(geoMapLayers.id, ids.vector));
      const reopened = await app.inject({ method: "POST", url: `/geo/workspace/v1/projects/${saved.id}/open`, headers: as("viewer"), payload: { origin: ORIGIN } });
      assert.equal(reopened.statusCode, 200);
      const again = JSON.parse(reopened.json().project);
      assert.equal(again.maps[0].layers.length, 0);
      assert.equal(again.maps[0].sigtar_active, undefined);
      assert.ok((reopened.json().notices as Array<{ kind: string }>).some((n) => n.kind === "unavailable"));
      assert.equal((await app.inject({ method: "POST", url: `/geo/workspace/v1/projects/${saved.id}/open`, headers: as("granted"), payload: { origin: ORIGIN } })).statusCode, 404);
    });

    await t.test("a legacy Workspace file becomes a project", async () => {
      const document = {
        schema: "sigtar-workspace",
        version: 2,
        exportedAt: new Date().toISOString(),
        view: { center: [-0.9, -90.9], zoom: 12, basemap: "satellite" },
        layers: [
          { kind: "raster", source: { mapId: ids.publicMap, layerId: ids.dem }, presentation: { name: "MDT", visible: true, zIndex: 2, opacity: 0.5 } },
          { kind: "vector", source: { mapId: ids.restrictedMap, layerId: ids.restrictedVector }, presentation: { name: "Secreto", visible: true, zIndex: 1, style: {}, visualizations: [] } },
        ],
      };
      const res = await app.inject({ method: "POST", url: "/geo/workspace/v1/projects/import-legacy", headers: as("viewer"), payload: { title: "Importado", document, origin: ORIGIN } });
      assert.equal(res.statusCode, 201);
      const body = res.json() as { id: string; project: string; notices: Array<{ kind: string; name: string }> };
      const map = JSON.parse(body.project).maps[0];
      assert.equal(map.tiles[0].kind, "cog");
      assert.equal(map.tiles[0].opacity, 0.5);
      assert.equal(map.tiles[1].name, "Esri World Imagery");
      assert.deepEqual(body.notices.map((n) => [n.kind, n.name]), [["unavailable", "Secreto"]]);
      const legacy = await get(`/geo/workspace/v1/projects/${body.id}/legacy.json`, "viewer");
      assert.equal(legacy.statusCode, 200);
      assert.equal(legacy.json().schema, "sigtar-workspace");
      assert.deepEqual(legacy.json().layers.map((l: { kind: string }) => l.kind), ["raster"]);
    });

    await t.test("the model proxy: session, model, pass-through, upstream errors", async () => {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      let next: () => Response = () => new Response("data: {\"choices\":[]}\n\ndata: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      const original = upstream.fetch;
      upstream.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return next();
      };
      try {
        const body = { model: env.WORKSPACE_AI_MODEL_ALIAS, stream: true, messages: [{ role: "user", content: "hola" }], tools: [] };
        const post = (who?: keyof typeof tokens, payload: unknown = body, headers: Record<string, string> = {}) =>
          app.inject({ method: "POST", url: "/geo/workspace/ai/v1/chat/completions", headers: { ...(who ? as(who) : {}), ...headers }, payload: payload as object });

        const anonymous = await post();
        assert.equal(anonymous.statusCode, 401);
        assert.equal(anonymous.json().error.code, "session_expired");
        assert.equal((await post("outsider")).json().error.code, "forbidden");
        assert.equal((await post("viewer", body, { origin: "https://evil.example" })).statusCode, 403);
        assert.equal((await post("viewer", { ...body, model: "gpt-4o" })).json().error.code, "model_not_allowed");

        const ok = await post("viewer", body, { origin: ORIGIN, accept: "text/event-stream" });
        assert.equal(ok.statusCode, 200);
        assert.match(ok.body, /\[DONE\]/);
        const sent = calls.at(-1)!;
        assert.equal(sent.url, "https://integrate.api.nvidia.com/v1/chat/completions");
        const headers = sent.init.headers as Record<string, string>;
        assert.equal(headers.Authorization, `Bearer ${env.WORKSPACE_AI_API_KEY}`);
        assert.equal(Object.keys(headers).some((h) => h.toLowerCase() === "cookie"), false, "the session never goes upstream");
        assert.equal(JSON.parse(String(sent.init.body)).model, env.WORKSPACE_AI_MODEL);

        next = () => new Response("{}", { status: 401 });
        const auth = await post("viewer");
        assert.equal(auth.statusCode, 503);
        assert.equal(auth.headers["retry-after"], "3600");
        next = () => new Response("{}", { status: 429, headers: { "retry-after": "7" } });
        const limited = await post("viewer");
        assert.equal(limited.statusCode, 429);
        assert.equal(limited.headers["retry-after"], "7");
        next = () => new Response(JSON.stringify({ error: { message: "reasoning_effort no soportado" } }), { status: 400, headers: { "content-type": "application/json" } });
        const passthrough = await post("viewer");
        assert.equal(passthrough.statusCode, 400);
        assert.match(passthrough.body, /reasoning_effort/);

        const models = await get("/geo/workspace/ai/v1/models", "viewer");
        assert.equal(models.statusCode, 200);
        assert.ok(models.json().data.some((m: { id: string }) => m.id === env.WORKSPACE_AI_MODEL_ALIAS));
      } finally {
        upstream.fetch = original;
      }
    });
  } finally {
    await db.delete(geoMaps).where(inArray(geoMaps.id, [ids.publicMap, ids.restrictedMap]));
    await db.delete(users).where(inArray(users.id, userIds));
    await app.close();
    await stopBoss();
    await closeDb();
  }
});
