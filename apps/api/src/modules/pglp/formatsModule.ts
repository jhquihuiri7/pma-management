import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { pglpFormats } from "../../db/schema/pglp.js";
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
  const storagePath = buildFormatPath({ adminId: input.adminId, subsystem: "pglp", fileName: input.fileName });
  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });
  const [row] = await getDb()
    .insert(pglpFormats)
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

export const listFormats = (adminId: string) =>
  getDb().select().from(pglpFormats).where(eq(pglpFormats.adminId, adminId)).orderBy(desc(pglpFormats.uploadedAt));

export async function deleteFormat(id: string, adminId: string) {
  const rows = await getDb().select().from(pglpFormats).where(eq(pglpFormats.id, id)).limit(1);
  const f = rows[0];
  if (!f) throw NotFound("Format not found");
  if (f.adminId !== adminId) throw Forbidden();
  try { await getStorage().delete(f.storagePath); } catch { /* ignore */ }
  await getDb().delete(pglpFormats).where(eq(pglpFormats.id, id));
}
