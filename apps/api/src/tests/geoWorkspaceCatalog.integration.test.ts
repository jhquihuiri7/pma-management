import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { geoMapLayers, geoMaps, geoRasterLayers } from "../db/schema/geo.js";
import { listWorkspaceCatalog } from "../modules/geo/workspaceModule.js";

test("el catálogo Workspace expone vectores y solo rásteres procesados sin rutas internas", { skip: !process.env.DATABASE_URL }, async () => {
  const db = getDb();
  const mapId = randomUUID();
  const vectorId = randomUUID();
  const processedRasterId = randomUUID();
  const queuedRasterId = randomUUID();

  try {
    await db.insert(geoMaps).values({
      id: mapId,
      title: "Catálogo Workspace",
      categoryId: "workspace-test",
      thematic: "Pruebas",
      layers: [],
      centerLat: -0.5,
      centerLng: -90.5,
      zoom: 9,
    });
    await db.insert(geoMapLayers).values({
      id: vectorId,
      mapId,
      name: "Vector público",
      geometryType: "Polygon",
      crs: "EPSG:4326",
      featureCount: 1,
      bbox: [-91, -1, -90, 0],
      dataPath: `GEO/maps/${mapId}/layers/${vectorId}/data.geojson.gz`,
      sourcePath: `GEO/maps/${mapId}/layers/${vectorId}/source.zip`,
      sizeBytes: 128,
      style: { color: "#3f7c5f" },
      visible: true,
      zIndex: 1,
    });
    await db.insert(geoRasterLayers).values([
      {
        id: processedRasterId,
        mapId,
        name: "Ortofoto lista",
        status: "processed",
        originalFilename: "ready.tif",
        originalPath: `GEO/maps/${mapId}/rasters/${processedRasterId}/original/ready.tif`,
        cogPath: `GEO/maps/${mapId}/rasters/${processedRasterId}/cog/cog.tif`,
        sizeBytes: 256,
        bbox: [-91, -1, -90, 0],
        opacity: 0.7,
      },
      {
        id: queuedRasterId,
        mapId,
        name: "Ortofoto pendiente",
        status: "queued",
        originalFilename: "queued.tif",
        originalPath: `GEO/maps/${mapId}/rasters/${queuedRasterId}/original/queued.tif`,
        sizeBytes: 256,
      },
    ]);

    const catalog = await listWorkspaceCatalog("workspace-test");
    assert.equal(catalog.length, 1);
    assert.deepEqual(catalog[0].layers.map((layer) => layer.layerId).sort(), [processedRasterId, vectorId].sort());
    const serialized = JSON.stringify(catalog);
    assert.equal(serialized.includes("dataPath"), false);
    assert.equal(serialized.includes("sourcePath"), false);
    assert.equal(serialized.includes("cogPath"), false);
    assert.equal(serialized.includes(queuedRasterId), false);
  } finally {
    await db.delete(geoMaps).where(eq(geoMaps.id, mapId));
    await closeDb();
  }
});
