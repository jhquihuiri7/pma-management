import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { env } from "../lib/env.js";
import {
  getStorage,
  buildGeoRasterDir,
  buildGeoRasterCogPath,
  buildGeoRasterTmpDir,
  buildGeoRasterLogPath,
  buildGeoRasterOriginalDir,
} from "../storage/index.js";
import {
  beginRasterProcessingStorageIntent,
  getRasterRow,
  markRasterProcessed,
  markRasterError,
} from "../modules/geo/rasterLayersModule.js";
import { gdalInfo, buildCog, resolveGdalInput } from "./gdal.js";
import type { RasterJob } from "./boss.js";
import { cleanupStorageDirectoryDurably } from "../modules/shared/storageCleanup.js";

async function cleanupDirectory(path: string, reason: string): Promise<void> {
  const outcome = await cleanupStorageDirectoryDurably(path, reason);
  if (outcome === "failed") {
    console.warn(`[worker] directory cleanup failed (${reason}); durable retry remains queued`);
  } else if (outcome === "queued") {
    console.warn(`[worker] directory cleanup already owned or deferred (${reason})`);
  }
}

/**
 * Full COG pipeline for one orthophoto:
 *   gdalinfo (validate + metadata) → reject if no CRS → gdal_translate -of COG
 *   in the source CRS → move into cog/ → persist metadata → cleanup tmp.
 *
 * "Handled" failures (e.g. missing CRS) mark the row 'error' and return normally
 * so pg-boss does NOT retry them. Unexpected failures throw so the worker records
 * the error and pg-boss can retry transient problems.
 */
export async function processRaster(job: RasterJob): Promise<void> {
  const { mapId, rasterLayerId } = job;
  const storage = getStorage();

  const row = await getRasterRow(rasterLayerId);
  if (!row) {
    // Deletion can commit between the queue claim and this lookup. Register the
    // whole UUID-owned directory before touching storage so a concurrent GDAL
    // process or a crash cannot leave recreated artifacts untracked.
    await cleanupDirectory(
      buildGeoRasterDir(mapId, rasterLayerId),
      `geo:raster-missing-after-claim:${rasterLayerId}`,
    );
    console.warn(`[worker] raster ${rasterLayerId} no longer exists — cleanup confirmed or queued`);
    return;
  }
  if (row.mapId !== mapId) {
    throw new Error(`Raster job map mismatch for ${rasterLayerId}`);
  }

  // No GDAL output is written until a path-keyed cleanup intent is durable.
  // Successful metadata persistence finalizes it in the same DB transaction;
  // a hard crash or concurrent delete leaves it for the outbox drain.
  const processingIntent = await beginRasterProcessingStorageIntent(mapId, rasterLayerId);
  if (processingIntent.status === "missing") {
    await cleanupDirectory(
      buildGeoRasterDir(mapId, rasterLayerId),
      `geo:raster-missing-before-gdal:${rasterLayerId}`,
    );
    return;
  }
  if (processingIntent.status === "unavailable") {
    console.warn(`[worker] raster ${rasterLayerId} is no longer claimable — skipping GDAL`);
    return;
  }

  const logPath = storage.resolve(buildGeoRasterLogPath(mapId, rasterLayerId));
  const absInput = storage.resolve(row.originalPath);
  const cogRel = buildGeoRasterCogPath(mapId, rasterLayerId);
  const absCog = storage.resolve(cogRel);
  const tmpRel = buildGeoRasterTmpDir(mapId, rasterLayerId);
  const absTmp = storage.resolve(tmpRel);
  const absTmpCog = join(absTmp, "cog.tif");

  try {
    await fs.mkdir(absTmp, { recursive: true });

    // 0) Resolve the GDAL input. A .tif is opened directly; a .zip is opened via
    //    /vsizip/ pointed at the single .tif inside it. A handled zip problem
    //    (no/multiple rasters) marks the row 'error' without a pg-boss retry.
    const input = await resolveGdalInput(absInput, row.originalFilename, logPath);
    if (!input.ok) {
      await markRasterError(mapId, rasterLayerId, input.message);
      await cleanupDirectory(tmpRel, `geo:raster-invalid-zip:${rasterLayerId}`);
      return;
    }

    // 1) Validate + read metadata.
    const info = await gdalInfo(input.path, logPath);
    if (!info.crsWkt) {
      await markRasterError(
        mapId,
        rasterLayerId,
        "La ortofoto no tiene sistema de coordenadas (CRS). Sube un GeoTIFF georreferenciado o incluye los archivos .prj/.tfw.",
      );
      await cleanupDirectory(tmpRel, `geo:raster-missing-crs:${rasterLayerId}`);
      return;
    }

    // 2) Build the COG in tmp, then move it into cog/ (avoids a partial COG at
    //    the final path if the build is interrupted).
    await buildCog(input.path, absTmpCog, info, logPath);
    await fs.mkdir(dirname(absCog), { recursive: true });
    await fs.rename(absTmpCog, absCog);

    // 3) Persist metadata.
    const committed = await markRasterProcessed(
      rasterLayerId,
      {
        cogPath: cogRel,
        srid: info.srid,
        crs: info.srid ? `EPSG:${info.srid}` : null,
        bbox: info.bbox4326 ?? null,
        widthPx: info.width || null,
        heightPx: info.height || null,
        bandCount: info.bandCount || null,
        hasAlpha: info.hasAlpha,
        resolutionX: info.resolutionX,
        resolutionY: info.resolutionY,
      },
      processingIntent.intentId,
    );

    // Deletion can race with a long GDAL process. The catalog transition is
    // conditional on status=processing; when it loses that race, remove every
    // artifact the worker may have recreated after the delete request.
    if (!committed) {
      await cleanupDirectory(
        buildGeoRasterDir(mapId, rasterLayerId),
        `geo:raster-deleted-during-processing:${rasterLayerId}`,
      );
      console.warn(`[worker] raster ${rasterLayerId} lost its catalog transition — output cleanup confirmed or queued`);
      return;
    }

    // 4) Cleanup. Optionally drop the original once the COG exists.
    await cleanupDirectory(tmpRel, `geo:raster-tmp:${rasterLayerId}`);
    if (!env.RASTER_KEEP_ORIGINAL) {
      await cleanupDirectory(
        buildGeoRasterOriginalDir(mapId, rasterLayerId),
        `geo:raster-original:${rasterLayerId}`,
      );
    }

    console.log(`[worker] raster ${rasterLayerId} processed → ${cogRel}`);
  } catch (err) {
    await cleanupDirectory(tmpRel, `geo:raster-error-tmp:${rasterLayerId}`);
    throw err; // worker.ts marks the row 'error' and lets pg-boss record the failure
  }
}
