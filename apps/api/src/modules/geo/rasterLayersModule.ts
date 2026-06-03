import { eq, asc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoMaps, geoRasterLayers } from "../../db/schema/geo.js";
import { NotFound, Conflict } from "../../lib/errors.js";
import { getStorage, buildGeoRasterDir } from "../../storage/index.js";

export type CreateRasterLayerInput = {
  /** App-generated UUID, already used to build the NAS paths before insert. */
  id: string;
  name: string;
  originalFilename: string;
  originalPath: string;
  sizeBytes: number;
  fileType?: string;
  auxFiles?: string[] | null;
  visible?: boolean;
  zIndex?: number;
  opacity?: number;
};

export type UpdateRasterLayerInput = {
  name?: string;
  opacity?: number;
  visible?: boolean;
  zIndex?: number;
};

async function assertMap(mapId: string) {
  const rows = await getDb().select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
}

export async function listRasterLayers(mapId: string) {
  const rows = await getDb()
    .select()
    .from(geoRasterLayers)
    .where(eq(geoRasterLayers.mapId, mapId))
    .orderBy(asc(geoRasterLayers.zIndex), asc(geoRasterLayers.createdAt));
  return rows.map(rowToApi);
}

/**
 * Insert the catalog row for an already-uploaded original. The id is generated
 * by the caller (the route) so the NAS paths can be built and the file streamed
 * before this row exists. Status starts at 'uploaded'; a worker (Phase 4/5)
 * moves it to 'processing' → 'processed' | 'error'.
 */
export async function createRasterLayer(mapId: string, userId: string, input: CreateRasterLayerInput) {
  await assertMap(mapId);
  const [row] = await getDb()
    .insert(geoRasterLayers)
    .values({
      id: input.id,
      mapId,
      name: input.name,
      status: "uploaded",
      originalFilename: input.originalFilename,
      originalPath: input.originalPath,
      fileType: input.fileType ?? "tif",
      sizeBytes: input.sizeBytes,
      auxFiles: (input.auxFiles ?? null) as unknown as object,
      opacity: input.opacity ?? 1,
      visible: input.visible ?? true,
      zIndex: input.zIndex ?? 0,
      createdBy: userId,
    })
    .returning();
  return rowToApi(row);
}

export async function updateRasterLayer(mapId: string, layerId: string, updates: UpdateRasterLayerInput) {
  const rows = await getDb().select().from(geoRasterLayers).where(eq(geoRasterLayers.id, layerId)).limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Raster layer not found");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.opacity !== undefined) set.opacity = updates.opacity;
  if (updates.visible !== undefined) set.visible = updates.visible;
  if (updates.zIndex !== undefined) set.zIndex = updates.zIndex;
  const [row] = await getDb().update(geoRasterLayers).set(set).where(eq(geoRasterLayers.id, layerId)).returning();
  return rowToApi(row);
}

/**
 * Mark a layer as being processed. Called by the worker when it picks up a job.
 * Returns false if the row no longer exists (e.g. deleted before processing).
 */
export async function markRasterProcessing(layerId: string): Promise<boolean> {
  const rows = await getDb()
    .update(geoRasterLayers)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(eq(geoRasterLayers.id, layerId))
    .returning({ id: geoRasterLayers.id });
  return rows.length > 0;
}

/** Mark a layer as failed, recording a human-readable reason. */
export async function markRasterError(layerId: string, message: string): Promise<void> {
  await getDb()
    .update(geoRasterLayers)
    .set({ status: "error", errorMessage: message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(geoRasterLayers.id, layerId));
}

/**
 * Resolve a layer id to its (storage-relative) COG path, for the tile proxy.
 * Throws NotFound if the layer doesn't belong to the map, or Conflict if it
 * hasn't finished processing — so the browser never gets a NAS path and tiles
 * are only served once a COG exists.
 */
export async function getProcessedCogPath(mapId: string, layerId: string): Promise<string> {
  const rows = await getDb()
    .select({ mapId: geoRasterLayers.mapId, status: geoRasterLayers.status, cogPath: geoRasterLayers.cogPath })
    .from(geoRasterLayers)
    .where(eq(geoRasterLayers.id, layerId))
    .limit(1);
  const row = rows[0];
  if (!row || row.mapId !== mapId) throw NotFound("Raster layer not found");
  if (row.status !== "processed" || !row.cogPath) throw Conflict("Raster layer is not processed yet");
  return row.cogPath;
}

/** Raw row (includes NAS paths). Internal use by the worker — never sent to the browser. */
export async function getRasterRow(layerId: string) {
  const rows = await getDb().select().from(geoRasterLayers).where(eq(geoRasterLayers.id, layerId)).limit(1);
  return rows[0] ?? null;
}

export type RasterProcessedMeta = {
  cogPath: string;
  srid: number | null;
  crs: string | null;
  bbox: number[] | null;
  widthPx: number | null;
  heightPx: number | null;
  bandCount: number | null;
  hasAlpha: boolean;
  resolutionX: number | null;
  resolutionY: number | null;
};

/** Mark a layer processed and persist the COG path + raster metadata. */
export async function markRasterProcessed(layerId: string, meta: RasterProcessedMeta): Promise<void> {
  await getDb()
    .update(geoRasterLayers)
    .set({
      status: "processed",
      errorMessage: null,
      cogPath: meta.cogPath,
      srid: meta.srid,
      crs: meta.crs,
      bbox: (meta.bbox ?? null) as unknown as object,
      widthPx: meta.widthPx,
      heightPx: meta.heightPx,
      bandCount: meta.bandCount,
      hasAlpha: meta.hasAlpha,
      resolutionX: meta.resolutionX,
      resolutionY: meta.resolutionY,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(geoRasterLayers.id, layerId));
}

/**
 * Reset a layer back to 'uploaded' so it can be re-processed (the route then
 * re-enqueues the job). Used by the "retry" button for failed/stuck layers.
 * Returns the API view, or throws NotFound if the layer isn't on this map.
 */
export async function resetRasterForRetry(mapId: string, layerId: string) {
  const rows = await getDb().select().from(geoRasterLayers).where(eq(geoRasterLayers.id, layerId)).limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Raster layer not found");
  const [row] = await getDb()
    .update(geoRasterLayers)
    .set({ status: "uploaded", errorMessage: null, updatedAt: new Date() })
    .where(eq(geoRasterLayers.id, layerId))
    .returning();
  return rowToApi(row);
}

export async function deleteRasterLayer(mapId: string, layerId: string) {
  const rows = await getDb().select().from(geoRasterLayers).where(eq(geoRasterLayers.id, layerId)).limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Raster layer not found");
  // Remove the whole NAS subtree (original/ + cog/ + tmp/ + logs) for this layer.
  await getStorage().deleteDir(buildGeoRasterDir(mapId, layerId));
  await getDb().delete(geoRasterLayers).where(eq(geoRasterLayers.id, layerId));
}

/**
 * Map a DB row to the API shape. Deliberately omits original_path / cog_path:
 * absolute NAS paths must never reach the browser (pixels are served only as
 * tiles through the API proxy in Phase 6).
 */
function rowToApi(row: typeof geoRasterLayers.$inferSelect) {
  return {
    id: row.id,
    mapId: row.mapId,
    name: row.name,
    status: row.status,
    errorMessage: row.errorMessage,
    originalFilename: row.originalFilename,
    fileType: row.fileType,
    sizeBytes: row.sizeBytes,
    srid: row.srid,
    crs: row.crs,
    bbox: row.bbox,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    bandCount: row.bandCount,
    hasAlpha: row.hasAlpha,
    resolutionX: row.resolutionX,
    resolutionY: row.resolutionY,
    minZoom: row.minZoom,
    maxZoom: row.maxZoom,
    auxFiles: row.auxFiles,
    opacity: row.opacity,
    visible: row.visible,
    zIndex: row.zIndex,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    processedAt: row.processedAt,
  };
}
