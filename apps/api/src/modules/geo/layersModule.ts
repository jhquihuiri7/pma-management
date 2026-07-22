import { and, eq, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import { getDb } from "../../db/client.js";
import { geoMaps, geoMapLayers } from "../../db/schema/geo.js";
import { NotFound } from "../../lib/errors.js";
import {
  getStorage,
  buildGeoMapDir,
  buildGeoLayerDataPath,
  buildGeoLayerSourcePath,
} from "../../storage/index.js";
import { enqueueStorageDirectoryCleanup } from "../shared/storageCleanup.js";
import { beginDurableStorageIntent } from "../shared/durableFilePersistence.js";
import { lockAndAssertGeoAdmin, lockAndAssertGeoEditor } from "./authorization.js";

const gzip = promisify(gzipCallback);

export type CreateLayerInput = {
  name: string;
  geometryType: string;
  crs?: string;
  featureCount?: number;
  bbox?: number[] | null;
  sourceFormat?: string;
  /** Normalized GeoJSON bytes (required) — what the map renders. */
  data: Buffer;
  /** Original upload bytes (.zip/.shp), optional. */
  source?: { data: Buffer; ext: string } | null;
  style: unknown;
  visible?: boolean;
  zIndex?: number;
};

export type UpdateLayerInput = {
  name?: string;
  style?: unknown;
  visible?: boolean;
  zIndex?: number;
};

async function assertMap(mapId: string, db: any = getDb()) {
  const rows = await db.select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
}

export async function listLayers(mapId: string) {
  const rows = await getDb()
    .select()
    .from(geoMapLayers)
    .where(eq(geoMapLayers.mapId, mapId))
    .orderBy(asc(geoMapLayers.zIndex), asc(geoMapLayers.createdAt));
  return rows.map(rowToApi);
}

export async function createLayer(mapId: string, actorId: string, input: CreateLayerInput) {
  await assertMap(mapId);
  const storage = getStorage();

  // Generate the identifier before touching either persistence system. This
  // makes every path unique and lets us write the complete catalog row in one
  // INSERT (there is never a visible row with dataPath="").
  const layerId = randomUUID();
  const dataPath = buildGeoLayerDataPath(mapId, layerId);
  const sourcePath = input.source
    ? buildGeoLayerSourcePath(mapId, layerId, input.source.ext)
    : null;
  const layerDirectory = `${buildGeoMapDir(mapId)}/layers/${layerId}`;
  const compressedData = await gzip(input.data);
  const intent = await beginDurableStorageIntent({
    path: layerDirectory,
    reason: `geo:layer:${layerId}`,
    isDirectory: true,
    storage,
    db: getDb(),
  });

  try {
    // Store GeoJSON gzip-compressed (served with Content-Encoding: gzip).
    await storage.upload({ path: dataPath, data: compressedData, contentType: "application/gzip" });
    if (input.source && sourcePath) {
      await storage.upload({ path: sourcePath, data: input.source.data });
    }

    const row = await intent.finalize(async (tx) => {
      // The map can disappear while compression/storage is in progress. Check
      // it again after the current actor has been locked and revalidated.
      await assertMap(mapId, tx);
      const [persisted] = await tx
        .insert(geoMapLayers)
        .values({
          id: layerId,
          mapId,
          name: input.name,
          geometryType: input.geometryType,
          crs: input.crs ?? "EPSG:4326",
          featureCount: input.featureCount ?? 0,
          bbox: (input.bbox ?? null) as unknown as object,
          sourceFormat: input.sourceFormat ?? "geojson",
          dataPath,
          sourcePath,
          sizeBytes: input.data.byteLength,
          style: input.style as object,
          visible: input.visible ?? true,
          zIndex: input.zIndex ?? 0,
          createdBy: actorId,
        })
        .returning();
      if (!persisted) throw new Error("Geo layer insert returned no row");
      return persisted;
    }, {
      beforeIntentLock: (tx) => lockAndAssertGeoEditor(tx, actorId).then(() => undefined),
    });

    return rowToApi(row);
  } catch (err) {
    // Storage is staged before the single DB insert. If either side fails, the
    // whole UUID-owned directory is compensation-safe and cannot contain files
    // belonging to another layer.
    try {
      await intent.compensate();
    } catch (cleanupError) {
      throw new AggregateError([err, cleanupError], "Layer persistence and cleanup both failed");
    }
    throw err;
  }
}

export async function updateLayer(
  mapId: string,
  layerId: string,
  actorId: string,
  updates: UpdateLayerInput,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.style !== undefined) set.style = updates.style;
  if (updates.visible !== undefined) set.visible = updates.visible;
  if (updates.zIndex !== undefined) set.zIndex = updates.zIndex;
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .update(geoMapLayers)
      .set(set)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .returning();
    if (!row) throw NotFound("Layer not found");
    return rowToApi(row);
  });
}

export async function deleteLayer(mapId: string, layerId: string, actorId: string) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    const rows = await tx
      .select({ id: geoMapLayers.id })
      .from(geoMapLayers)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .limit(1)
      .for("update");
    if (rows.length === 0) throw NotFound("Layer not found");
    await enqueueStorageDirectoryCleanup(
      tx,
      `${buildGeoMapDir(mapId)}/layers/${layerId}`,
      `geo:layer:${layerId}`,
    );
    const deleted = await tx
      .delete(geoMapLayers)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .returning({ id: geoMapLayers.id });
    if (deleted.length !== 1) throw NotFound("Layer not found");
  });
}

export async function getLayerDataPath(mapId: string, layerId: string): Promise<string> {
  const rows = await getDb()
    .select({ mapId: geoMapLayers.mapId, dataPath: geoMapLayers.dataPath })
    .from(geoMapLayers)
    .where(eq(geoMapLayers.id, layerId))
    .limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Layer not found");
  return rows[0].dataPath;
}

function rowToApi(row: typeof geoMapLayers.$inferSelect) {
  return {
    id: row.id,
    mapId: row.mapId,
    name: row.name,
    geometryType: row.geometryType,
    crs: row.crs,
    featureCount: row.featureCount,
    bbox: row.bbox,
    sourceFormat: row.sourceFormat,
    sourcePath: row.sourcePath,
    dataPath: row.dataPath,
    sizeBytes: row.sizeBytes,
    style: row.style,
    visible: row.visible,
    zIndex: row.zIndex,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
