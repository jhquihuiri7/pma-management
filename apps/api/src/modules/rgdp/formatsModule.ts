import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FormatFunctionality } from "@pma/types";
import { getDb } from "../../db/client.js";
import { rgdpFormats } from "../../db/schema/rgdp.js";
import { NotFound } from "../../lib/errors.js";
import {
  buildFormatPath,
  getStorage,
} from "../../storage/index.js";
import { lockFormatReplacement, toFormatApi } from "../shared/formatContract.js";
import { enqueueStorageCleanupPaths } from "../shared/storageCleanup.js";
import { persistDurableFileAndRecord } from "../shared/durableFilePersistence.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";

export type FormatUpload = {
  actorId: string;
  functionality: FormatFunctionality;
  functionalityLabel: string;
  fileName: string;
  data: Buffer;
  contentType?: string;
};

export async function uploadFormat(input: FormatUpload) {
  const db = getDb();
  const storage = getStorage();
  const formatId = randomUUID();
  const storagePath = buildFormatPath({
    subsystem: "rgdp",
    formatId,
    fileName: input.fileName,
  });
  const persisted = await persistDurableFileAndRecord({
    path: storagePath,
    data: input.data,
    contentType: input.contentType,
    storage,
    db,
    reason: `rgdp:format:${formatId}`,
    persist: async (tx) => {
      const actor = await lockAndAssertActor(tx, input.actorId, "rgdp", ["ADMIN"]);
      await lockFormatReplacement(tx, "rgdp", input.functionality);
      const previous = await tx
        .select()
        .from(rgdpFormats)
        .where(eq(rgdpFormats.functionality, input.functionality));
      await tx.delete(rgdpFormats).where(eq(rgdpFormats.functionality, input.functionality));
      await enqueueStorageCleanupPaths(
        tx,
        previous.map((row) => row.storagePath),
        `rgdp:format-replaced:${formatId}`
      );
      const [row] = await tx
        .insert(rgdpFormats)
        .values({
          id: formatId,
          createdBy: actor.id,
          functionality: input.functionality,
          functionalityLabel: input.functionalityLabel,
          fileName: input.fileName,
          storagePath,
        })
        .returning();
      if (!row) throw new Error("Format insert returned no row");
      return { row, previous };
    },
  });

  return toFormatApi(persisted.row, storage.getUrl(storagePath));
}

export async function listFormats(_adminId?: string) {
  const rows = await getDb().select().from(rgdpFormats).orderBy(desc(rgdpFormats.uploadedAt));
  const storage = getStorage();
  return rows.map((row) => toFormatApi(row, storage.getUrl(row.storagePath)));
}

export async function deleteFormat(id: string, actorId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "rgdp", ["ADMIN"]);
    const rows = await tx.select().from(rgdpFormats).where(eq(rgdpFormats.id, id)).limit(1);
    const format = rows[0];
    if (!format) throw NotFound("Format not found");
    const deleted = await tx.delete(rgdpFormats).where(eq(rgdpFormats.id, id)).returning({ id: rgdpFormats.id });
    if (deleted.length !== 1) throw NotFound("Format not found");
    await enqueueStorageCleanupPaths(tx, [format.storagePath], `rgdp:format-deleted:${id}`);
    return deleted[0];
  });
}
