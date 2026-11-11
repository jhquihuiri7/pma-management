import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "../lib/env.js";
import { getStorage } from "../storage/index.js";
import { marcarNubeError, nubeParaConvertir, publicarNube } from "../modules/protocoloLimpieza/nubesModule.js";
import { metadatosDePdal } from "../modules/protocoloLimpieza/pdalMetadatos.js";

// Converts an uploaded point cloud (LAS/LAZ) into a COPC for the viewer:
//   1. untwine  original → nube.copc.laz, in a local temporary folder (fast disk, not the NAS)
//   2. pdal info --summary          → points, bounds, dimensions, CRS
//   3. pdal pipeline + filters.stats → elevation statistics and points per class
//   4. publicarNube: the COPC goes beside the original and the cloud becomes 'lista'
// untwine sorts the points into an octree on disk, so its memory stays low even for
// clouds of several GB (430 MB for the 23-million-point sample).

const PREFIJO_TEMPORAL = "pl-nube-";

/** A failure whose message is meant for the user (the rest are logged and summarised). */
class ErrorDeNube extends Error {}

function ejecutar(bin: string, args: string[]): Promise<string> {
  // Below the API, Previene and the database: the conversion takes what is left of the CPU.
  const prefijo = dirname(dirname(bin));
  return new Promise((resolve, reject) => {
    const hijo = spawn("nice", ["-n", "10", bin, ...args], {
      env: { ...process.env, PROJ_DATA: join(prefijo, "share", "proj"), GDAL_DATA: join(prefijo, "share", "gdal") },
    });
    let salida = "";
    let errores = "";
    const reloj = setTimeout(() => {
      hijo.kill("SIGKILL");
      reject(new ErrorDeNube(`La conversión superó el tiempo máximo (${Math.round(env.NUBE_JOB_TIMEOUT_MS / 60_000)} min).`));
    }, env.NUBE_JOB_TIMEOUT_MS);
    hijo.stdout.on("data", (d) => { salida += d.toString(); });
    hijo.stderr.on("data", (d) => { errores = (errores + d.toString()).slice(-4000); });
    hijo.on("error", (error) => {
      clearTimeout(reloj);
      reject(error);
    });
    hijo.on("close", (codigo) => {
      clearTimeout(reloj);
      if (codigo === 0) resolve(salida);
      // nice exits 127 when the tool itself is missing.
      else if (codigo === 127) reject(new ErrorDeNube("El servidor no tiene las herramientas de nubes de puntos (untwine y PDAL)."));
      else reject(new Error(`${bin.split("/").pop()} terminó con código ${codigo}: ${errores.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

/** What the user reads when a conversion fails. */
export function mensajeDeFallo(error: unknown): string {
  if (error instanceof ErrorDeNube) return error.message;
  const texto = error instanceof Error ? error.message : String(error);
  return `No se pudo convertir la nube de puntos. ${texto}`.slice(0, 500);
}

export async function procesarNube(id: string): Promise<"lista" | "descartada" | "omitida"> {
  const nube = await nubeParaConvertir(id);
  if (!nube) return "omitida"; // deleted, or converted already (a repeated job)
  const original = getStorage().resolve(nube.archivoRuta);
  const temporal = await mkdtemp(join(tmpdir(), `${PREFIJO_TEMPORAL}${id}-`));
  try {
    const copc = join(temporal, "nube.copc.laz");
    await ejecutar(env.NUBE_UNTWINE_BIN, [`--files=${original}`, `--output_dir=${copc}`, `--temp_dir=${join(temporal, "trabajo")}`]);
    const resumen = JSON.parse(await ejecutar(env.NUBE_PDAL_BIN, ["info", "--summary", copc]));
    const tuberia = join(temporal, "estadisticas.json");
    const metadatosPdal = join(temporal, "estadisticas-metadata.json");
    await writeFile(
      tuberia,
      JSON.stringify([
        { type: "readers.copc", filename: copc },
        { type: "filters.stats", dimensions: "Z,Classification", count: "Classification" },
      ]),
    );
    await ejecutar(env.NUBE_PDAL_BIN, ["pipeline", "--nostream", tuberia, "--metadata", metadatosPdal]);
    const { metadatos, puntos } = metadatosDePdal(resumen, JSON.parse(await readFile(metadatosPdal, "utf8")));
    return await publicarNube(id, { copcLocal: copc, metadatos, puntos });
  } finally {
    await rm(temporal, { recursive: true, force: true });
  }
}

/** Runs one job: a failure leaves the cloud in 'error' with its reason, and is rethrown for pg-boss. */
export async function procesarTrabajoNube(id: string): Promise<void> {
  try {
    const resultado = await procesarNube(id);
    if (resultado !== "omitida") console.log(`[worker] point cloud ${id}: ${resultado}`);
  } catch (error) {
    console.error(`[worker] point cloud ${id} failed:`, error instanceof Error ? error.message : error);
    try {
      await marcarNubeError(id, mensajeDeFallo(error));
    } catch (marcar) {
      console.error(`[worker] could not record the error of point cloud ${id}:`, marcar);
    }
    throw error;
  }
}

/** Temporary folders left by a worker that stopped mid-conversion. */
export async function limpiarTemporalesNubes(): Promise<void> {
  const entradas = await readdir(tmpdir()).catch(() => [] as string[]);
  await Promise.all(
    entradas.filter((n) => n.startsWith(PREFIJO_TEMPORAL)).map((n) => rm(join(tmpdir(), n), { recursive: true, force: true })),
  );
}
