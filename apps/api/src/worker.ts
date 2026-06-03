import "dotenv/config";
import { env } from "./lib/env.js";
import { getBoss, stopBoss, RASTER_QUEUE, type RasterJob } from "./jobs/boss.js";
import { markRasterProcessing, markRasterError } from "./modules/geo/rasterLayersModule.js";
import { processRaster } from "./jobs/processRaster.js";

/**
 * Standalone worker process that consumes raster-processing jobs. Runs in its
 * own Docker image (apps/api/Dockerfile.worker) which bundles GDAL, so heavy COG
 * generation never blocks the API event loop and GDAL is never installed on the
 * host. Concurrency is bounded by WORKER_CONCURRENCY (default 1) → at most one
 * GDAL run at a time on the shared host.
 */
async function processJob(job: RasterJob): Promise<void> {
  const { mapId, rasterLayerId } = job;
  const exists = await markRasterProcessing(rasterLayerId);
  if (!exists) {
    console.warn(`[worker] raster ${rasterLayerId} no longer exists — skipping`);
    return;
  }
  console.log(`[worker] processing raster ${rasterLayerId} (map ${mapId})`);
  await processRaster(job);
}

async function main() {
  const boss = await getBoss();

  await boss.work<RasterJob>(
    RASTER_QUEUE,
    { batchSize: env.WORKER_CONCURRENCY },
    async (jobs) => {
      // pg-boss v10 hands the handler a batch; process sequentially so two heavy
      // GDAL runs never overlap regardless of batchSize.
      for (const job of jobs) {
        try {
          await processJob(job.data);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[worker] job ${job.id} failed:`, msg);
          await markRasterError(job.data.rasterLayerId, msg).catch(() => {});
          throw err; // let pg-boss record the failure for this job
        }
      }
    }
  );

  console.log(`[worker] listening on "${RASTER_QUEUE}" (batchSize=${env.WORKER_CONCURRENCY})`);
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received — stopping…`);
  await stopBoss().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
