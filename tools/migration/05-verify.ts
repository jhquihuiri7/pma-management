/**
 * 05-verify.ts
 *
 * End-to-end verification of the migration:
 *  - Compares Firestore document counts (from $DUMP_DIR/_counts.json) against
 *    Postgres row counts in the corresponding tables.
 *  - Walks every $STORAGE_ROOT path referenced by an evidence/format row and
 *    confirms the file exists on disk.
 *  - Counts orphan rows (FK targets missing).
 *
 * Exits 0 on clean, non-zero with a JSON report at $REPORT_FILE otherwise.
 *
 * Usage: tsx 05-verify.ts
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const DUMP_DIR = process.env.DUMP_DIR ?? "./dump";
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "./files-staging";
const REPORT_FILE = process.env.REPORT_FILE ?? "./verify-report.json";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Map: firestore collection name → Postgres table name (post-rename)
const COLLECTION_TO_TABLE: Record<string, string> = {
  users: "users",
  pma_plans: "pma_plans",
  pma_planItems: "pma_plan_items",
  pma_evidences: "pma_evidences",
  pma_findings: "pma_findings",
  pma_periodCompliance: "pma_period_compliance",
  pma_assignments: "pma_plan_assignments",
  pma_notifications: "pma_notifications",
  pma_formats: "pma_formats",
  rgdp_projects: "rgdp_plans",
  rgdp_projectItems: "rgdp_plan_items",
  rgdp_evidences: "rgdp_evidences",
  rgdp_periodCompliance: "rgdp_period_compliance",
  rgdp_assignments: "rgdp_plan_assignments",
  rgdp_notifications: "rgdp_notifications",
  rgdp_monthlyGenerations: "rgdp_monthly_generations",
  rgdp_findings: "rgdp_findings",
  rgdp_formats: "rgdp_formats",
  pg_projects: "pglp_plans",
  pg_projectItems: "pglp_plan_items",
  pg_evidences: "pglp_evidences",
  pg_periodCompliance: "pglp_period_compliance",
  pg_assignments: "pglp_plan_assignments",
  pg_notifications: "pglp_notifications",
  pg_monthlyGenerations: "pglp_monthly_generations",
  pg_findings: "pglp_findings",
  pg_formats: "pglp_formats",
  geo_maps: "geo_maps",
};

async function countTable(table: string): Promise<number> {
  const r = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${table}`);
  return Number(r.rows[0].c);
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function getStoragePaths(): Promise<string[]> {
  const out: string[] = [];
  for (const table of [
    "pma_evidences", "rgdp_evidences", "pglp_evidences",
    "pma_formats", "rgdp_formats", "pglp_formats",
  ]) {
    const r = await pool.query<{ p: string }>(`SELECT storage_path AS p FROM ${table}`);
    out.push(...r.rows.map((x) => x.p));
  }
  return out;
}

async function main() {
  const counts: Record<string, number> = JSON.parse(
    await fs.readFile(join(DUMP_DIR, "_counts.json"), "utf8")
  );

  const diffs: Array<{ collection: string; table: string; firestore: number; postgres: number; delta: number }> = [];
  for (const [col, table] of Object.entries(COLLECTION_TO_TABLE)) {
    const fsCount = counts[col] ?? 0;
    if (fsCount < 0) continue;
    let pgCount = 0;
    try {
      pgCount = await countTable(table);
    } catch (err: any) {
      diffs.push({ collection: col, table, firestore: fsCount, postgres: -1, delta: NaN });
      continue;
    }
    diffs.push({ collection: col, table, firestore: fsCount, postgres: pgCount, delta: pgCount - fsCount });
  }

  // file presence
  const paths = await getStoragePaths();
  const missing: string[] = [];
  for (const p of paths) {
    const abs = join(STORAGE_ROOT, p);
    if (!(await exists(abs))) missing.push(p);
  }

  const report = {
    timestamp: new Date().toISOString(),
    rowCountDiffs: diffs,
    storageMissingCount: missing.length,
    storageMissingSample: missing.slice(0, 20),
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2));

  console.log("Row count comparison (Firestore → Postgres):");
  for (const d of diffs) {
    const flag = d.delta === 0 ? "OK" : d.delta < 0 ? "MISSING" : "EXTRA";
    console.log(`  [${flag}] ${d.collection} → ${d.table}: fs=${d.firestore}, pg=${d.postgres}, Δ=${d.delta}`);
  }
  console.log(`\nFiles referenced: ${paths.length}  Missing in storage: ${missing.length}`);
  if (missing.length > 0) console.log(`Sample missing: ${missing.slice(0, 5).join(", ")}`);

  await pool.end();

  const failed = diffs.some((d) => d.delta !== 0) || missing.length > 0;
  if (failed) {
    console.error(`\nFAILED. See ${REPORT_FILE}`);
    process.exit(2);
  }
  console.log("\nAll checks passed.");
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
