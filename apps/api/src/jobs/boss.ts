import PgBoss from "pg-boss";
import { env } from "../lib/env.js";

/**
 * pg-boss queue for raster (orthophoto) processing. We use pg-boss (backed by
 * the existing Postgres) instead of Redis/BullMQ so no new infrastructure is
 * needed. The API process enqueues; a separate worker process (worker.ts)
 * consumes — both call getBoss(), each in their own process with its own pool.
 */
export const RASTER_QUEUE = "process-raster";

export type RasterJob = { mapId: string; rasterLayerId: string };

// A 5 GB COG build can run for many minutes — well past pg-boss's 15-min default
// job expiration, which would otherwise let a job be re-fetched while still
// running. Give jobs 4 h and one retry for transient failures.
const RASTER_QUEUE_OPTIONS = {
  name: RASTER_QUEUE,
  expireInSeconds: 4 * 60 * 60,
  retryLimit: 1,
  retryDelay: 60,
} as const;

let _boss: PgBoss | null = null;
let _starting: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  if (!_starting) {
    _starting = (async () => {
      if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for pg-boss");
      // No cron scheduling needed. start() installs the pgboss schema (idempotent).
      const boss = new PgBoss({ connectionString: env.DATABASE_URL, schedule: false });
      boss.on("error", (err) => console.error("[pg-boss] error", err));
      await boss.start();
      // In pg-boss v10 each queue is a partition; it must exist before send/work.
      // create_queue is idempotent (ON CONFLICT DO NOTHING). updateQueue then
      // applies our expiration/retry config even if the queue already existed
      // (e.g. created earlier with defaults).
      await boss.createQueue(RASTER_QUEUE, RASTER_QUEUE_OPTIONS);
      await boss.updateQueue(RASTER_QUEUE, RASTER_QUEUE_OPTIONS);
      _boss = boss;
      return boss;
    })().catch((err) => {
      _starting = null; // allow a later retry instead of caching the failure
      throw err;
    });
  }
  return _starting;
}

/** Enqueue an orthophoto for COG processing. Returns the job id (or null). */
export async function enqueueRasterProcessing(job: RasterJob): Promise<string | null> {
  const boss = await getBoss();
  // Per-job options mirror the queue defaults so expiration/retry apply even if
  // an older queue definition is still around.
  return boss.send(RASTER_QUEUE, job, {
    expireInSeconds: RASTER_QUEUE_OPTIONS.expireInSeconds,
    retryLimit: RASTER_QUEUE_OPTIONS.retryLimit,
    retryDelay: RASTER_QUEUE_OPTIONS.retryDelay,
  });
}

/** Stop the boss cleanly (graceful shutdown). */
export async function stopBoss(): Promise<void> {
  const boss = _boss;
  _boss = null;
  _starting = null;
  if (boss) await boss.stop();
}
