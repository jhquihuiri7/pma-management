import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { storageCleanupJobs } from "../../db/schema/shared.js";
import { pmaEvidences, pmaFormats } from "../../db/schema/pma.js";
import { rgdpEvidences, rgdpFormats } from "../../db/schema/rgdp.js";
import { geoRasterLayers } from "../../db/schema/geo.js";
import { getStorage, type StorageProvider } from "../../storage/index.js";

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Subsystem = "pma" | "rgdp";
type StorageCleanupJob = typeof storageCleanupJobs.$inferSelect;

export type StorageCleanupOutcome = "processed" | "referenced" | "queued" | "failed";

/** Queue evidence files before deleting an item; call inside the delete transaction. */
export async function enqueueEvidenceCleanupForItem(
  tx: DbTransaction,
  subsystem: Subsystem,
  planItemId: string
): Promise<number> {
  const table = subsystem === "pma" ? pmaEvidences : rgdpEvidences;
  const rows = await tx
    .select({ storagePath: table.storagePath })
    .from(table)
    .where(eq(table.planItemId, planItemId));
  return enqueueStorageCleanupPaths(tx, rows.map((row) => row.storagePath), `${subsystem}:plan-item:${planItemId}`);
}

/** Queue evidence files before deleting a plan; call inside the delete transaction. */
export async function enqueueEvidenceCleanupForPlan(
  tx: DbTransaction,
  subsystem: Subsystem,
  planId: string
): Promise<number> {
  const table = subsystem === "pma" ? pmaEvidences : rgdpEvidences;
  const rows = await tx
    .select({ storagePath: table.storagePath })
    .from(table)
    .where(eq(table.planId, planId));
  return enqueueStorageCleanupPaths(tx, rows.map((row) => row.storagePath), `${subsystem}:plan:${planId}`);
}

/** Queue arbitrary now-or-soon-unreferenced paths in a caller-owned transaction. */
export async function enqueueStorageCleanupPaths(
  tx: DbTransaction,
  paths: string[],
  reason: string
): Promise<number> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return 0;
  await tx
    .insert(storageCleanupJobs)
    .values(uniquePaths.map((storagePath) => ({ storagePath, reason })))
    .onConflictDoNothing({ target: storageCleanupJobs.storagePath });
  return uniquePaths.length;
}

/** Queue a directory after its owning database aggregate has been deleted. */
export async function enqueueStorageDirectoryCleanup(
  tx: DbTransaction,
  storagePath: string,
  reason: string
): Promise<void> {
  await tx
    .insert(storageCleanupJobs)
    .values({ storagePath, reason, isDirectory: true })
    .onConflictDoNothing({ target: storageCleanupJobs.storagePath });
}

/**
 * Crash-safe directory removal for worker-side artifacts.
 *
 * The cleanup intent is committed before touching storage. We then claim that
 * exact outbox row, delete the directory, verify its absence and only then
 * remove the intent. A crash at any point leaves a durable row for the normal
 * cleanup drain. If another drain already owns the row, this call deliberately
 * does no competing filesystem work and reports `queued`.
 */
export async function cleanupStorageDirectoryDurably(
  storagePath: string,
  reason: string,
  options: { storage?: StorageProvider } = {},
): Promise<StorageCleanupOutcome> {
  const db = getDb();
  const storage = options.storage ?? getStorage();
  await db.transaction((tx) => enqueueStorageDirectoryCleanup(tx, storagePath, reason));

  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000);
  const claimTime = new Date();
  const [job] = await db
    .update(storageCleanupJobs)
    .set({ lockedAt: claimTime })
    .where(and(
      eq(storageCleanupJobs.storagePath, storagePath),
      eq(storageCleanupJobs.isDirectory, true),
      lte(storageCleanupJobs.availableAt, now),
      or(isNull(storageCleanupJobs.lockedAt), lt(storageCleanupJobs.lockedAt, staleLock)),
    ))
    .returning();

  if (!job) return "queued";
  return finishClaimedStorageCleanup(db, storage, job, claimTime);
}

/**
 * Best-effort outbox drain. Failed rows remain durable and are retried by the
 * worker. A path is deleted only after confirming no evidence/format row still
 * references it (important for legacy duplicate paths).
 */
export async function processPendingStorageCleanup(limit = 100): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const now = new Date();
  const staleLock = new Date(now.getTime() - 5 * 60_000);
  const claimable = or(isNull(storageCleanupJobs.lockedAt), lt(storageCleanupJobs.lockedAt, staleLock));
  const jobs = await db
    .select()
    .from(storageCleanupJobs)
    .where(and(lte(storageCleanupJobs.availableAt, now), claimable))
    .orderBy(asc(storageCleanupJobs.availableAt))
    .limit(limit);
  let processed = 0;
  let failed = 0;

  for (const candidate of jobs) {
    const claimTime = new Date();
    const [job] = await db
      .update(storageCleanupJobs)
      .set({ lockedAt: claimTime })
      .where(and(
        eq(storageCleanupJobs.id, candidate.id),
        lte(storageCleanupJobs.availableAt, now),
        or(isNull(storageCleanupJobs.lockedAt), lt(storageCleanupJobs.lockedAt, staleLock)),
      ))
      .returning();
    if (!job) continue;
    const outcome = await finishClaimedStorageCleanup(db, getStorage(), job, claimTime);
    if (outcome === "processed") {
      processed += 1;
    } else if (outcome === "failed") {
      failed += 1;
    }
  }
  return { processed, failed };
}

async function finishClaimedStorageCleanup(
  db: ReturnType<typeof getDb>,
  storage: StorageProvider,
  job: StorageCleanupJob,
  claimTime: Date,
): Promise<Exclude<StorageCleanupOutcome, "queued">> {
  try {
    if (await isPathStillReferenced(db, job.storagePath)) {
      // A legacy path can be shared by several rows. Keep the durable intent
      // and move it to the back of the queue until the final reference is gone.
      await db
        .update(storageCleanupJobs)
        .set({ availableAt: new Date(Date.now() + 5 * 60_000), lockedAt: null })
        .where(and(eq(storageCleanupJobs.id, job.id), eq(storageCleanupJobs.lockedAt, claimTime)));
      return "referenced";
    }
    if (job.isDirectory) await storage.deleteDir(job.storagePath);
    else await storage.delete(job.storagePath);
    if (await storage.exists(job.storagePath)) {
      throw new Error(`Storage did not confirm cleanup: ${job.storagePath}`);
    }
    await db
      .delete(storageCleanupJobs)
      .where(and(eq(storageCleanupJobs.id, job.id), eq(storageCleanupJobs.lockedAt, claimTime)));
    return "processed";
  } catch (error) {
    const attempts = job.attempts + 1;
    const delayMs = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempts, 10));
    await db
      .update(storageCleanupJobs)
      .set({
        attempts,
        availableAt: new Date(Date.now() + delayMs),
        lockedAt: null,
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      })
      .where(and(eq(storageCleanupJobs.id, job.id), eq(storageCleanupJobs.lockedAt, claimTime)));
    return "failed";
  }
}

async function isPathStillReferenced(
  db: ReturnType<typeof getDb>,
  storagePath: string,
): Promise<boolean> {
  // A whole-raster cleanup is safe only after its catalog row has disappeared.
  // This also prevents a delayed cleanup intent from deleting a valid layer if
  // a stale job races a later processing attempt that uses the same UUID.
  const rasterDirectory = /^GEO\/maps\/([0-9a-f-]+)\/rasters\/([0-9a-f-]+)$/i.exec(storagePath);
  if (rasterDirectory) {
    const rows = await db
      .select({ id: geoRasterLayers.id })
      .from(geoRasterLayers)
      .where(and(
        eq(geoRasterLayers.mapId, rasterDirectory[1]),
        eq(geoRasterLayers.id, rasterDirectory[2]),
      ))
      .limit(1);
    if (rows.length > 0) return true;
  }
  // A failed cleanup from one raster attempt must not erase the tmp directory
  // of a later queued/running retry that reuses the same layer UUID.
  const rasterTmp = /^GEO\/maps\/[0-9a-f-]+\/rasters\/([0-9a-f-]+)\/tmp$/i.exec(storagePath);
  if (rasterTmp) {
    const rows = await db
      .select({ status: geoRasterLayers.status })
      .from(geoRasterLayers)
      .where(eq(geoRasterLayers.id, rasterTmp[1]))
      .limit(1);
    if (rows[0]?.status === "queued" || rows[0]?.status === "processing") return true;
  }
  const lookups = await Promise.all([
    db.select({ id: pmaEvidences.id }).from(pmaEvidences).where(eq(pmaEvidences.storagePath, storagePath)).limit(1),
    db.select({ id: rgdpEvidences.id }).from(rgdpEvidences).where(eq(rgdpEvidences.storagePath, storagePath)).limit(1),
    db.select({ id: pmaFormats.id }).from(pmaFormats).where(eq(pmaFormats.storagePath, storagePath)).limit(1),
    db.select({ id: rgdpFormats.id }).from(rgdpFormats).where(eq(rgdpFormats.storagePath, storagePath)).limit(1),
  ]);
  return lookups.some((rows) => rows.length > 0);
}
