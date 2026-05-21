/**
 * 01-export-firestore.ts
 *
 * Dumps every Firestore collection used by the app into JSONL files under
 * $DUMP_DIR (one document per line). Run during the migration cut after
 * writes have been frozen.
 *
 * Usage: tsx 01-export-firestore.ts
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { fsdb } from "./lib/firebase.js";

const DUMP_DIR = process.env.DUMP_DIR ?? "./dump";

const COLLECTIONS = [
  // shared
  "users",
  "pma_admins",
  "rgdp_admins",

  // PMA
  "pma_plans",
  "pma_planItems",
  "pma_evidences",
  "pma_findings",
  "pma_periodCompliance",
  "pma_assignments",
  "pma_notifications",
  "pma_formats",

  // RGDP
  "rgdp_projects",
  "rgdp_projectItems",
  "rgdp_evidences",
  "rgdp_periodCompliance",
  "rgdp_assignments",
  "rgdp_notifications",
  "rgdp_monthlyGenerations",
  "rgdp_findings",
  "rgdp_formats",

  // GEO
  "geo_maps",
];

async function dumpCollection(name: string) {
  const db = fsdb();
  const snap = await db.collection(name).get();
  const path = join(DUMP_DIR, `${name}.jsonl`);
  await fs.mkdir(DUMP_DIR, { recursive: true });
  let count = 0;
  const handle = await fs.open(path, "w");
  try {
    for (const doc of snap.docs) {
      const data = doc.data();
      const line = JSON.stringify({ id: doc.id, ...data });
      await handle.write(line + "\n");
      count++;
    }
  } finally {
    await handle.close();
  }
  console.log(`  ${name}: ${count} docs → ${path}`);
  return count;
}

async function main() {
  console.log(`Exporting Firestore collections to ${DUMP_DIR}/`);
  const counts: Record<string, number> = {};
  for (const c of COLLECTIONS) {
    try {
      counts[c] = await dumpCollection(c);
    } catch (err: any) {
      console.warn(`  ${c}: SKIPPED (${err.message})`);
      counts[c] = -1;
    }
  }
  await fs.writeFile(join(DUMP_DIR, "_counts.json"), JSON.stringify(counts, null, 2));
  const total = Object.values(counts).filter((n) => n >= 0).reduce((a, b) => a + b, 0);
  console.log(`Done. Total documents: ${total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
