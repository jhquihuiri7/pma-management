import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { env } from "../lib/env.js";
import {
  getStorage,
  buildGeoRasterCogPath,
  buildGeoRasterTmpDir,
  buildGeoRasterLogPath,
  buildGeoRasterOriginalDir,
} from "../storage/index.js";
import { getRasterRow, markRasterProcessed, markRasterError } from "../modules/geo/rasterLayersModule.js";
import { gdalInfo, buildCog, resolveGdalInput } from "./gdal.js";
import type { RasterJob } from "./boss.js";

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
    console.warn(`[worker] raster ${rasterLayerId} no longer exists — skipping`);
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
      await markRasterError(rasterLayerId, input.message);
      await storage.deleteDir(tmpRel).catch(() => {});
      return;
    }

    // 1) Validate + read metadata.
    const info = await gdalInfo(input.path, logPath);
    if (!info.crsWkt) {
      await markRasterError(
        rasterLayerId,
        "La ortofoto no tiene sistema de coordenadas (CRS). Sube un GeoTIFF georreferenciado o incluye los archivos .prj/.tfw.",
      );
      await storage.deleteDir(tmpRel).catch(() => {});
      return;
    }

    // 2) Build the COG in tmp, then move it into cog/ (avoids a partial COG at
    //    the final path if the build is interrupted).
    await buildCog(input.path, absTmpCog, info, logPath);
    await fs.mkdir(dirname(absCog), { recursive: true });
    await fs.rename(absTmpCog, absCog);

    // 3) Persist metadata.
    await markRasterProcessed(rasterLayerId, {
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
    });

    // 4) Cleanup. Optionally drop the original once the COG exists.
    await storage.deleteDir(tmpRel).catch(() => {});
    if (!env.RASTER_KEEP_ORIGINAL) {
      await storage.deleteDir(buildGeoRasterOriginalDir(mapId, rasterLayerId)).catch(() => {});
    }

    console.log(`[worker] raster ${rasterLayerId} processed → ${cogRel}`);
  } catch (err) {
    await storage.deleteDir(tmpRel).catch(() => {});
    throw err; // worker.ts marks the row 'error' and lets pg-boss record the failure
  }
}
