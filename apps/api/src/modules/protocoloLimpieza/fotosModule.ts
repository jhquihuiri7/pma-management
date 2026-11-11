import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { protocoloLimpiezaFotos } from "../../db/schema/protocoloLimpieza.js";
import { BadRequest, HttpError } from "../../lib/errors.js";
import { persistDurableFileAndRecord } from "../shared/durableFilePersistence.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { ROLES_PROTOCOLO_LIMPIEZA } from "./registrosModule.js";
import { FOTO_ID_PATTERN, MAX_FOTO_BYTES } from "./reglas.js";

// Photos attached to the reports (for example, the container's interior in
// R3). The browser shrinks them to a JPG before sending; the file goes to
// SIGTAR's storage and the report keeps only its id.

const RAIZ_FOTOS = "PROTOCOLO_LIMPIEZA/fotos";

export const FOTO_DEMASIADO_GRANDE = "La fotografía supera 4 MB.";

/** Only ids the API generated can name a file: no other path is ever built. */
export function rutaFoto(id: string): string {
  if (!FOTO_ID_PATTERN.test(id)) throw new TypeError("Invalid photo id");
  return `${RAIZ_FOTOS}/${id}`;
}

export const esJpeg = (bytes: Uint8Array): boolean =>
  bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** Stores a JPG and its record together; a failure on either side leaves neither. */
export async function guardarFoto(actorId: string, bytes: Buffer): Promise<{ id: string }> {
  if (!esJpeg(bytes)) throw BadRequest("La fotografía debe ser una imagen JPG.");
  if (bytes.length > MAX_FOTO_BYTES) throw new HttpError(413, FOTO_DEMASIADO_GRANDE);
  const id = `${randomUUID()}.jpg`;
  const path = rutaFoto(id);
  await persistDurableFileAndRecord({
    path,
    data: bytes,
    contentType: "image/jpeg",
    reason: "protocolo-limpieza-foto",
    persist: async (tx) => {
      const actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
      await tx.insert(protocoloLimpiezaFotos).values({ id, storagePath: path, sizeBytes: bytes.length, createdBy: actor.id });
    },
  });
  return { id };
}

/** Storage path of a photo uploaded through this module, or null for anything else. */
export async function rutaFotoGuardada(id: string): Promise<string | null> {
  if (!FOTO_ID_PATTERN.test(id)) return null;
  const [row] = await getDb()
    .select({ storagePath: protocoloLimpiezaFotos.storagePath })
    .from(protocoloLimpiezaFotos)
    .where(eq(protocoloLimpiezaFotos.id, id))
    .limit(1);
  return row?.storagePath ?? null;
}
