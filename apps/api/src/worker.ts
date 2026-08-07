import "dotenv/config";
import { env } from "./lib/env.js";
import {
  enqueueRasterProcessing,
  getBoss,
  stopBoss,
  RASTER_QUEUE,
  type RasterJob,
} from "./jobs/boss.js";
import {
  listQueuedRasterJobs,
  markRasterProcessing,
  markRasterError,
} from "./modules/geo/rasterLayersModule.js";
import { processRaster } from "./jobs/processRaster.js";
import {
  cleanupStorageDirectoryDurably,
  processPendingStorageCleanup,
} from "./modules/shared/storageCleanup.js";
import { buildGeoRasterDir } from "./storage/index.js";
import { processPendingMail } from "./modules/shared/mailOutbox.js";
import { runPrevieneSync } from "./modules/previene/syncModule.js";
import { isPrevieneConfigured } from "./modules/previene/client.js";
import { closeMail } from "./mail/index.js";
import { closeDb } from "./db/client.js";

const STORAGE_CLEANUP_INTERVAL_MS = 30_000;
const MAIL_OUTBOX_INTERVAL_MS = 15_000;
const RASTER_RECONCILE_INTERVAL_MS = 60_000;
let cleanupTimer: NodeJS.Timeout | undefined;
let mailTimer: NodeJS.Timeout | undefined;
let rasterReconcileTimer: NodeJS.Timeout | undefined;
let previeneTimer: NodeJS.Timeout | undefined;
let cleanupPromise: Promise<void> | null = null;
let mailPromise: Promise<void> | null = null;
let rasterReconcilePromise: Promise<void> | null = null;
let previenePromise: Promise<void> | null = null;
let shuttingDown = false;

async function drainStorageCleanup(): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const result = await processPendingStorageCleanup();
    if (result.processed > 0 || result.failed > 0) {
      console.log(`[worker] storage cleanup: ${result.processed} processed, ${result.failed} failed`);
    }
  })().finally(() => { cleanupPromise = null; });
  return cleanupPromise;
}

async function drainMailOutbox(): Promise<void> {
  if (mailPromise) return mailPromise;
  mailPromise = (async () => {
    const result = await processPendingMail();
    if (result.sent > 0 || result.failed > 0 || result.expired > 0) {
      console.log(`[worker] mail outbox: ${result.sent} sent, ${result.failed} failed, ${result.expired} expired`);
    }
  })().finally(() => { mailPromise = null; });
  return mailPromise;
}

async function reconcileQueuedRasters(): Promise<void> {
  if (rasterReconcilePromise) return rasterReconcilePromise;
  rasterReconcilePromise = (async () => {
    const jobs = await listQueuedRasterJobs();
    let recovered = 0;
    for (const job of jobs) {
      // The queue's stately singleton key makes this idempotent when the
      // original enqueue succeeded but its HTTP acknowledgement was lost.
      const operationId = await enqueueRasterProcessing(job);
      if (operationId) recovered += 1;
    }
    if (recovered > 0) {
      console.log(`[worker] recovered ${recovered} interrupted raster enqueue(s)`);
    }
  })().finally(() => { rasterReconcilePromise = null; });
  return rasterReconcilePromise;
}

/**
 * Pull new and modified citizen reports from the Galápagos Previene API.
 *
 * Runs here rather than in the API process so a slow upstream never occupies
 * the request event loop, and so exactly one poller exists no matter how many
 * API replicas are running. A second worker is safe but pointless: the run
 * takes an exclusive advisory lock for its whole duration, so the loser is
 * turned away with `skipped/locked` rather than duplicating the walk.
 */
async function syncPreviene(): Promise<void> {
  if (previenePromise) return previenePromise;
  previenePromise = (async () => {
    const result = await runPrevieneSync();
    if (result.status === "ok" && result.reports > 0) {
      console.log(`[worker] previene: ${result.reports} report(s) in ${result.pages} page(s)`);
    } else if (result.status === "error") {
      // Transient failures are expected (upstream restarts); they are recorded
      // in previene_sync_state so the viewer can explain the stale data.
      console.error(`[worker] previene sync failed (retryable=${result.retryable}): ${result.message}`);
    }
  })().finally(() => { previenePromise = null; });
  return previenePromise;
}

/**
 * Standalone worker process that consumes raster-processing jobs. Runs in its
 * own Docker image (apps/api/Dockerfile.worker) which bundles GDAL, so heavy COG
 * generation never blocks the API event loop and GDAL is never installed on the
 * host. Concurrency is bounded by WORKER_CONCURRENCY (default 1) → at most one
 * GDAL run at a time on the shared host.
 */
async function processJob(job: RasterJob): Promise<void> {
  const { mapId, rasterLayerId } = job;
  const claim = await markRasterProcessing(mapId, rasterLayerId);
  if (claim === "missing") {
    // A deleted row is not enough to prove storage is clean: an in-flight GDAL
    // process may have recreated the directory after the delete outbox ran.
    // Persist this second cleanup intent before attempting the verified delete.
    const outcome = await cleanupStorageDirectoryDurably(
      buildGeoRasterDir(mapId, rasterLayerId),
      `geo:raster-missing-before-processing:${rasterLayerId}`,
    );
    console.warn(`[worker] raster ${rasterLayerId} no longer exists — directory cleanup ${outcome}`);
    return;
  }
  if (claim === "unavailable") {
    console.warn(`[worker] raster ${rasterLayerId} is already finalized — skipping stale job`);
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
          try {
            await markRasterError(job.data.mapId, job.data.rasterLayerId, msg);
          } catch (markError) {
            console.error(`[worker] could not persist error state for raster ${job.data.rasterLayerId}:`, markError);
          }
          throw err; // let pg-boss record the failure for this job
        }
      }
    }
  );

  await drainStorageCleanup().catch((err) => console.error("[worker] initial storage cleanup failed:", err));
  cleanupTimer = setInterval(() => {
    void drainStorageCleanup().catch((err) => console.error("[worker] storage cleanup failed:", err));
  }, STORAGE_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  await drainMailOutbox().catch((err) => console.error("[worker] initial mail delivery failed:", err));
  mailTimer = setInterval(() => {
    void drainMailOutbox().catch((err) => console.error("[worker] mail delivery failed:", err));
  }, MAIL_OUTBOX_INTERVAL_MS);
  mailTimer.unref();
  await reconcileQueuedRasters().catch((err) => console.error("[worker] initial raster reconciliation failed:", err));
  rasterReconcileTimer = setInterval(() => {
    void reconcileQueuedRasters().catch((err) => console.error("[worker] raster reconciliation failed:", err));
  }, RASTER_RECONCILE_INTERVAL_MS);
  rasterReconcileTimer.unref();

  if (isPrevieneConfigured()) {
    await syncPreviene().catch((err) => console.error("[worker] initial previene sync failed:", err));
    previeneTimer = setInterval(() => {
      void syncPreviene().catch((err) => console.error("[worker] previene sync failed:", err));
    }, env.PREVIENE_SYNC_INTERVAL_MS);
    previeneTimer.unref();
    console.log(`[worker] previene sync every ${Math.round(env.PREVIENE_SYNC_INTERVAL_MS / 1000)}s`);
  } else {
    console.warn("[worker] previene sync disabled — PREVIENE_API_KEY is not set");
  }

  console.log(`[worker] listening on "${RASTER_QUEUE}" (batchSize=${env.WORKER_CONCURRENCY})`);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received — stopping…`);
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (mailTimer) clearInterval(mailTimer);
  if (rasterReconcileTimer) clearInterval(rasterReconcileTimer);
  if (previeneTimer) clearInterval(previeneTimer);
  await stopBoss().catch((error) => console.error("[worker] failed to stop pg-boss:", error));
  await Promise.allSettled(
    [cleanupPromise, mailPromise, rasterReconcilePromise, previenePromise].filter(Boolean) as Promise<void>[]
  );
  await closeMail().catch((error) => console.error("[worker] failed to close SMTP:", error));
  await closeDb().catch((error) => console.error("[worker] failed to close database pool:", error));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
