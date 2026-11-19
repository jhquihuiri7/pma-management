// Runs INSIDE pma-api: writes the BDG 1:50.000 base layers (map "Capas base (en
// todos los mapas)") as base.json for build_plan.cjs, with the style they carry
// in the IGM maps.
//   node base.mjs <out file>
import { writeFile } from "node:fs/promises";
import { listMaps } from "/app/dist/apps/api/src/modules/geo/mapsModule.js";
import { listLayers } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const [out] = process.argv.slice(2);
try {
  const base = (await listMaps()).find((m) => m.title === "Capas base (en todos los mapas)" && m.tags?.includes("BDG Galápagos"));
  if (!base) throw new Error("no está el mapa de capas base de la BDG");
  const rows = (await listLayers(base.id)).map((l) => ({
    name: l.name, baseMapId: base.id, baseLayerId: l.id, geometry: l.geometryType,
    featureCount: l.featureCount, bbox: l.bbox ?? null, sourceFormat: l.sourceFormat, style: l.style,
  }));
  await writeFile(out, JSON.stringify(rows, null, 1));
  console.log(rows.map((r) => `${r.name} ${r.geometry} ${r.featureCount}`).join("\n"));
} finally {
  await closeDb();
}
