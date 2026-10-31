// Runs INSIDE the pma-api container with the deployed modules, so layers go
// through the same createMap/createLayer path (NAS + revisions) as the web UI.
// Usage: node load.mjs <staging root> <actor user id>
// Resumable: maps are matched by title + "BDG Galápagos" tag, layers by name.
import { readFile, writeFile } from "node:fs/promises";
import { createMap, listMaps } from "/app/dist/apps/api/src/modules/geo/mapsModule.js";
import { createLayer, listLayers, updateLayer } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const [root, actorId] = process.argv.slice(2);
const TAG = "BDG Galápagos";
const plan = JSON.parse(await readFile(`${root}/plan.json`, "utf8"));
const existingMaps = await listMaps();
const results = [];

try {
  for (const m of plan.maps) {
    let map = existingMaps.find((x) => x.title === m.title && Array.isArray(x.tags) && x.tags.includes(TAG));
    const res = { folder: m.folder, title: m.title, mapId: null, reused: Boolean(map), deferred: false, layers: [] };
    if (!map && m.deferred) {
      res.deferred = true;
      res.layers = m.layers.filter((l) => l.role === "thematic").map((l) => ({
        name: l.name, sourceFolder: l.folder, role: l.role, island: l.island, geometry: l.indexGeometry,
        prjEpsg: l.prjEpsg, indexCount: l.indexCount, dropped: [], status: "failed", error: l.error,
      }));
      console.log(`${m.folder} | deferred | sin capas temáticas disponibles`);
      results.push(res);
      continue;
    }
    if (!map) {
      map = await createMap(actorId, {
        title: m.title, description: m.description, categoryId: m.categoryId, thematic: m.thematic,
        layers: [], center: m.center, zoom: m.zoom, tags: m.tags,
      });
    }
    res.mapId = map.id;
    const existingLayers = new Map((await listLayers(map.id)).map((l) => [l.name, l]));

    for (const l of m.layers) {
      const out = {
        name: l.name, sourceFolder: l.folder, role: l.role, zIndex: l.zIndex, visible: l.visible,
        island: l.island, geometry: l.geometry ?? l.indexGeometry, prjEpsg: l.prjEpsg,
        indexCount: l.indexCount, dropped: l.dropped ?? [],
      };
      const prior = existingLayers.get(l.name);
      if (prior) {
        // Layers added on a later run shift the stack; keep the planned order.
        if (prior.zIndex !== l.zIndex) await updateLayer(map.id, prior.id, actorId, { zIndex: l.zIndex });
        Object.assign(out, { status: "exists", layerId: prior.id, featureCount: prior.featureCount });
      } else if (!l.ok) {
        Object.assign(out, { status: "failed", error: l.error });
      } else {
        try {
          const created = await createLayer(map.id, actorId, {
            name: l.name, geometryType: l.geometry, crs: "EPSG:4326",
            featureCount: l.featureCount, bbox: l.bbox, sourceFormat: "shapefile",
            data: await readFile(`${root}/${l.dataRel}`),
            source: { data: await readFile(`${root}/${l.sourceRel}`), ext: "zip" },
            style: l.style, visible: l.visible, zIndex: l.zIndex,
          });
          Object.assign(out, { status: "created", layerId: created.id, featureCount: created.featureCount });
        } catch (err) {
          Object.assign(out, { status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
      }
      res.layers.push(out);
      console.log(`${m.folder} | ${out.status} | ${l.name}${out.error ? ` | ${out.error}` : ""}`);
    }
    results.push(res);
    await writeFile(`${root}/results.json`, JSON.stringify(results, null, 1));
  }
} finally {
  await writeFile(`${root}/results.json`, JSON.stringify(results, null, 1));
  await closeDb();
}
