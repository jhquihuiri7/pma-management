import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pmaFormats } from "../../db/schema/pma.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getStorage, buildFormatPath } from "../../storage/index.js";

export type FormatUpload = {
  adminId: string;
  functionality: "descargar_anexos";
  functionalityLabel: string;
  fileName: string;
  data: Buffer;
  contentType?: string;
};

export async function uploadFormat(input: FormatUpload) {
  const db = getDb();
  const storagePath = buildFormatPath({
    adminId: input.adminId,
    subsystem: "pma",
    fileName: input.fileName,
  });
  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });
  const [row] = await db
    .insert(pmaFormats)
    .values({
      adminId: input.adminId,
      functionality: input.functionality,
      functionalityLabel: input.functionalityLabel,
      fileName: input.fileName,
      storagePath,
    })
    .returning();
  return row;
}

export async function listFormats(adminId: string) {
  const db = getDb();
  return db
    .select()
    .from(pmaFormats)
    .where(eq(pmaFormats.adminId, adminId))
    .orderBy(desc(pmaFormats.uploadedAt));
}

export async function deleteFormat(id: string, adminId: string) {
  const db = getDb();
  const rows = await db.select().from(pmaFormats).where(eq(pmaFormats.id, id)).limit(1);
  const f = rows[0];
  if (!f) throw NotFound("Format not found");
  if (f.adminId !== adminId) throw Forbidden();
  try { await getStorage().delete(f.storagePath); } catch { /* ignore */ }
  await db.delete(pmaFormats).where(eq(pmaFormats.id, id));
}
