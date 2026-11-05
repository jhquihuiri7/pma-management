import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getStorage } from "../storage/index.js";
import { buildFlatGeobuf } from "./gdal.js";
import type { FgbJob } from "./boss.js";
import {
  buildGeoLayerFgbPath,
  getRevisionSource,
  markFgbError,
  markFgbReady,
  touchFgb,
} from "../modules/geo/layerArtifacts.js";

const GZIP_MAGIC = [0x1f, 0x8b];

async function isGzip(absPath: string): Promise<boolean> {
  const handle = await fs.open(absPath, "r");
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
  } finally {
    await handle.close();
  }
}

/**
 * Builds the FlatGeobuf of one vector revision next to the layer's data:
 *   GEO/maps/{mapId}/layers/{layerId}/artifacts/r{revision}.fgb
 * written to a temporary name first and renamed, so a half-written file is never
 * served. Runs in the worker (GDAL lives in its image).
 */
export async function processFlatGeobuf(job: FgbJob): Promise<void> {
  const { layerId, revision } = job;
  const source = await getRevisionSource(layerId, revision);
  if (!source) {
    // The layer (or that revision) was deleted after the job was queued.
    console.warn(`[worker] flatgeobuf: layer ${layerId} r${revision} no longer exists — skipping`);
    return;
  }
  await touchFgb(layerId, revision);
  const storage = getStorage();
  const finalPath = buildGeoLayerFgbPath(source.mapId, layerId, revision);
  const absInput = storage.resolve(source.dataPath);
  const absOutput = storage.resolve(finalPath);
  const absTmp = `${absOutput}.tmp-${randomUUID()}.fgb`;
  const logPath = `${absOutput}.log`;
  await fs.mkdir(dirname(absOutput), { recursive: true });
  try {
    const input = (await isGzip(absInput)) ? `/vsigzip/${absInput}` : absInput;
    await buildFlatGeobuf(input, absTmp, logPath);
    await fs.rename(absTmp, absOutput);
    const stat = await fs.stat(absOutput);
    await markFgbReady(layerId, revision, finalPath, stat.size);
    console.log(`[worker] flatgeobuf ready: layer ${layerId} r${revision} (${stat.size} bytes)`);
  } catch (error) {
    await fs.rm(absTmp, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await markFgbError(layerId, revision, message);
    throw error;
  }
}
