import { eq, asc } from "drizzle-orm";
import { gzipSync } from "node:zlib";
import { getDb } from "../../db/client.js";
import { geoMaps, geoMapLayers } from "../../db/schema/geo.js";
import { NotFound } from "../../lib/errors.js";
import {
  getStorage,
  buildGeoMapDir,
  buildGeoLayerDataPath,
  buildGeoLayerSourcePath,
} from "../../storage/index.js";

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

async function assertMap(mapId: string) {
  const rows = await getDb().select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1);
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

export async function createLayer(mapId: string, userId: string, input: CreateLayerInput) {
  await assertMap(mapId);
  const storage = getStorage();

  // Insert first to obtain the layer id used in NAS paths.
  const [row] = await getDb()
    .insert(geoMapLayers)
    .values({
      mapId,
      name: input.name,
      geometryType: input.geometryType,
      crs: input.crs ?? "EPSG:4326",
      featureCount: input.featureCount ?? 0,
      bbox: (input.bbox ?? null) as unknown as object,
      sourceFormat: input.sourceFormat ?? "geojson",
      dataPath: "", // set below once we know the id
      sourcePath: null,
      sizeBytes: input.data.byteLength,
      style: input.style as object,
      visible: input.visible ?? true,
      zIndex: input.zIndex ?? 0,
      createdBy: userId,
    })
    .returning();

  const dataPath = buildGeoLayerDataPath(mapId, row.id);
  let sourcePath: string | null = null;

  try {
    // Store GeoJSON gzip-compressed (served with Content-Encoding: gzip).
    await storage.upload({ path: dataPath, data: gzipSync(input.data), contentType: "application/gzip" });
    if (input.source) {
      sourcePath = buildGeoLayerSourcePath(mapId, row.id, input.source.ext);
      await storage.upload({ path: sourcePath, data: input.source.data });
    }
  } catch (err) {
    // Roll back the row if the NAS write fails, so we don't keep an orphan record.
    await getDb().delete(geoMapLayers).where(eq(geoMapLayers.id, row.id));
    throw err;
  }

  const [updated] = await getDb()
    .update(geoMapLayers)
    .set({ dataPath, sourcePath, updatedAt: new Date() })
    .where(eq(geoMapLayers.id, row.id))
    .returning();

  return rowToApi(updated);
}

export async function updateLayer(mapId: string, layerId: string, updates: UpdateLayerInput) {
  const rows = await getDb().select().from(geoMapLayers).where(eq(geoMapLayers.id, layerId)).limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Layer not found");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.style !== undefined) set.style = updates.style;
  if (updates.visible !== undefined) set.visible = updates.visible;
  if (updates.zIndex !== undefined) set.zIndex = updates.zIndex;
  const [row] = await getDb().update(geoMapLayers).set(set).where(eq(geoMapLayers.id, layerId)).returning();
  return rowToApi(row);
}

export async function deleteLayer(mapId: string, layerId: string) {
  const rows = await getDb().select().from(geoMapLayers).where(eq(geoMapLayers.id, layerId)).limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Layer not found");
  await getStorage().deleteDir(`${buildGeoMapDir(mapId)}/layers/${layerId}`);
  await getDb().delete(geoMapLayers).where(eq(geoMapLayers.id, layerId));
}

/** Remove every NAS artifact for a map (call when the map itself is deleted). */
export async function deleteMapStorage(mapId: string) {
  await getStorage().deleteDir(buildGeoMapDir(mapId));
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
