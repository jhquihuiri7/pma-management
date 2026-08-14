import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import type { FeatureCollection } from "geojson";
import type { GeoLayerAttributeSchema } from "@pma/types/geo";
import { closeDb, getDb } from "../db/client.js";
import { geoLayerRevisions, geoMapLayers, geoMaps } from "../db/schema/geo.js";
import { userApps, users } from "../db/schema/shared.js";
import { appendFeature, getLayerRevisionDataPath } from "../modules/geo/layersModule.js";
import { buildGeoLayerDataPath, buildGeoLayerDir, getStorage } from "../storage/index.js";

const unzip = promisify(gunzip);

test("feature appends are versioned, idempotent and have one concurrent winner", { skip: !process.env.DATABASE_URL }, async () => {
  const db = getDb();
  const actorId = randomUUID(), mapId = randomUUID(), layerId = randomUUID();
  const dataPath = buildGeoLayerDataPath(mapId, layerId);
  const storage = getStorage();
  const initial: FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", id: randomUUID(), properties: { CODE: "A-001", COUNT: 1 }, geometry: { type: "Point", coordinates: [-90.3, -0.7] } }],
  };
  const initialBytes = Buffer.from(JSON.stringify(initial));
  const compressed = await import("node:zlib").then(({ gzipSync }) => gzipSync(initialBytes));
  const schema: GeoLayerAttributeSchema = {
    version: 1,
    fields: [
      { key: "CODE", label: "Código", type: "string", required: true, unique: true, maxLength: 20 },
      { key: "COUNT", label: "Cantidad", type: "integer", required: true, min: 0 },
    ],
    geometry: { maxVertices: 10, extent: [-92, -2, -89, 1] },
  };

  try {
    await db.insert(users).values({ id: actorId, email: `${actorId}@example.invalid`, name: "Feature reporter", role: "REPORTER" });
    await db.insert(userApps).values({ userId: actorId, appKey: "geo" });
    await db.insert(geoMaps).values({ id: mapId, title: "Feature capture", categoryId: "test", layers: [], centerLat: -0.7, centerLng: -90.3, createdBy: actorId });
    await storage.upload({ path: dataPath, data: compressed });
    await db.insert(geoMapLayers).values({
      id: layerId, mapId, name: "Observations", geometryType: "Point", crs: "EPSG:4326",
      featureCount: 1, bbox: [-90.3, -0.7, -90.3, -0.7], dataPath, sizeBytes: initialBytes.byteLength,
      style: {}, createdBy: actorId, attributeSchema: schema as unknown as object, manualEntryEnabled: true,
    });
    await db.insert(geoLayerRevisions).values({ layerId, revision: 1, dataPath, featureCount: 1, bbox: [-90.3, -0.7, -90.3, -0.7], sizeBytes: initialBytes.byteLength, createdBy: actorId });

    const featureId = randomUUID();
    const first = await appendFeature(mapId, layerId, actorId, {
      expectedRevision: 1, clientFeatureId: featureId,
      properties: { CODE: "A-002", COUNT: "2" }, geometry: { type: "Point", coordinates: [-90.4, -0.8] }, reason: "field visit",
    });
    assert.equal(first.revision, 2);
    assert.equal(first.feature.properties?.COUNT, 2);

    const retry = await appendFeature(mapId, layerId, actorId, {
      expectedRevision: 1, clientFeatureId: featureId,
      properties: { CODE: "A-002", COUNT: "2" }, geometry: { type: "Point", coordinates: [-90.4, -0.8] },
    });
    assert.equal(retry.feature.id, featureId);
    assert.equal(retry.revision, 2);

    const concurrent = await Promise.allSettled([
      appendFeature(mapId, layerId, actorId, { expectedRevision: 2, clientFeatureId: randomUUID(), properties: { CODE: "A-003", COUNT: 3 }, geometry: { type: "Point", coordinates: [-90.41, -0.81] } }),
      appendFeature(mapId, layerId, actorId, { expectedRevision: 2, clientFeatureId: randomUUID(), properties: { CODE: "A-004", COUNT: 4 }, geometry: { type: "Point", coordinates: [-90.42, -0.82] } }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(httpStatus(rejected.reason), 409);

    const [layer] = await db.select().from(geoMapLayers).where(eq(geoMapLayers.id, layerId));
    assert.equal(layer.dataRevision, 3);
    assert.equal(layer.featureCount, 3);
    const rows = await db.select().from(geoLayerRevisions).where(eq(geoLayerRevisions.layerId, layerId));
    assert.equal(rows.length, 3);
    const latestPath = await getLayerRevisionDataPath(mapId, layerId, 3);
    const latest = JSON.parse((await unzip(await storage.download(latestPath))).toString("utf8")) as FeatureCollection;
    assert.equal(latest.features.length, 3);

    await assert.rejects(
      appendFeature(mapId, layerId, actorId, { expectedRevision: 3, clientFeatureId: randomUUID(), properties: { CODE: "A-001", COUNT: 5 }, geometry: { type: "Point", coordinates: [-90.5, -0.9] } }),
      /único/,
    );
    const afterInvalid = await db.select().from(geoLayerRevisions).where(and(eq(geoLayerRevisions.layerId, layerId), eq(geoLayerRevisions.revision, 4)));
    assert.equal(afterInvalid.length, 0);
  } finally {
    await db.delete(geoMaps).where(eq(geoMaps.id, mapId));
    await db.delete(users).where(eq(users.id, actorId));
    await storage.deleteDir(buildGeoLayerDir(mapId, layerId));
    await closeDb();
  }
});

function httpStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
}
