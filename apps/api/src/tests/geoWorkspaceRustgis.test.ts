import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCatalogUrl,
  parseGeojsonCopyName,
  rasterCogPath,
  rasterTilesTemplate,
  vectorFgbPath,
  vectorGeojsonPath,
  withOrigin,
} from "../modules/geo/workspaceUrls.js";
import {
  ACTIVE_FIELD,
  buildProject,
  cameraFor,
  checkProjectText,
  extractCatalogRefs,
  layerRefsForStorage,
  legacyFromProject,
  rasterReadableInPlace,
  rasterTilesReason,
  resolveProject,
  symbolFor,
  type RasterState,
  type VectorState,
} from "../modules/geo/rustgisProject.js";
import { parseRange } from "../modules/geo/fileDelivery.js";
import { escapeLike, searchTerms } from "../modules/geo/catalogSearch.js";
import { canReadMap } from "../modules/geo/access.js";
import { checkWorkspaceOrigin, pilotUsers, workspaceEngineFor, workspaceOrigins } from "../modules/geo/workspaceAccess.js";
import { mapUpstreamStatus, modelTable, prepareBody, upstreamChatUrl } from "../modules/geo/workspaceAi.js";

const ORIGIN = "https://sigtar.gobiernogalapagos.gob.ec";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333";
const R2 = "44444444-4444-4444-8444-444444444444";

// ── Addresses ──────────────────────────────────────────────────────────────

test("catalog addresses carry the extension RustGIS reads them by and round-trip", () => {
  assert.match(vectorFgbPath(V1, 3), /\/vectors\/[0-9a-f-]+\/r\/3\/data\.fgb$/);
  assert.match(rasterCogPath(R1, 1700000000000), /\/cog\.tif$/);
  assert.deepEqual(parseCatalogUrl(`${ORIGIN}${vectorFgbPath(V1, 3)}`), { kind: "vector", id: V1, revision: 3, form: "fgb" });
  assert.deepEqual(parseCatalogUrl(`http://localhost:3000${vectorGeojsonPath(V1, 2)}`), { kind: "vector", id: V1, revision: 2, form: "geojson" });
  assert.deepEqual(parseCatalogUrl(`${ORIGIN}${rasterCogPath(R1, 42)}#bands=1&range=0,860`), { kind: "raster", id: R1, version: 42, form: "cog" });
  assert.deepEqual(parseCatalogUrl(`${ORIGIN}${rasterTilesTemplate(R1, 42)}`), { kind: "raster", id: R1, version: 42, form: "tiles" });
  assert.equal(withOrigin("http://localhost:3999/", { kind: "vector", id: V1, revision: 1, form: "fgb" }, "#x"), `http://localhost:3999${vectorFgbPath(V1, 1)}#x`);
});

test("foreign or tampered addresses are not taken for catalog data", () => {
  for (const url of [
    "https://example.com/data.fgb",
    `${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${V1}/r/1/../../secret.fgb`,
    `${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${V1}/r/1/${V2}-r1.geojson`, // copy of another layer
    `${ORIGIN}/api-proxy/geo/workspace/v1/vectors/${V1}/r/1/${V1}-r2.geojson`, // other revision
    `${ORIGIN}/api-proxy/geo/workspace/v1/rasters/${R1}/v/x/cog.tif`,
    "",
  ]) {
    assert.equal(parseCatalogUrl(url), null, url);
  }
  assert.deepEqual(parseGeojsonCopyName(`${V1}-r7.geojson`), { id: V1, revision: 7 });
  assert.equal(parseGeojsonCopyName("data.geojson"), null);
});

// ── Building a project ─────────────────────────────────────────────────────

test("the camera is Web Mercator metres and metres per pixel", () => {
  const cam = cameraFor(-0.5, -90.5, 9) as { center: { x: number; y: number }; res: number };
  assert.ok(Math.abs(cam.center.x - -10_074_000) < 1_000);
  assert.ok(Math.abs(cam.center.y - -55_660) < 100);
  assert.ok(Math.abs(cam.res - 305.748) < 0.01);
});

test("styles translate to RustGIS symbols per geometry", () => {
  const style = { color: "#3366cc", opacity: 0.5, strokeWidth: 2, size: 4 };
  const polygon = symbolFor(style, "Polygon") as { fill: number[]; stroke: number[] };
  assert.deepEqual(polygon.fill.slice(0, 3), [0x33, 0x66, 0xcc]);
  assert.equal(polygon.fill[3], Math.round(255 * 0.5 * 0.6));
  const point = symbolFor(style, "Point") as { marker: string; size: number };
  assert.equal(point.marker, "Circle");
  assert.equal(point.size, 6);
  assert.deepEqual((symbolFor(null, "LineString") as { stroke: number[] }).stroke.length, 4);
});

test("a map's project streams FlatGeobufs, reads legible COGs in place and draws WEBP from tiles", () => {
  const { project, notices } = buildProject({
    title: "Mina",
    center: [-0.94, -91.0],
    zoom: 15,
    origin: ORIGIN,
    vectors: [
      { id: V1, name: "puerto villa", geometryType: "Polygon", visible: true, zIndex: 1, style: { color: "#ff0000", labels: true, labelField: "nombre" }, revision: 1, fgbReady: new Set([1]) },
      { id: V2, name: "pendiente", geometryType: "Point", visible: false, zIndex: 2, style: null, revision: 2, fgbReady: new Set([1]) },
    ],
    rasters: [
      { id: R1, name: "dsm", visible: true, zIndex: 0, opacity: 1, bandCount: 1, hasAlpha: false, version: 10 },
      { id: R2, name: "mosaico", visible: false, zIndex: 5, opacity: 0.8, bandCount: 4, hasAlpha: true, version: 20 },
    ],
  });
  const map = (project.maps as Array<Record<string, unknown>>)[0]!;
  const layers = map.layers as Array<Record<string, unknown>>;
  assert.equal(layers.length, 1, "the vector without a ready FlatGeobuf is left out");
  assert.equal((layers[0]!.source as { path: string }).path, `${ORIGIN}${vectorFgbPath(V1, 1)}`);
  assert.equal((layers[0]!.dataset as { geometry_type: string }).geometry_type, "Polygon");
  assert.deepEqual((layers[0]!.labels as { enabled: boolean; field: string }).enabled, true);
  const tiles = map.tiles as Array<Record<string, unknown>>;
  assert.equal(tiles[0]!.kind, "raster", "the WEBP raster (zIndex 5) is on top, as XYZ tiles");
  assert.equal(tiles[0]!.url, `${ORIGIN}${rasterTilesTemplate(R2, 20)}`);
  assert.equal(tiles[0]!.visible, false);
  assert.equal(tiles[1]!.kind, "cog");
  assert.equal(tiles[1]!.url, `${ORIGIN}${rasterCogPath(R1, 10)}`);
  assert.equal(tiles[2]!.kind, "style", "the basemap goes last (drawn below)");
  assert.deepEqual(map[ACTIVE_FIELD], { layer: 1 });
  assert.deepEqual(notices.map((n) => [n.kind, n.name]), [["preparing", "pendiente"], ["tiles", "mosaico"]]);
  assert.equal(rasterReadableInPlace({ bandCount: 1, hasAlpha: false }), true);
  assert.equal(rasterReadableInPlace({ bandCount: 2, hasAlpha: false }), true);
  assert.equal(rasterReadableInPlace({ bandCount: 3, hasAlpha: false }), false, "JPEG YCbCr: RustGIS shows the colours unconverted");
  assert.equal(rasterReadableInPlace({ bandCount: 4, hasAlpha: false }), false);
  assert.match(rasterTilesReason({ bandCount: 3, hasAlpha: false })!, /YCbCr/);
  assert.match(rasterTilesReason({ bandCount: 4, hasAlpha: true })!, /WEBP/);
  assert.equal(rasterTilesReason({ bandCount: null, hasAlpha: false }), null);
});

// ── Re-opening a saved project ─────────────────────────────────────────────

function savedProject() {
  return {
    format: 1,
    name: "P",
    active_map: 0,
    maps: [{
      name: "M",
      basemap: "Paper",
      camera: { center: { x: 0, y: 0 }, res: 10 },
      layers: [
        { id: 7, name: "puerto villa", source: { path: `http://old.example${vectorFgbPath(V1, 1)}` }, dataset: { name: "a", geometry_type: "Polygon", fields: [], features: [] } },
        { id: 8, name: "borrada", source: { path: `${ORIGIN}${vectorFgbPath(V2, 1)}` }, dataset: { name: "b", geometry_type: "Point", fields: [], features: [] } },
        { id: 9, name: "propia", dataset: { name: "c", geometry_type: "Point", fields: [], features: [{ id: 1 }], source: "mis-puntos.geojson" } },
        { id: 10, name: "copia", dataset: { name: "d", geometry_type: "Polygon", fields: [], features: [], source: `${V1}-r1.geojson` } },
      ],
      tiles: [
        { name: "mosaico", kind: "cog", url: `${ORIGIN}${rasterCogPath(R2, 20)}`, over: 8 },
        { name: "dsm", kind: "cog", url: `${ORIGIN}${rasterCogPath(R1, 10)}#bands=1&range=0,860` },
        { name: "Esri", kind: "raster", url: "https://server.arcgisonline.com/x/{z}/{y}/{x}" },
      ],
      [ACTIVE_FIELD]: { layer: 8 },
    }],
  };
}

function state(overrides: { v1?: Partial<VectorState>; r1?: Partial<RasterState> } = {}) {
  const vectors = new Map<string, VectorState>([
    [V1, { readable: true, name: "puerto villa", revision: 3, fgbReady: new Set([1, 3]), ...overrides.v1 }],
  ]);
  const rasters = new Map<string, RasterState>([
    [R1, { readable: true, name: "dsm", version: 11, bandCount: 1, hasAlpha: false, ...overrides.r1 }],
    [R2, { readable: true, name: "mosaico", version: 20, bandCount: 4, hasAlpha: true }],
  ]);
  return { vectors, rasters };
}

test("re-opening removes what is gone, re-points what changed and keeps everything else", () => {
  const input = savedProject();
  const { project, notices } = resolveProject(input, state(), ORIGIN);
  const map = (project.maps as Array<Record<string, unknown>>)[0]!;
  const layers = map.layers as Array<Record<string, unknown>>;
  assert.deepEqual(layers.map((l) => l.id), [7, 9, 10], "the deleted layer (8) is gone; own data and copies stay");
  assert.equal((layers[0]!.source as { path: string }).path, `${ORIGIN}${vectorFgbPath(V1, 3)}`, "new revision, current origin");
  const tiles = map.tiles as Array<Record<string, unknown>>;
  assert.equal(tiles[0]!.kind, "raster", "a WEBP COG saved as cog is drawn from tiles");
  assert.equal(tiles[0]!.url, `${ORIGIN}${rasterTilesTemplate(R2, 20)}`);
  assert.equal(tiles[0]!.over, undefined, "no longer over a removed layer");
  assert.equal(tiles[1]!.url, `${ORIGIN}${rasterCogPath(R1, 11)}#bands=1&range=0,860`, "reprocessed raster keeps its look");
  assert.equal(tiles[2]!.url, "https://server.arcgisonline.com/x/{z}/{y}/{x}");
  assert.equal(map[ACTIVE_FIELD], undefined, "the active layer was removed");
  assert.deepEqual(
    notices.map((n) => [n.kind, n.name]),
    [["updated", "puerto villa"], ["unavailable", "borrada"], ["copy", "copia"], ["tiles", "mosaico"], ["updated", "dsm"]],
  );
  assert.equal((input.maps[0]!.layers as unknown[]).length, 4, "the input is not modified");
});

test("a reader without access sees the same notice as for a deleted layer", () => {
  const { project, notices } = resolveProject(savedProject(), state({ v1: { readable: false }, r1: { readable: false } }), ORIGIN);
  const map = (project.maps as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual((map.layers as Array<{ id: number }>).map((l) => l.id), [9]);
  assert.deepEqual((map.tiles as Array<{ name: string }>).map((t) => t.name), ["mosaico", "Esri"]);
  assert.ok(notices.filter((n) => n.kind === "unavailable").length >= 4);
  assert.ok(notices.every((n) => n.kind !== "unavailable" || n.detail === undefined));
});

test("a revision still being prepared keeps the old one", () => {
  const { project, notices } = resolveProject(savedProject(), state({ v1: { fgbReady: new Set([1]) } }), ORIGIN);
  const layer = ((project.maps as Array<Record<string, unknown>>)[0]!.layers as Array<Record<string, unknown>>)[0]!;
  assert.equal((layer.source as { path: string }).path, `${ORIGIN}${vectorFgbPath(V1, 1)}`);
  assert.equal(notices[0]!.kind, "preparing");
});

test("references, validation and the legacy export", () => {
  const refs = extractCatalogRefs(savedProject());
  assert.deepEqual(refs.map((r) => [r.kind, r.id, r.copy]), [
    ["vector", V1, false], ["vector", V2, false], ["vector", V1, true], ["raster", R2, false], ["raster", R1, false],
  ]);
  assert.equal(layerRefsForStorage(refs).length, 5);
  const text = JSON.stringify(savedProject());
  assert.equal(checkProjectText(text, 10_000_000).layerCount, 7);
  assert.throws(() => checkProjectText(text, 100), RangeError);
  assert.throws(() => checkProjectText("{", 1000), /JSON/);
  assert.throws(() => checkProjectText(JSON.stringify({ format: 2, maps: [{}], active_map: 0 }), 1000), /Formato/);
  assert.throws(() => checkProjectText(JSON.stringify({ format: 1, maps: [], active_map: 0 }), 1000), /mapas/);
  const legacy = legacyFromProject(savedProject(), {
    vectors: new Map([[V1, { mapId: "m1", geometryType: "Polygon", style: { color: "#123456" } }]]),
    rasters: new Map([[R1, { mapId: "m2" }]]),
  }) as { schema: string; layers: Array<{ kind: string; source: { layerId: string }; presentation: Record<string, unknown> }> };
  assert.equal(legacy.schema, "sigtar-workspace");
  assert.deepEqual(legacy.layers.map((l) => [l.kind, l.source.layerId]), [["vector", V1], ["raster", R1]]);
  assert.equal((legacy.layers[0]!.presentation.style as { color: string }).color, "#123456");
});

// ── Range requests ─────────────────────────────────────────────────────────

test("byte ranges as RustGIS asks for them", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=990-5000", 1000), { start: 990, end: 999 });
  assert.equal(parseRange("bytes=1000-1100", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=0-1,5-9", 1000), null);
  assert.equal(parseRange("items=0-1", 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
});

// ── Search helpers and access ──────────────────────────────────────────────

test("search terms are bounded and LIKE wildcards escaped", () => {
  assert.deepEqual(searchTerms("  Puerto   Ayora "), ["Puerto", "Ayora"]);
  assert.equal(searchTerms("a b c d e f g h i j").length, 8);
  assert.equal(escapeLike("100%_a\\b"), "100\\%\\_a\\\\b");
});

test("map visibility rules", () => {
  const viewer = { sub: "u1", role: "VIEWER" as const, apps: ["geo" as const] };
  const outsider = { sub: "u2", role: "VIEWER" as const, apps: ["pma" as const] };
  const admin = { sub: "a", role: "ADMIN" as const, apps: [] };
  assert.equal(canReadMap(null, { visibility: "public", createdBy: null }), true);
  assert.equal(canReadMap(null, { visibility: "internal", createdBy: null }), false);
  assert.equal(canReadMap(outsider, { visibility: "internal", createdBy: null }), false);
  assert.equal(canReadMap(viewer, { visibility: "internal", createdBy: null }), true);
  assert.equal(canReadMap(viewer, { visibility: "restricted", createdBy: "x" }), false);
  assert.equal(canReadMap(viewer, { visibility: "restricted", createdBy: "x" }, true), true);
  assert.equal(canReadMap(viewer, { visibility: "restricted", createdBy: "u1" }), true);
  assert.equal(canReadMap(admin, { visibility: "restricted", createdBy: "x" }), true);
});

test("who gets the RustGIS Workspace, and from which origins", () => {
  const user = { sub: "ABC", email: "Ana@x.ec", role: "VIEWER" as const, apps: ["geo" as const] };
  assert.equal(workspaceEngineFor(user, "legacy", pilotUsers("ana@x.ec")), "legacy");
  assert.equal(workspaceEngineFor(user, "pilot", pilotUsers(" ana@X.ec , other")), "rustgis");
  assert.equal(workspaceEngineFor(user, "pilot", pilotUsers("abc")), "rustgis");
  assert.equal(workspaceEngineFor(user, "pilot", pilotUsers("someone")), "legacy");
  assert.equal(workspaceEngineFor({ ...user, apps: ["pma"] }, "rustgis"), "legacy");
  assert.equal(workspaceEngineFor(user, "rustgis"), "rustgis");
  assert.deepEqual(workspaceOrigins("http://localhost:3000"), ["http://localhost:3000", "http://127.0.0.1:3000"]);
  assert.equal(checkWorkspaceOrigin("https://sigtar.gobiernogalapagos.gob.ec/", [ORIGIN]), ORIGIN);
  assert.throws(() => checkWorkspaceOrigin("https://evil.example", [ORIGIN]), /Origen/);
});

// ── Assistant proxy ────────────────────────────────────────────────────────

test("the model alias maps to the server's model and nothing else is touched", () => {
  const table = modelTable("sigtar-asistente", "minimaxai/minimax-m3.1-flash", "otro/modelo");
  const messages = [
    { role: "system", content: "s" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: "{\"id\":\"map.zoomIn\"}" } }], reasoning_content: "r" },
    { role: "tool", tool_call_id: "c1", content: "ok" },
  ];
  const body = prepareBody({ model: "sigtar-asistente", messages, tools: [{ type: "function" }], stream: true }, table, 0);
  assert.equal(body.model, "minimaxai/minimax-m3.1-flash");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, undefined);
  assert.equal(prepareBody({ model: "otro/modelo", messages }, table, 512).max_tokens, 512);
  assert.throws(() => prepareBody({ model: "gpt-x", messages }, table, 0), /no permitido/);
  assert.throws(() => prepareBody({ model: "sigtar-asistente", messages: [] }, table, 0), /mensajes/);
});

test("upstream errors become what RustGIS retries — or doesn't", () => {
  const auth = mapUpstreamStatus(401, null)!;
  assert.equal(auth.statusCode, 503);
  assert.equal(auth.retryAfterSeconds, 3600, "past RustGIS's 120 s cap: no retry");
  const limited = mapUpstreamStatus(429, "7")!;
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.retryAfterSeconds, 7);
  assert.equal(mapUpstreamStatus(429, null)!.retryAfterSeconds, 20);
  assert.equal(mapUpstreamStatus(429, "Wed, 21 Oct 2015 07:28:00 GMT")!.retryAfterSeconds, 20);
  assert.equal(mapUpstreamStatus(200, null), null);
  assert.equal(mapUpstreamStatus(400, null), null, "a 400 goes through: RustGIS adapts to it");
});

test("the upstream address is pinned to an https host on the list", () => {
  assert.equal(upstreamChatUrl("https://integrate.api.nvidia.com/v1", "integrate.api.nvidia.com").href, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.throws(() => upstreamChatUrl("http://integrate.api.nvidia.com/v1", "integrate.api.nvidia.com"), /https/);
  assert.throws(() => upstreamChatUrl("https://evil.example/v1", "integrate.api.nvidia.com"), /ALLOWED_HOSTS/);
});
