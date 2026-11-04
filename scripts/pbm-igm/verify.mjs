// Runs INSIDE pma-api after load.mjs: reads every created layer back from the
// NAS and compares it byte for byte with what was staged (vectors: GeoJSON and
// source zip; rasters: the stored original .tif).
//   node verify.mjs <staging root>
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";
import { listLayers, getLayerDataPath } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import { listRasterLayers, getRasterRow } from "/app/dist/apps/api/src/modules/geo/rasterLayersModule.js";
import { getStorage, buildGeoLayerSourcePath } from "/app/dist/apps/api/src/storage/index.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const gunzip = promisify(gunzipCallback);
const [root] = process.argv.slice(2);
const plan = JSON.parse(await readFile(`${root}/plan.json`, "utf8"));
const results = JSON.parse(await readFile(`${root}/results.json`, "utf8"));
const storage = getStorage();
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const shaFile = (p) => new Promise((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

const report = [];
try {
  for (const res of results) {
    const m = plan.maps.find((x) => x.title === res.title);
    const stored = new Map((await listLayers(res.mapId)).map((l) => [l.name, l]));
    for (const l of m.layers) {
      const issues = [];
      const row = stored.get(l.name);
      if (!row) { report.push({ map: res.title, name: l.name, ok: false, issues: ["no está en el mapa"] }); continue; }
      const data = await gunzip(await readFile(storage.resolve(await getLayerDataPath(res.mapId, row.id))));
      const source = await readFile(storage.resolve(buildGeoLayerSourcePath(res.mapId, row.id, "zip")));
      let expectedData, expectedSource;
      if (l.baseLayerId) {
        expectedData = await gunzip(await readFile(storage.resolve(await getLayerDataPath(l.baseMapId, l.baseLayerId))));
        expectedSource = await readFile(storage.resolve(buildGeoLayerSourcePath(l.baseMapId, l.baseLayerId, "zip")));
      } else {
        expectedData = await readFile(`${root}/${l.dataRel}`);
        expectedSource = await readFile(`${root}/${l.sourceRel}`);
      }
      if (sha(data) !== sha(expectedData)) issues.push("GeoJSON distinto");
      if (sha(source) !== sha(expectedSource)) issues.push("zip de origen distinto");
      const fc = JSON.parse(data.toString("utf8"));
      if (fc.features.length !== l.featureCount || row.featureCount !== l.featureCount) {
        issues.push(`registros ${fc.features.length}/${row.featureCount}, se esperaban ${l.featureCount}`);
      }
      if (row.zIndex !== l.zIndex) issues.push(`zIndex ${row.zIndex}, se esperaba ${l.zIndex}`);
      if (row.visible !== l.visible) issues.push(`visible ${row.visible}, se esperaba ${l.visible}`);
      report.push({ map: res.title, name: l.name, ok: issues.length === 0, issues });
    }
    const rasters = new Map((await listRasterLayers(res.mapId)).map((r) => [r.name, r]));
    for (const r of m.rasters) {
      const issues = [];
      const row = rasters.get(r.name);
      if (!row) { report.push({ map: res.title, name: r.name, ok: false, issues: ["ráster no está en el mapa"] }); continue; }
      const full = await getRasterRow(row.id);
      const [a, b] = await Promise.all([shaFile(storage.resolve(full.originalPath)), shaFile(`${root}/rasters/${r.file}`)]);
      if (a !== b) issues.push("original distinto");
      report.push({ map: res.title, name: r.name, raster: true, status: row.status, ok: issues.length === 0, issues });
    }
  }
} finally {
  await writeFile(`${root}/verify.json`, JSON.stringify(report, null, 1));
  await closeDb();
}
const bad = report.filter((r) => !r.ok);
console.log(`verificadas: ${report.length}, correctas: ${report.length - bad.length}, con problema: ${bad.length}`);
for (const r of bad) console.log(`  ${r.map} | ${r.name}: ${r.issues.join("; ")}`);
