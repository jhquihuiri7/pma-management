// Runs INSIDE pma-api after load.mjs. Reads every loaded layer back from the
// catalog and the NAS and compares it with what was staged.
// Usage: node verify.mjs <staging root>
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { listLayers, getLayerDataPath } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import { getStorage } from "/app/dist/apps/api/src/storage/index.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const [root] = process.argv.slice(2);
const plan = JSON.parse(await readFile(`${root}/plan.json`, "utf8"));
const results = JSON.parse(await readFile(`${root}/results.json`, "utf8"));
const storage = getStorage();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const report = [];

try {
  for (const res of results) {
    const planned = plan.maps.find((m) => m.folder === res.folder);
    const rows = new Map((await listLayers(res.mapId)).map((l) => [l.id, l]));
    for (const out of res.layers) {
      if (!out.layerId) { report.push({ folder: res.folder, name: out.name, ok: false, why: out.error }); continue; }
      const p = planned.layers.find((l) => l.name === out.name);
      const row = rows.get(out.layerId);
      const checks = { folder: res.folder, name: out.name, layerId: out.layerId };
      try {
        const stored = gunzipSync(await readFile(storage.resolve(await getLayerDataPath(res.mapId, out.layerId))));
        const staged = await readFile(`${root}/${p.dataRel}`);
        const fc = JSON.parse(stored.toString("utf8"));
        const storedSource = await readFile(storage.resolve(row.sourcePath ?? `GEO/maps/${res.mapId}/layers/${out.layerId}/source.zip`));
        const stagedSource = await readFile(`${root}/${p.sourceRel}`);
        Object.assign(checks, {
          dbFeatureCount: row.featureCount,
          storedFeatureCount: fc.features.length,
          dataIdentical: sha(stored) === sha(staged),
          sourceIdentical: sha(storedSource) === sha(stagedSource),
          zIndexOk: row.zIndex === p.zIndex,
          visibleOk: row.visible === p.visible,
          replacementChars: (stored.toString("utf8").match(/�/g) || []).length,
        });
        checks.ok = checks.dataIdentical && checks.sourceIdentical && checks.zIndexOk && checks.visibleOk
          && checks.dbFeatureCount === checks.storedFeatureCount && checks.replacementChars === 0;
      } catch (err) {
        Object.assign(checks, { ok: false, why: err instanceof Error ? err.message : String(err) });
      }
      report.push(checks);
    }
  }
} finally {
  await writeFile(`${root}/verify.json`, JSON.stringify(report, null, 1));
  await closeDb();
}
const bad = report.filter((r) => !r.ok);
console.log(`verificadas: ${report.length}, correctas: ${report.length - bad.length}, con problema: ${bad.length}`);
for (const r of bad) console.log(`  ✗ ${r.folder}/${r.name}: ${r.why ?? JSON.stringify(r)}`);
