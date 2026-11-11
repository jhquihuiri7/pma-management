import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { protocoloLimpiezaNubes } from "../../db/schema/protocoloLimpieza.js";
import { BadRequest, Conflict, NotFound } from "../../lib/errors.js";
import { getStorage } from "../../storage/index.js";
import { enqueueStorageDirectoryCleanup } from "../shared/storageCleanup.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { ROLES_PROTOCOLO_LIMPIEZA } from "./registrosModule.js";
import {
  BYTES_CABECERA_LAS,
  claveSitio,
  lasIncompleto,
  leerCabeceraLas,
  limpiarDatosNube,
  type CabeceraLas,
  type DatosNube,
  type ExtensionNube,
  type MetadatosNube,
  type NubePuntos,
} from "./reglas.js";

// Point clouds of the Visualización 3D tab. Each one lives in its own folder,
// PROTOCOLO_LIMPIEZA/nubes/<id>/: the LAS/LAZ as uploaded (original.las|laz)
// and, once the worker converts it, the COPC the viewer reads (nube.copc.laz).
// The upload itself (multipart, streamed to the NAS) is in the routes.

const RAIZ_NUBES = "PROTOCOLO_LIMPIEZA/nubes";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type FilaNube = typeof protocoloLimpiezaNubes.$inferSelect;

export const NUBE_NO_ENCONTRADA = "Nube de puntos no encontrada.";
export const NUBE_CAMBIO = "La nube cambió. Cierra el formulario y ábrelo de nuevo.";

/** Only ids the API generated name a folder: no other path is ever built. */
export function dirNube(id: string): string {
  if (!UUID.test(id)) throw new TypeError("Invalid point cloud id");
  return `${RAIZ_NUBES}/${id}`;
}
export const rutaOriginalNube = (id: string, ext: ExtensionNube) => `${dirNube(id)}/original${ext}`;
export const rutaCopcNube = (id: string) => `${dirNube(id)}/nube.copc.laz`;

/** Today in Galápagos (UTC−6 all year): a survey cannot be dated after it. */
export const hoyGalapagos = (ahora = new Date()) => new Date(ahora.getTime() - 6 * 3600_000).toISOString().slice(0, 10);

/** The shared rules' validation, as a 400 with their message. */
export function validarDatosNube(input: unknown): DatosNube {
  try {
    return limpiarDatosNube(input, hoyGalapagos());
  } catch (error) {
    throw BadRequest((error as Error).message);
  }
}

/** The file name as the user saw it: no folders, at most 255 characters. */
export function nombreArchivoNube(nombre: string | undefined): string {
  const base = String(nombre ?? "").split(/[\\/]/).pop()!.trim();
  return (base || "nube").slice(0, 255);
}

export function aNube(f: FilaNube): NubePuntos {
  return {
    id: f.id,
    sitio: f.sitio,
    fecha: f.fecha,
    descripcion: f.descripcion,
    archivoNombre: f.archivoNombre,
    archivoBytes: f.archivoBytes,
    estado: f.estado,
    error: f.error,
    puntos: f.puntos,
    copcBytes: f.copcBytes,
    metadatos: f.metadatos ?? null,
    version: f.version,
    creadoPorNombre: f.createdByName,
    actualizadoPorNombre: f.updatedByName,
    creadoEn: f.createdAt.toISOString(),
    actualizadoEn: f.updatedAt.toISOString(),
    procesadaEn: f.procesadaAt?.toISOString() ?? null,
  };
}

/** Every cloud, by site and survey date: the timeline of each site. */
export async function listarNubes(): Promise<NubePuntos[]> {
  const filas = await getDb()
    .select()
    .from(protocoloLimpiezaNubes)
    .orderBy(asc(protocoloLimpiezaNubes.sitio), asc(protocoloLimpiezaNubes.fecha), asc(protocoloLimpiezaNubes.createdAt));
  return filas.map(aNube);
}

/**
 * A site typed again with other case, accents or spacing joins the one that
 * already exists (claveSitio), so its surveys stay on one timeline.
 */
async function sitioCanonico(tx: Tx, sitio: string, salvoId?: string): Promise<string> {
  const clave = claveSitio(sitio);
  const existentes = await tx.selectDistinct({ id: protocoloLimpiezaNubes.id, sitio: protocoloLimpiezaNubes.sitio }).from(protocoloLimpiezaNubes);
  return existentes.find((f) => f.id !== salvoId && claveSitio(f.sitio) === clave)?.sitio ?? sitio;
}

/** Reads and checks the header of an uploaded file; a 400 with the reason when it is not a usable LAS/LAZ. */
export async function cabeceraDeArchivo(rutaAbsoluta: string, bytesArchivo: number): Promise<CabeceraLas> {
  const archivo = await open(rutaAbsoluta, "r");
  let cabecera: CabeceraLas;
  try {
    const buffer = Buffer.alloc(BYTES_CABECERA_LAS);
    const { bytesRead } = await archivo.read(buffer, 0, BYTES_CABECERA_LAS, 0);
    cabecera = leerCabeceraLas(buffer.subarray(0, bytesRead));
  } catch (error) {
    throw BadRequest((error as Error).message);
  } finally {
    await archivo.close();
  }
  const incompleto = lasIncompleto(cabecera, bytesArchivo);
  if (incompleto) throw BadRequest(incompleto);
  return cabecera;
}

/** Inserts the cloud of a finished upload, inside the upload intent's transaction. */
export async function insertarNube(
  tx: Tx,
  actor: { id: string; name: string },
  nube: { id: string; datos: DatosNube; archivoNombre: string; archivoRuta: string; archivoBytes: number; puntos: number },
): Promise<NubePuntos> {
  const sitio = await sitioCanonico(tx, nube.datos.sitio);
  const [fila] = await tx
    .insert(protocoloLimpiezaNubes)
    .values({
      id: nube.id,
      sitio,
      fecha: nube.datos.fecha,
      descripcion: nube.datos.descripcion,
      archivoNombre: nube.archivoNombre,
      archivoRuta: nube.archivoRuta,
      archivoBytes: nube.archivoBytes,
      puntos: nube.puntos,
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
      updatedByName: actor.name,
    })
    .returning();
  return aNube(fila);
}

/** Removes a cloud whose processing could not be queued, with its folder. */
export async function compensarNube(id: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id));
    await enqueueStorageDirectoryCleanup(tx, dirNube(id), `protocolo-limpieza:nube:${id}`);
  });
}

/** Site, date and description of a cloud; rejected when someone changed it first. */
export async function editarNube(actorId: string, id: string, version: unknown, input: unknown): Promise<NubePuntos> {
  if (!UUID.test(id) || !Number.isSafeInteger(version) || (version as number) < 1) throw BadRequest("La nube que intentas editar es inválida.");
  const datos = validarDatosNube(input);
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
    const sitio = await sitioCanonico(tx, datos.sitio, id);
    const [fila] = await tx
      .update(protocoloLimpiezaNubes)
      .set({
        sitio,
        fecha: datos.fecha,
        descripcion: datos.descripcion,
        version: (version as number) + 1,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: new Date(),
      })
      .where(and(eq(protocoloLimpiezaNubes.id, id), eq(protocoloLimpiezaNubes.version, version as number)))
      .returning();
    if (fila) return aNube(fila);
    const [existe] = await tx.select({ id: protocoloLimpiezaNubes.id }).from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).limit(1);
    throw existe ? Conflict(NUBE_CAMBIO) : NotFound(NUBE_NO_ENCONTRADA);
  });
}

/**
 * Only ADMIN deletes a cloud. The row goes in the same transaction that queues
 * its folder for the worker's durable cleanup (original, COPC and all).
 */
export async function eliminarNube(actorId: string, id: string): Promise<void> {
  if (!UUID.test(id)) throw NotFound(NUBE_NO_ENCONTRADA);
  await getDb().transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ["ADMIN"]);
    const [fila] = await tx.select({ id: protocoloLimpiezaNubes.id }).from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).for("update");
    if (!fila) throw NotFound(NUBE_NO_ENCONTRADA);
    await tx.delete(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id));
    await enqueueStorageDirectoryCleanup(tx, dirNube(id), `protocolo-limpieza:nube:${id}`);
  });
}

/** A cloud whose conversion failed goes back to 'procesando'; the caller queues it. */
export async function reintentarNube(actorId: string, id: string): Promise<NubePuntos> {
  if (!UUID.test(id)) throw NotFound(NUBE_NO_ENCONTRADA);
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
    const [actual] = await tx.select().from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).for("update");
    if (!actual) throw NotFound(NUBE_NO_ENCONTRADA);
    if (actual.estado !== "error") throw Conflict("Solo se reintenta una nube cuya conversión falló.");
    const [fila] = await tx
      .update(protocoloLimpiezaNubes)
      .set({ estado: "procesando", error: null, updatedBy: actor.id, updatedByName: actor.name, updatedAt: new Date() })
      .where(eq(protocoloLimpiezaNubes.id, id))
      .returning();
    return aNube(fila);
  });
}

/** The COPC of a ready cloud, for the viewer. */
export async function copcDeNube(id: string): Promise<{ ruta: string; bytes: number; procesadaEn: Date }> {
  if (!UUID.test(id)) throw NotFound(NUBE_NO_ENCONTRADA);
  const [f] = await getDb().select().from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).limit(1);
  if (!f || f.estado !== "lista" || !f.copcRuta || !f.copcBytes || !f.procesadaAt) throw NotFound(NUBE_NO_ENCONTRADA);
  return { ruta: f.copcRuta, bytes: f.copcBytes, procesadaEn: f.procesadaAt };
}

/** The file as it was uploaded, to download. */
export async function originalDeNube(id: string): Promise<{ ruta: string; nombre: string; bytes: number }> {
  if (!UUID.test(id)) throw NotFound(NUBE_NO_ENCONTRADA);
  const [f] = await getDb().select().from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).limit(1);
  if (!f) throw NotFound(NUBE_NO_ENCONTRADA);
  return { ruta: f.archivoRuta, nombre: f.archivoNombre, bytes: f.archivoBytes };
}

// ── Worker ──────────────────────────────────────────────────────────────────

/** Clouds waiting for (or in) their conversion: the worker queues them again after a restart. */
export async function nubesEnProceso(): Promise<string[]> {
  const filas = await getDb()
    .select({ id: protocoloLimpiezaNubes.id })
    .from(protocoloLimpiezaNubes)
    .where(eq(protocoloLimpiezaNubes.estado, "procesando"))
    .orderBy(asc(protocoloLimpiezaNubes.createdAt));
  return filas.map((f) => f.id);
}

/** The original of a cloud still to convert, or null (deleted, or already converted). */
export async function nubeParaConvertir(id: string): Promise<{ archivoRuta: string } | null> {
  if (!UUID.test(id)) return null;
  const [f] = await getDb()
    .select({ archivoRuta: protocoloLimpiezaNubes.archivoRuta, estado: protocoloLimpiezaNubes.estado })
    .from(protocoloLimpiezaNubes)
    .where(eq(protocoloLimpiezaNubes.id, id))
    .limit(1);
  return f?.estado === "procesando" ? { archivoRuta: f.archivoRuta } : null;
}

/**
 * Publishes a converted COPC. It is first copied beside the original as .part;
 * then, holding the cloud's row, renamed and the row marked 'lista'. A cloud
 * deleted meanwhile keeps nothing: its .part (and the folder the copy may have
 * recreated) is removed.
 */
export async function publicarNube(
  id: string,
  resultado: { copcLocal: string; metadatos: MetadatosNube; puntos: number },
): Promise<"lista" | "descartada"> {
  const storage = getStorage();
  const final = rutaCopcNube(id);
  const parcial = `${final}.part`;
  const bytes = await storage.uploadStream(parcial, createReadStream(resultado.copcLocal));
  const estado = await getDb().transaction(async (tx) => {
    const [f] = await tx.select({ estado: protocoloLimpiezaNubes.estado }).from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, id)).for("update");
    if (!f) return "borrada" as const;
    if (f.estado !== "procesando") return "descartada" as const;
    await storage.move(parcial, final);
    await tx
      .update(protocoloLimpiezaNubes)
      .set({
        estado: "lista",
        error: null,
        copcRuta: final,
        copcBytes: bytes,
        metadatos: resultado.metadatos,
        puntos: resultado.puntos,
        procesadaAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(protocoloLimpiezaNubes.id, id));
    return "lista" as const;
  });
  if (estado === "lista") return "lista";
  if (estado === "borrada") await storage.deleteDir(dirNube(id));
  else await storage.delete(parcial);
  return "descartada";
}

/** A failed conversion, with the reason the user reads (at most 500 characters). */
export async function marcarNubeError(id: string, mensaje: string): Promise<void> {
  if (!UUID.test(id)) return;
  await getDb()
    .update(protocoloLimpiezaNubes)
    .set({ estado: "error", error: mensaje.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(protocoloLimpiezaNubes.id, id), eq(protocoloLimpiezaNubes.estado, "procesando")));
}
