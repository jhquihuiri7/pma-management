import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db/client.js";
import { storageCleanupJobs } from "../../db/schema/shared.js";
import {
  getStorage,
  persistFileAndRecord,
  type StorageProvider,
} from "../../storage/index.js";

type Database = ReturnType<typeof getDb>;
type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DurableStorageIntent = {
  id: string;
  storagePath: string;
  isDirectory: boolean;
  finalize<T>(
    persist: (tx: DbTransaction) => Promise<T>,
    options?: { beforeIntentLock?: (tx: DbTransaction) => Promise<void> },
  ): Promise<T>;
  compensate(): Promise<void>;
};

/**
 * Reserve a unique file/directory before streaming bytes to storage. This is
 * the lower-level counterpart of persistDurableFileAndRecord for uploads made
 * of several files or streams that cannot be held in one Buffer.
 */
export async function beginDurableStorageIntent(args: {
  path: string;
  reason: string;
  isDirectory?: boolean;
  availableAfterMs?: number;
  storage?: StorageProvider;
  db?: Database;
}): Promise<DurableStorageIntent> {
  const db = args.db ?? getDb();
  const storage = args.storage ?? getStorage();
  const isDirectory = args.isDirectory ?? false;
  if (await storage.exists(args.path)) {
    throw new Error(`Refusing to overwrite an existing storage object: ${args.path}`);
  }

  const intentId = randomUUID();
  const [intent] = await db
    .insert(storageCleanupJobs)
    .values({
      id: intentId,
      storagePath: args.path,
      reason: `upload-intent:${args.reason}`,
      isDirectory,
      availableAt: new Date(Date.now() + (args.availableAfterMs ?? 60 * 60_000)),
    })
    .onConflictDoNothing({ target: storageCleanupJobs.storagePath })
    .returning({ id: storageCleanupJobs.id });
  if (!intent) {
    throw new Error(`A persistence intent already exists for storage object: ${args.path}`);
  }

  let finalized = false;
  return {
    id: intentId,
    storagePath: args.path,
    isDirectory,
    async finalize<T>(
      persist: (tx: DbTransaction) => Promise<T>,
      options: { beforeIntentLock?: (tx: DbTransaction) => Promise<void> } = {},
    ): Promise<T> {
      if (finalized) throw new Error("Durable upload intent was already finalized");
      if (!(await storage.exists(args.path))) {
        throw new Error(`Storage did not confirm the staged upload: ${args.path}`);
      }
      const result = await db.transaction(async (tx) => {
        // Authorization must be the first logical lock for business writes.
        // GEO streaming uploads use this hook to revalidate the actor before
        // locking the storage intent and the target aggregate.
        await options.beforeIntentLock?.(tx);
        const [lockedIntent] = await tx
          .select({ id: storageCleanupJobs.id })
          .from(storageCleanupJobs)
          .where(eq(storageCleanupJobs.id, intentId))
          .limit(1)
          .for("update");
        if (!lockedIntent) throw new Error("Durable upload intent disappeared before commit");
        const persisted = await persist(tx);
        const removed = await tx
          .delete(storageCleanupJobs)
          .where(eq(storageCleanupJobs.id, intentId))
          .returning({ id: storageCleanupJobs.id });
        if (removed.length !== 1) throw new Error("Durable upload intent was not finalized");
        return persisted;
      });
      finalized = true;
      return result;
    },
    async compensate(): Promise<void> {
      if (finalized) return;
      if (isDirectory) await storage.deleteDir(args.path);
      else await storage.delete(args.path);
      if (await storage.exists(args.path)) {
        throw new Error(`Storage did not confirm upload compensation: ${args.path}`);
      }
      await db.delete(storageCleanupJobs).where(eq(storageCleanupJobs.id, intentId));
      finalized = true;
    },
  };
}

/**
 * Crash-safe coordination for the filesystem + PostgreSQL boundary.
 *
 * The cleanup row is committed before writing bytes. The business row and the
 * removal of that cleanup row then commit in one DB transaction. A process
 * crash anywhere between those points leaves a durable cleanup job instead of
 * an untracked orphan file.
 */
export async function persistDurableFileAndRecord<T>(args: {
  path: string;
  data: Buffer | Uint8Array;
  contentType?: string;
  reason: string;
  persist: (tx: DbTransaction) => Promise<T>;
  storage?: StorageProvider;
  db?: Database;
}): Promise<T> {
  const db = args.db ?? getDb();
  const storage = args.storage ?? getStorage();
  if (await storage.exists(args.path)) {
    throw new Error(`Refusing to overwrite an existing storage object: ${args.path}`);
  }

  const intentId = randomUUID();
  const [intent] = await db
    .insert(storageCleanupJobs)
    .values({
      id: intentId,
      storagePath: args.path,
      reason: `upload-intent:${args.reason}`,
      // Evidence and format uploads are bounded to tens of MB. One hour avoids
      // racing a slow live request while still recovering promptly after a crash.
      availableAt: new Date(Date.now() + 60 * 60_000),
    })
    .onConflictDoNothing({ target: storageCleanupJobs.storagePath })
    .returning({ id: storageCleanupJobs.id });
  if (!intent) {
    throw new Error(`A persistence intent already exists for storage object: ${args.path}`);
  }

  try {
    return await persistFileAndRecord({
      path: args.path,
      data: args.data,
      contentType: args.contentType,
      storage,
      persist: () => db.transaction(async (tx) => {
        const [lockedIntent] = await tx
          .select({ id: storageCleanupJobs.id })
          .from(storageCleanupJobs)
          .where(eq(storageCleanupJobs.id, intentId))
          .limit(1)
          .for("update");
        if (!lockedIntent) throw new Error("Durable upload intent disappeared before commit");

        const result = await args.persist(tx);
        const removed = await tx
          .delete(storageCleanupJobs)
          .where(eq(storageCleanupJobs.id, intentId))
          .returning({ id: storageCleanupJobs.id });
        if (removed.length !== 1) throw new Error("Durable upload intent was not finalized");
        return result;
      }),
    });
  } catch (error) {
    // Normal compensation already removed the object. Removing the now-useless
    // intent is best effort; if this DB call also fails, the worker safely
    // observes a missing file later and clears it.
    try {
      if (!(await storage.exists(args.path))) {
        await db.delete(storageCleanupJobs).where(eq(storageCleanupJobs.id, intentId));
      }
    } catch {
      // Preserve the original persistence/compensation error.
    }
    throw error;
  }
}
