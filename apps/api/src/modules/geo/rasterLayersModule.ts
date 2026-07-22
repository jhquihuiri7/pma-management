import { and, eq, asc, inArray, lt, ne } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoMaps, geoRasterLayers } from "../../db/schema/geo.js";
import { storageCleanupJobs } from "../../db/schema/shared.js";
import { NotFound, Conflict } from "../../lib/errors.js";
import { buildGeoRasterDir } from "../../storage/index.js";
import { enqueueStorageDirectoryCleanup } from "../shared/storageCleanup.js";
import { lockAndAssertGeoAdmin, lockAndAssertGeoEditor } from "./authorization.js";

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

async function assertMap(mapId: string, db: any = getDb()) {
  const rows = await db.select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1);
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
export async function createRasterLayer(
  mapId: string,
  actorId: string,
  input: CreateRasterLayerInput,
  db: any,
) {
  // The streaming route must call this only from DurableStorageIntent.finalize
  // with lockAndAssertGeoEditor as beforeIntentLock. That preserves the global
  // order authorization -> storage intent -> map/raster rows.
  await assertMap(mapId, db);
  const [row] = await db
    .insert(geoRasterLayers)
    .values({
      id: input.id,
      mapId,
      name: input.name,
      // The route only exposes this row after pg-boss has accepted the job. If
      // enqueue fails, the route compensates by deleting row + storage.
      status: "queued",
      originalFilename: input.originalFilename,
      originalPath: input.originalPath,
      fileType: input.fileType ?? "tif",
      sizeBytes: input.sizeBytes,
      auxFiles: (input.auxFiles ?? null) as unknown as object,
      opacity: input.opacity ?? 1,
      visible: input.visible ?? true,
      zIndex: input.zIndex ?? 0,
      createdBy: actorId,
    })
    .returning();
  if (!row) throw new Error("Raster layer insert returned no row");
  return rowToApi(row);
}

/** Rows that were durably registered but whose enqueue acknowledgement may
 * have been interrupted by a process crash. The worker reconciles these. */
export async function listQueuedRasterJobs(limit = 100): Promise<Array<{ mapId: string; rasterLayerId: string }>> {
  // Leave fresh rows to their originating HTTP request. Only reconcile rows
  // old enough to indicate an interrupted enqueue acknowledgement.
  const staleBefore = new Date(Date.now() - 2 * 60_000);
  const rows = await getDb()
    .select({ mapId: geoRasterLayers.mapId, rasterLayerId: geoRasterLayers.id })
    .from(geoRasterLayers)
    .where(and(
      eq(geoRasterLayers.status, "queued"),
      lt(geoRasterLayers.createdAt, staleBefore),
    ))
    .orderBy(asc(geoRasterLayers.createdAt))
    .limit(limit);
  return rows;
}

export async function updateRasterLayer(
  mapId: string,
  layerId: string,
  actorId: string,
  updates: UpdateRasterLayerInput,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.opacity !== undefined) set.opacity = updates.opacity;
  if (updates.visible !== undefined) set.visible = updates.visible;
  if (updates.zIndex !== undefined) set.zIndex = updates.zIndex;
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .update(geoRasterLayers)
      .set(set)
      .where(and(eq(geoRasterLayers.id, layerId), eq(geoRasterLayers.mapId, mapId), ne(geoRasterLayers.status, "deleting")))
      .returning();
    if (!row) throw NotFound("Raster layer not found");
    return rowToApi(row);
  });
}

/**
 * Claim a layer for processing. The map id is part of the claim so a malformed
 * or stale queue payload can never mutate a layer belonging to another map.
 * `missing` lets the worker durably clean artifacts recreated after deletion;
 * `unavailable` denotes an already-finalized state and must not trigger cleanup.
 */
export async function markRasterProcessing(
  mapId: string,
  layerId: string,
): Promise<"claimed" | "missing" | "unavailable"> {
  const rows = await getDb()
    .update(geoRasterLayers)
    .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
    .where(and(
      eq(geoRasterLayers.id, layerId),
      eq(geoRasterLayers.mapId, mapId),
      // `processing` is reclaimable: after a hard worker crash pg-boss retries
      // the same stately-singleton job while the catalog still has that state.
      inArray(geoRasterLayers.status, ["uploaded", "queued", "processing", "error"]),
    ))
    .returning({ id: geoRasterLayers.id });
  if (rows.length > 0) return "claimed";

  const current = await getDb()
    .select({ mapId: geoRasterLayers.mapId })
    .from(geoRasterLayers)
    .where(eq(geoRasterLayers.id, layerId))
    .limit(1);
  if (!current[0]) return "missing";
  if (current[0].mapId !== mapId) {
    throw new Error(`Raster job map mismatch for ${layerId}`);
  }
  return "unavailable";
}

/** Mark a layer as failed, recording a human-readable reason. */
export async function markRasterError(mapId: string, layerId: string, message: string): Promise<void> {
  await getDb()
    .update(geoRasterLayers)
    .set({ status: "error", errorMessage: message.slice(0, 2000), updatedAt: new Date() })
    .where(and(
      eq(geoRasterLayers.id, layerId),
      eq(geoRasterLayers.mapId, mapId),
      ne(geoRasterLayers.status, "deleting"),
    ));
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

/**
 * Install the crash-recovery intent before GDAL is allowed to create output.
 *
 * Locking the catalog row makes this serialize with deleteRasterLayer. If the
 * delete wins, no work starts. If this intent wins, a later delete reuses the
 * same path-keyed outbox row and the worker may only remove it together with a
 * successful `processing -> processed` transition.
 */
export async function beginRasterProcessingStorageIntent(
  mapId: string,
  layerId: string,
): Promise<
  | { status: "started"; intentId: string }
  | { status: "missing" }
  | { status: "unavailable" }
> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ status: geoRasterLayers.status })
      .from(geoRasterLayers)
      .where(and(eq(geoRasterLayers.id, layerId), eq(geoRasterLayers.mapId, mapId)))
      .limit(1)
      .for("update");
    if (!row) return { status: "missing" } as const;
    if (row.status !== "processing") return { status: "unavailable" } as const;

    const storagePath = buildGeoRasterDir(mapId, layerId);
    const [created] = await tx
      .insert(storageCleanupJobs)
      .values({
        storagePath,
        reason: `processing-intent:geo:raster:${layerId}`,
        isDirectory: true,
      })
      .onConflictDoNothing({ target: storageCleanupJobs.storagePath })
      .returning({ id: storageCleanupJobs.id });
    const intent = created ?? (await tx
      .select({ id: storageCleanupJobs.id, isDirectory: storageCleanupJobs.isDirectory })
      .from(storageCleanupJobs)
      .where(eq(storageCleanupJobs.storagePath, storagePath))
      .limit(1)
      .for("update"))[0];
    if (!intent || ("isDirectory" in intent && !intent.isDirectory)) {
      throw new Error(`Could not reserve raster processing cleanup intent for ${layerId}`);
    }
    return { status: "started", intentId: intent.id } as const;
  });
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
export async function markRasterProcessed(
  layerId: string,
  meta: RasterProcessedMeta,
  processingIntentId: string,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
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
      .where(and(eq(geoRasterLayers.id, layerId), eq(geoRasterLayers.status, "processing")))
      .returning({ id: geoRasterLayers.id, mapId: geoRasterLayers.mapId });
    if (rows.length !== 1) return false;

    const removedIntent = await tx
      .delete(storageCleanupJobs)
      .where(and(
        eq(storageCleanupJobs.id, processingIntentId),
        eq(storageCleanupJobs.storagePath, buildGeoRasterDir(rows[0].mapId, layerId)),
        eq(storageCleanupJobs.isDirectory, true),
      ))
      .returning({ id: storageCleanupJobs.id });
    if (removedIntent.length !== 1) {
      // Rolling the transaction back is safer than publishing a processed row
      // whose crash-recovery intent was not conclusively finalized.
      throw new Error(`Raster processing cleanup intent disappeared for ${layerId}`);
    }
    return true;
  });
}

/**
 * Atomically reset a failed layer to 'queued' so the route can re-enqueue it.
 * Only status='error' is eligible; this prevents two concurrent retry requests
 * from both believing they own the same transition.
 * Returns the API view, or throws NotFound if the layer isn't on this map.
 */
export async function resetRasterForRetry(mapId: string, layerId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .update(geoRasterLayers)
      .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
      .where(and(
        eq(geoRasterLayers.id, layerId),
        eq(geoRasterLayers.mapId, mapId),
        eq(geoRasterLayers.status, "error"),
      ))
      .returning();
    if (row) return rowToApi(row);

    // The failed conditional update is intentionally followed by a read only
    // to choose the correct HTTP error. It never drives another write, so two
    // retry requests cannot both transition the same row.
    const current = await tx
      .select({ mapId: geoRasterLayers.mapId, status: geoRasterLayers.status })
      .from(geoRasterLayers)
      .where(eq(geoRasterLayers.id, layerId))
      .limit(1);
    if (!current[0] || current[0].mapId !== mapId) throw NotFound("Raster layer not found");
    if (current[0].status === "queued" || current[0].status === "processing") {
      throw Conflict("Raster layer is already being processed");
    }
    if (current[0].status === "processed") {
      throw Conflict("Raster layer is already processed");
    }
    throw Conflict("Raster layer cannot be retried from its current state");
  });
}

export async function deleteRasterLayer(mapId: string, layerId: string, actorId: string) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    await deleteRasterLayerRecord(tx, mapId, layerId);
  });
}

/** Roll back a just-created row when pg-boss did not acknowledge its job. */
export async function compensateRasterLayerCreation(mapId: string, layerId: string) {
  await getDb().transaction((tx) => deleteRasterLayerRecord(tx, mapId, layerId, true));
}

async function deleteRasterLayerRecord(
  tx: any,
  mapId: string,
  layerId: string,
  allowMissing = false,
) {
  const rows = await tx
    .select({ id: geoRasterLayers.id })
    .from(geoRasterLayers)
    .where(and(eq(geoRasterLayers.id, layerId), eq(geoRasterLayers.mapId, mapId)))
    .limit(1)
    .for("update");
  if (!rows[0] && !allowMissing) throw NotFound("Raster layer not found");
  // Deleting the row is the tombstone observed by a concurrent long-running
  // worker. Its final conditional UPDATE then fails and it discards output.
  await enqueueStorageDirectoryCleanup(
    tx,
    buildGeoRasterDir(mapId, layerId),
    `geo:raster:${layerId}`,
  );
  if (!rows[0]) return;
  const deleted = await tx
    .delete(geoRasterLayers)
    .where(and(eq(geoRasterLayers.id, layerId), eq(geoRasterLayers.mapId, mapId)))
    .returning({ id: geoRasterLayers.id });
  if (deleted.length !== 1) throw NotFound("Raster layer not found");
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
