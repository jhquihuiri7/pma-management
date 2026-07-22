import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { geoMaps, geoRasterLayers } from "../db/schema/geo.js";
import { storageCleanupJobs, users } from "../db/schema/shared.js";
import {
  beginRasterProcessingStorageIntent,
  markRasterProcessed,
  markRasterProcessing,
  resetRasterForRetry,
} from "../modules/geo/rasterLayersModule.js";
import { cleanupStorageDirectoryDurably } from "../modules/shared/storageCleanup.js";
import { buildGeoRasterDir, type StorageProvider } from "../storage/index.js";
import { SynologySmbStorage } from "../storage/synology-smb.js";

test(
  "raster retries are atomic and whole-directory cleanup is durable and reference-safe",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const mapId = randomUUID();
    const rasterLayerId = randomUUID();
    const successfulLayerId = randomUUID();
    const missingLayerId = randomUUID();
    const failingLayerId = randomUUID();
    const rasterDirectory = buildGeoRasterDir(mapId, rasterLayerId);
    const successfulDirectory = buildGeoRasterDir(mapId, successfulLayerId);
    const missingDirectory = buildGeoRasterDir(mapId, missingLayerId);
    const failingDirectory = buildGeoRasterDir(mapId, failingLayerId);
    const storageRoot = await mkdtemp(join(tmpdir(), "pma-raster-lifecycle-"));
    const storage = new SynologySmbStorage(storageRoot, "/storage");

    try {
      await db.insert(users).values({
        id: userId,
        email: `raster-lifecycle-${userId}@example.invalid`,
        name: "Raster lifecycle test",
        role: "ADMIN",
      });
      await db.insert(geoMaps).values({
        id: mapId,
        title: "Raster lifecycle map",
        categoryId: "test",
        layers: [],
        centerLat: -0.9,
        centerLng: -89.6,
        createdBy: userId,
      });
      await db.insert(geoRasterLayers).values([
        {
          id: rasterLayerId,
          mapId,
          name: "Raster lifecycle layer",
          status: "error",
          errorMessage: "transient failure",
          originalFilename: "source.tif",
          originalPath: `${rasterDirectory}/original/source.tif`,
          sizeBytes: 4,
          createdBy: userId,
        },
        {
          id: successfulLayerId,
          mapId,
          name: "Successful raster lifecycle layer",
          status: "processing",
          originalFilename: "successful.tif",
          originalPath: `${successfulDirectory}/original/successful.tif`,
          sizeBytes: 4,
          createdBy: userId,
        },
      ]);

      // Both callers observe the same initial error state, but the conditional
      // UPDATE permits exactly one error -> queued transition.
      const retries = await Promise.allSettled([
        resetRasterForRetry(mapId, rasterLayerId, userId),
        resetRasterForRetry(mapId, rasterLayerId, userId),
      ]);
      assert.equal(retries.filter((result) => result.status === "fulfilled").length, 1);
      const rejectedRetry = retries.find((result) => result.status === "rejected");
      assert.ok(rejectedRetry && rejectedRetry.status === "rejected");
      assert.equal(httpStatus(rejectedRetry.reason), 409);

      // Wrong-map and absent ids remain 404s; neither can mutate this row.
      await assert.rejects(
        resetRasterForRetry(randomUUID(), rasterLayerId, userId),
        (error: unknown) => httpStatus(error) === 404,
      );
      await assert.rejects(
        resetRasterForRetry(mapId, randomUUID(), userId),
        (error: unknown) => httpStatus(error) === 404,
      );
      assert.equal(await markRasterProcessing(mapId, rasterLayerId), "claimed");
      assert.equal(
        await markRasterProcessing(mapId, rasterLayerId),
        "claimed",
        "a pg-boss retry must reclaim processing after a hard worker crash",
      );

      const processingIntent = await beginRasterProcessingStorageIntent(mapId, rasterLayerId);
      assert.equal(processingIntent.status, "started");
      assert.ok(processingIntent.status === "started");

      // A normal successful transition consumes its processing intent in the
      // same transaction that makes the COG visible in the catalog.
      const successfulIntent = await beginRasterProcessingStorageIntent(mapId, successfulLayerId);
      assert.equal(successfulIntent.status, "started");
      assert.ok(successfulIntent.status === "started");
      assert.equal(await markRasterProcessed(
        successfulLayerId,
        rasterMeta(`${successfulDirectory}/cog/cog.tif`),
        successfulIntent.intentId,
      ), true);
      const successfulCleanupRows = await db
        .select({ id: storageCleanupJobs.id })
        .from(storageCleanupJobs)
        .where(eq(storageCleanupJobs.storagePath, successfulDirectory));
      assert.equal(successfulCleanupRows.length, 0);

      // A valid catalog reference protects the complete raster directory from
      // a delayed/stale cleanup intent.
      await storage.upload({ path: `${rasterDirectory}/cog/cog.tif`, data: Buffer.from("cog") });
      const referenced = await cleanupStorageDirectoryDurably(
        rasterDirectory,
        `test:referenced:${rasterLayerId}`,
        { storage },
      );
      assert.equal(referenced, "referenced");
      assert.equal(await storage.exists(rasterDirectory), true);

      // Simulate catalog deletion after output was recreated and the worker
      // crashed before markRasterProcessed. The pre-GDAL processing intent is
      // still the deletion intent; once due, it removes and verifies the tree.
      await db.delete(geoRasterLayers).where(eq(geoRasterLayers.id, rasterLayerId));
      await db
        .update(storageCleanupJobs)
        .set({ availableAt: new Date(0), lockedAt: null })
        .where(eq(storageCleanupJobs.storagePath, rasterDirectory));
      const removed = await cleanupStorageDirectoryDurably(
        rasterDirectory,
        `test:deleted:${rasterLayerId}`,
        { storage },
      );
      assert.equal(removed, "processed");
      assert.equal(await storage.exists(rasterDirectory), false);
      const completedIntent = await db
        .select({ id: storageCleanupJobs.id })
        .from(storageCleanupJobs)
        .where(eq(storageCleanupJobs.storagePath, rasterDirectory));
      assert.equal(completedIntent.length, 0);

      // Missing queue targets are explicitly distinguishable from finalized
      // rows, allowing worker.ts to schedule the same durable cleanup protocol.
      assert.equal(await markRasterProcessing(mapId, missingLayerId), "missing");
      await storage.upload({ path: `${missingDirectory}/cog/cog.tif`, data: Buffer.from("late") });
      const missingRemoved = await cleanupStorageDirectoryDurably(
        missingDirectory,
        `test:missing:${missingLayerId}`,
        { storage },
      );
      assert.equal(missingRemoved, "processed");
      assert.equal(await storage.exists(missingDirectory), false);

      // A storage failure is reported as failure, but never loses the intent;
      // the normal worker drain can retry it after its backoff.
      await storage.upload({ path: `${failingDirectory}/tmp/partial.tif`, data: Buffer.from("partial") });
      const failingStorage = new Proxy(storage, {
        get(target, property, receiver) {
          if (property === "deleteDir") return async () => { throw new Error("storage unavailable"); };
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as StorageProvider;
      const failed = await cleanupStorageDirectoryDurably(
        failingDirectory,
        `test:failure:${failingLayerId}`,
        { storage: failingStorage },
      );
      assert.equal(failed, "failed");
      const [failedIntent] = await db
        .select({ attempts: storageCleanupJobs.attempts, lockedAt: storageCleanupJobs.lockedAt })
        .from(storageCleanupJobs)
        .where(eq(storageCleanupJobs.storagePath, failingDirectory));
      assert.equal(failedIntent?.attempts, 1);
      assert.equal(failedIntent?.lockedAt, null);
    } finally {
      await db.delete(storageCleanupJobs).where(inArray(storageCleanupJobs.storagePath, [
        rasterDirectory,
        successfulDirectory,
        missingDirectory,
        failingDirectory,
      ]));
      await db.delete(geoMaps).where(eq(geoMaps.id, mapId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDb();
      await rm(storageRoot, { recursive: true, force: true });
    }
  },
);

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function rasterMeta(cogPath: string) {
  return {
    cogPath,
    srid: 32715,
    crs: "EPSG:32715",
    bbox: [-91, -2, -89, 0],
    widthPx: 10,
    heightPx: 10,
    bandCount: 3,
    hasAlpha: false,
    resolutionX: 1,
    resolutionY: -1,
  };
}
