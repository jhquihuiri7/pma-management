// Runs INSIDE pma-api (cwd /app/apps/api): writes the layers of the BDG base map
// and of the San Cristóbal map (id given) as JSON for build_plan.cjs, with the
// style each one carries now in production.
//   node dump_layers.mjs <out file> <San Cristóbal map id>
import { writeFile } from "node:fs/promises";
import { listMaps } from "/app/apps/api/dist/apps/api/src/modules/geo/mapsModule.js";
import { listLayers } from "/app/apps/api/dist/apps/api/src/modules/geo/layersModule.js";
import { closeDb } from "/app/apps/api/dist/apps/api/src/db/client.js";

const [out, scMapId] = process.argv.slice(2);
const row = (mapId) => (l) => ({
  name: l.name, baseMapId: mapId, baseLayerId: l.id, geometry: l.geometryType, featureCount: l.featureCount,
  bbox: l.bbox ?? null, sourceFormat: l.sourceFormat, style: l.style, visible: l.visible, zIndex: l.zIndex,
});
try {
  const base = (await listMaps()).find((m) => m.title === "Capas base (en todos los mapas)" && m.tags?.includes("BDG Galápagos"));
  if (!base) throw new Error("no está el mapa de capas base de la BDG");
  const res = { base: (await listLayers(base.id)).map(row(base.id)), sanCristobal: (await listLayers(scMapId)).map(row(scMapId)) };
  await writeFile(out, JSON.stringify(res, null, 1));
  for (const k of Object.keys(res)) console.log(k, res[k].map((r) => `${r.name}(${r.zIndex},${r.visible ? "v" : "o"})`).join(" "));
} finally {
  await closeDb();
}
