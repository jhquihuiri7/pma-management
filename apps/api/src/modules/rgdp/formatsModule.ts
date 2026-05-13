import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { rgdpFormats } from "../../db/schema/rgdp.js";
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
  const storagePath = buildFormatPath({ adminId: input.adminId, subsystem: "rgdp", fileName: input.fileName });
  await getStorage().upload({ path: storagePath, data: input.data, contentType: input.contentType });
  const [row] = await getDb()
    .insert(rgdpFormats)
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
  getDb().select().from(rgdpFormats).where(eq(rgdpFormats.adminId, adminId)).orderBy(desc(rgdpFormats.uploadedAt));

export async function deleteFormat(id: string, adminId: string) {
  const rows = await getDb().select().from(rgdpFormats).where(eq(rgdpFormats.id, id)).limit(1);
  const f = rows[0];
  if (!f) throw NotFound("Format not found");
  if (f.adminId !== adminId) throw Forbidden();
  try { await getStorage().delete(f.storagePath); } catch { /* ignore */ }
  await getDb().delete(rgdpFormats).where(eq(rgdpFormats.id, id));
}
