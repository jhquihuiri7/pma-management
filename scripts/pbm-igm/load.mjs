// Runs INSIDE the pma-api container with the deployed modules, so maps, layers
// and rasters follow the same paths (NAS, revisions, durable intents, queue) as
// the web editor.
//   node load.mjs <staging root> <actor user id>
// Resumable: maps are matched by title + tag, vector and raster layers by name.
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";
import { createMap, listMaps } from "/app/dist/apps/api/src/modules/geo/mapsModule.js";
import { createLayer, listLayers, updateLayer, getLayerDataPath } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import {
  listRasterLayers, createRasterLayer, compensateRasterLayerCreation,
} from "/app/dist/apps/api/src/modules/geo/rasterLayersModule.js";
import { lockAndAssertGeoEditor } from "/app/dist/apps/api/src/modules/geo/authorization.js";
import { beginDurableStorageIntent } from "/app/dist/apps/api/src/modules/shared/durableFilePersistence.js";
import {
  getStorage, buildGeoRasterDir, buildGeoRasterOriginalPath, buildGeoLayerSourcePath,
} from "/app/dist/apps/api/src/storage/index.js";
import { enqueueRasterProcessing, stopBoss } from "/app/dist/apps/api/src/jobs/boss.js";
import { env } from "/app/dist/apps/api/src/lib/env.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const gunzip = promisify(gunzipCallback);
const [root, actorId] = process.argv.slice(2);
const plan = JSON.parse(await readFile(`${root}/plan.json`, "utf8"));
const storage = getStorage();
const results = [];

// BDG base layers are copied from their stored current revision + original zip.
async function baseLayerFiles(l) {
  const dataPath = await getLayerDataPath(l.baseMapId, l.baseLayerId);
  const data = await gunzip(await readFile(storage.resolve(dataPath)));
  const source = await readFile(storage.resolve(buildGeoLayerSourcePath(l.baseMapId, l.baseLayerId, "zip")));
  return { data, source };
}

async function uploadRaster(mapId, r) {
  const id = randomUUID();
  const intent = await beginDurableStorageIntent({
    path: buildGeoRasterDir(mapId, id),
    reason: `geo:raster:${id}`,
    isDirectory: true,
    availableAfterMs: 24 * 60 * 60_000,
    storage,
  });
  let layer = null;
  try {
    const originalPath = buildGeoRasterOriginalPath(mapId, id, r.file);
    const sizeBytes = await storage.uploadStream(originalPath, createReadStream(`${root}/rasters/${r.file}`), {
      maxBytes: env.RASTER_MAX_UPLOAD_BYTES,
    });
    layer = await intent.finalize((tx) => createRasterLayer(mapId, actorId, {
      id, name: r.name, originalFilename: r.file, originalPath, sizeBytes, fileType: "tif", auxFiles: null,
      visible: r.visible, zIndex: r.zIndex, opacity: r.opacity,
    }, tx), {
      beforeIntentLock: (tx) => lockAndAssertGeoEditor(tx, actorId).then(() => undefined),
    });
    const operationId = await enqueueRasterProcessing({ mapId, rasterLayerId: layer.id });
    if (!operationId) throw new Error("La cola de procesamiento no confirmó el trabajo");
    return { status: "created", layerId: layer.id, sizeBytes, operationId };
  } catch (err) {
    if (layer) await compensateRasterLayerCreation(mapId, id);
    else await intent.compensate();
    throw err;
  }
}

try {
  const existingMaps = await listMaps();
  for (const m of plan.maps) {
    let map = existingMaps.find((x) => x.title === m.title && Array.isArray(x.tags) && x.tags.includes(plan.tag));
    const res = { title: m.title, mapId: null, reused: Boolean(map), layers: [], rasters: [] };
    if (!map) {
      map = await createMap(actorId, {
        title: m.title, description: m.description, categoryId: m.categoryId, thematic: m.thematic,
        layers: [], center: m.center, zoom: m.zoom, tags: m.tags,
      });
    }
    res.mapId = map.id;
    const existingLayers = new Map((await listLayers(map.id)).map((l) => [l.name, l]));

    for (const l of m.layers) {
      const out = { name: l.name, role: l.role, scale: l.scale ?? null, zIndex: l.zIndex, visible: l.visible };
      const prior = existingLayers.get(l.name);
      if (prior) {
        if (prior.zIndex !== l.zIndex) await updateLayer(map.id, prior.id, actorId, { zIndex: l.zIndex });
        Object.assign(out, { status: "exists", layerId: prior.id, featureCount: prior.featureCount });
      } else if (l.ok === false) {
        Object.assign(out, { status: "failed", error: l.errors.join("; ") });
      } else {
        try {
          const files = l.baseLayerId
            ? await baseLayerFiles(l)
            : { data: await readFile(`${root}/${l.dataRel}`), source: await readFile(`${root}/${l.sourceRel}`) };
          const created = await createLayer(map.id, actorId, {
            name: l.name, geometryType: l.geometry, crs: "EPSG:4326",
            featureCount: l.featureCount, bbox: l.bbox ?? null,
            sourceFormat: l.baseLayerId ? l.sourceFormat : "filegdb",
            data: files.data, source: { data: files.source, ext: "zip" },
            style: l.style, visible: l.visible, zIndex: l.zIndex,
          });
          Object.assign(out, { status: "created", layerId: created.id, featureCount: created.featureCount });
        } catch (err) {
          Object.assign(out, { status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      }
      res.layers.push(out);
      console.log(`${m.title} | ${out.status} | ${l.name}${out.error ? ` | ${out.error}` : ""}`);
    }

    const existingRasters = new Map((await listRasterLayers(map.id)).map((r) => [r.name, r]));
    for (const r of m.rasters) {
      const prior = existingRasters.get(r.name);
      let out = { name: r.name, file: r.file, visible: r.visible, zIndex: r.zIndex, derived: Boolean(r.derived) };
      if (prior) {
        out = { ...out, status: "exists", layerId: prior.id, rasterStatus: prior.status };
      } else {
        try {
          out = { ...out, ...(await uploadRaster(map.id, r)) };
        } catch (err) {
          out = { ...out, status: "failed", error: err instanceof Error ? err.message : String(err) };
        }
      }
      res.rasters.push(out);
      console.log(`${m.title} | ${out.status} | ráster ${r.name}${out.error ? ` | ${out.error}` : ""}`);
    }
    results.push(res);
    await writeFile(`${root}/results.json`, JSON.stringify(results, null, 1));
  }
} finally {
  await writeFile(`${root}/results.json`, JSON.stringify(results, null, 1));
  await stopBoss();
  await closeDb();
}
