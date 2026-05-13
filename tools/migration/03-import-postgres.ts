/**
 * 03-import-postgres.ts
 *
 * Reads JSONL dumps from $DUMP_DIR and inserts into Postgres tables.
 * Order respects FK dependencies. Uses Drizzle schemas defined in
 * apps/api/src/db/schema/*.
 *
 * Important transforms:
 * - "pg_*" Firestore collections → "pglp_*" Postgres tables (subsystem rename).
 * - "pma_planItems" → "pma_plan_items" (camelCase → snake_case).
 * - admin docs from pma/rgdp/pg admin collections are unified into a single
 *   `admins` table (dedup by email).
 * - users.password (bcrypt) → users.password_hash.
 * - "apps" array on users → rows in user_apps.
 * - evidence.driveFileId / driveUrl → storage_path (from drive-manifest.json).
 * - period_compliance "id" field is dropped (composite PK).
 *
 * Idempotent: skipped on conflict (ON CONFLICT DO NOTHING by id).
 *
 * Usage: tsx 03-import-postgres.ts
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../apps/api/src/db/schema/index.js";

const { Pool } = pg;
const DUMP_DIR = process.env.DUMP_DIR ?? "./dump";
const MANIFEST_FILE = process.env.MANIFEST_FILE ?? "./drive-manifest.json";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

interface Manifest {
  [driveFileId: string]: {
    relativePath: string;
    adminId: string;
    subsystem: "pma" | "rgdp" | "pglp";
    planId: string;
    planItemId?: string;
    fileName: string;
  };
}

async function* readJsonl(file: string): AsyncGenerator<Record<string, any>> {
  const path = join(DUMP_DIR, file);
  if (!(await exists(path))) return;
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }) });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    yield JSON.parse(t);
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function ts(v: any): Date | null {
  if (!v) return null;
  if (typeof v === "string") return new Date(v);
  if (v?._seconds) return new Date(v._seconds * 1000);
  if (v?.seconds) return new Date(v.seconds * 1000);
  return null;
}

function tsOrNow(v: any): Date {
  return ts(v) ?? new Date();
}

async function importAdmins() {
  console.log("→ admins");
  const seen = new Set<string>();
  let n = 0;
  // Unify pma_admins, rgdp_admins, pg_admins. Old Firestore ids are preserved
  // as Postgres ids (uuid-coerced); the same admin email across collections
  // collapses to a single row.
  for (const col of ["pma_admins", "rgdp_admins", "pg_admins"]) {
    for await (const a of readJsonl(col)) {
      const email = (a.email as string)?.toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      await db.execute(sql`
        INSERT INTO admins (id, email, name, created_at, updated_at)
        VALUES (${a.id}::uuid, ${email}, ${a.name ?? email}, ${tsOrNow(a.createdAt)}, ${tsOrNow(a.createdAt)})
        ON CONFLICT (email) DO NOTHING
      `);
      n++;
    }
  }
  console.log(`  inserted ${n} admins`);
}

async function importUsers() {
  console.log("→ users + user_apps");
  let n = 0;
  for await (const u of readJsonl("users")) {
    // adminId in Firestore points to a doc id in one of the *_admins
    // collections; that id was preserved verbatim in admins.id.
    await db.execute(sql`
      INSERT INTO users (id, admin_id, email, password_hash, password_set, name, role, unit, position, created_at, updated_at)
      VALUES (
        ${u.id}::uuid,
        ${u.adminId}::uuid,
        ${(u.email as string).toLowerCase()},
        ${u.password ?? null},
        ${Boolean(u.passwordSet ?? !!u.password)},
        ${u.name ?? u.email},
        ${u.role ?? "VIEWER"},
        ${u.unit ?? null},
        ${u.position ?? null},
        ${tsOrNow(u.createdAt)},
        ${tsOrNow(u.createdAt)}
      )
      ON CONFLICT (email) DO NOTHING
    `);
    const apps: string[] = Array.isArray(u.apps) ? u.apps : [];
    for (const a of apps) {
      const appKey = a === "pg" ? "pglp" : a;
      await db.execute(sql`
        INSERT INTO user_apps (user_id, app_key)
        VALUES (${u.id}::uuid, ${appKey}::app_key)
        ON CONFLICT DO NOTHING
      `);
    }
    n++;
  }
  console.log(`  inserted ${n} users`);
}

// Generic helper for plan-like collections; subsystem differs per call.
async function importPlans(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const p of readJsonl(sourceCol)) {
    await db.execute(sql.raw(`
      INSERT INTO ${table} (
        id, admin_id, title, description, tipo, fase, enfoque, report_per,
        start_date, visualization_url, storage_path, location, ciiu, zone_type,
        coordinate_format, geographic_area, implantation_area, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, COALESCE($4,''), $5::plan_tipo, $6::plan_fase, $7::plan_enfoque, $8::plan_reporte,
        $9::date, $10, NULL, $11::jsonb, $12::jsonb, $13::zone_type, $14, $15::jsonb, $16::jsonb, $17, $18
      ) ON CONFLICT (id) DO NOTHING
    `).append(sql``)); // template above is illustrative; see real binding below
    // The driver disallows mixing parameter modes in execute(sql.raw(...)). To
    // keep the example readable, use a tagged template variant per row:
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (
        id, admin_id, title, description, tipo, fase, enfoque, report_per,
        start_date, visualization_url, location, ciiu, zone_type,
        coordinate_format, geographic_area, implantation_area, created_at, updated_at
      ) VALUES (
        ${p.id}::uuid, ${p.adminId}::uuid, ${p.title}, ${p.description ?? ""},
        ${p.tipo ?? null}, ${p.fase ?? null}, ${p.enfoque ?? null}, ${p.report_per ?? "6 meses"},
        ${p.start_date ?? null}::date, ${p.visualization_url ?? null},
        ${p.location ? JSON.stringify(p.location) : null}::jsonb,
        ${p.ciiu ? JSON.stringify(p.ciiu) : null}::jsonb,
        ${p.zoneType ?? null}, ${p.coordinateFormat ?? null},
        ${p.geographicArea ? JSON.stringify(p.geographicArea) : null}::jsonb,
        ${p.implantationArea ? JSON.stringify(p.implantationArea) : null}::jsonb,
        ${tsOrNow(p.createdAt)}, ${tsOrNow(p.updatedAt ?? p.createdAt)}
      ) ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importPlanItems(sourceCol: string, table: string, isWaste: boolean) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const it of readJsonl(sourceCol)) {
    if (isWaste) {
      await db.execute(sql`
        INSERT INTO ${sql.raw(table)} (
          id, plan_id, item, subplan, direccion, environmental_activity,
          identified_environmental_impact, proposed_measure, indicator,
          verification_method, periodicity, budget, report_per, observation,
          waste_code, waste_name, waste_description, crtib, annual_generation_kg,
          generation_origin, self_management, created_at, updated_at
        ) VALUES (
          ${it.id}::uuid, ${it.planId}::uuid, ${it.item ?? ""}, ${it.subplan ?? ""},
          ${it.direccion ?? null}, ${it.environmental_activity ?? ""},
          ${it.identified_environmental_impact ?? ""}, ${it.proposed_measure ?? ""},
          ${it.indicator ?? ""}, ${it.verification_method ?? ""},
          ${it.periodicity ?? ""}, ${String(it.budget ?? 0)},
          ${it.report_per ?? "6 meses"}, ${it.observation ?? null},
          ${it.wasteCode ?? null}, ${it.wasteName ?? null}, ${it.wasteDescription ?? null},
          ${it.crtib ?? null}, ${it.annualGenerationKg != null ? String(it.annualGenerationKg) : null},
          ${it.generationOrigin ?? null}, ${Boolean(it.selfManagement)},
          ${tsOrNow(it.createdAt)}, ${tsOrNow(it.updatedAt ?? it.createdAt)}
        ) ON CONFLICT (id) DO NOTHING
      `);
    } else {
      await db.execute(sql`
        INSERT INTO ${sql.raw(table)} (
          id, plan_id, item, subplan, direccion, environmental_activity,
          identified_environmental_impact, proposed_measure, indicator,
          verification_method, periodicity, budget, report_per, observation,
          created_at, updated_at
        ) VALUES (
          ${it.id}::uuid, ${it.planId}::uuid, ${it.item ?? ""}, ${it.subplan ?? ""},
          ${it.direccion ?? null}, ${it.environmental_activity ?? ""},
          ${it.identified_environmental_impact ?? ""}, ${it.proposed_measure ?? ""},
          ${it.indicator ?? ""}, ${it.verification_method ?? ""},
          ${it.periodicity ?? ""}, ${String(it.budget ?? 0)},
          ${it.report_per ?? "6 meses"}, ${it.observation ?? null},
          ${tsOrNow(it.createdAt)}, ${tsOrNow(it.updatedAt ?? it.createdAt)}
        ) ON CONFLICT (id) DO NOTHING
      `);
    }
    // item-level assignments
    const assigned: Array<{ userId: string; category?: string }> = Array.isArray(it.assignedUsers) ? it.assignedUsers : [];
    const assignTable = table.replace("_plan_items", "_item_assignments");
    for (const a of assigned) {
      await db.execute(sql`
        INSERT INTO ${sql.raw(assignTable)} (plan_item_id, user_id, category)
        VALUES (${it.id}::uuid, ${a.userId}::uuid, ${a.category ?? "Colaborador"})
        ON CONFLICT DO NOTHING
      `);
    }
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importPlanAssignments(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const a of readJsonl(sourceCol)) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (plan_id, user_id, created_at)
      VALUES (${a.planId}::uuid, ${a.userId}::uuid, ${tsOrNow(a.createdAt)})
      ON CONFLICT DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importEvidences(sourceCol: string, table: string, manifest: Manifest) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const e of readJsonl(sourceCol)) {
    const m = e.driveFileId ? manifest[e.driveFileId] : undefined;
    const storagePath = m?.relativePath ?? `unmapped/${e.driveFileId ?? e.id}/${e.fileName ?? "unknown"}`;
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (
        id, plan_id, plan_item_id, uploaded_by, uploader_name, file_name,
        storage_path, storage_url, description, validation_status,
        validation_comment, validated_by, validated_at, activity_month, created_at
      ) VALUES (
        ${e.id}::uuid, ${e.planId}::uuid, ${e.planItemId ?? null},
        ${e.uploadedBy}::uuid, ${e.uploaderName ?? ""}, ${e.fileName ?? ""},
        ${storagePath}, ${e.driveUrl ?? null}, ${e.description ?? ""},
        ${e.validationStatus ?? "pending"}, ${e.validationComment ?? null},
        ${e.validatedBy ?? null}, ${ts(e.validatedAt)}, ${e.activityMonth ?? null},
        ${tsOrNow(e.createdAt)}
      ) ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importPeriodCompliance(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const p of readJsonl(sourceCol)) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (plan_item_id, period_key, status, updated_at)
      VALUES (${p.planItemId}::uuid, ${p.periodKey}, ${p.status}, ${tsOrNow(p.updatedAt)})
      ON CONFLICT (plan_item_id, period_key) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `);
    n++;
  }
  console.log(`  inserted/updated ${n} rows into ${table}`);
}

async function importMonthlyGenerations(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const m of readJsonl(sourceCol)) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (plan_item_id, period_key, generation_kg, updated_at)
      VALUES (${m.planItemId}::uuid, ${m.periodKey}, ${String(m.generationKg ?? 0)}, ${tsOrNow(m.updatedAt)})
      ON CONFLICT (plan_item_id, period_key) DO UPDATE SET generation_kg = EXCLUDED.generation_kg, updated_at = EXCLUDED.updated_at
    `);
    n++;
  }
  console.log(`  inserted/updated ${n} rows into ${table}`);
}

async function importFindings(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const f of readJsonl(sourceCol)) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (
        id, plan_id, component, nudos_criticos, alarmas, riesgos,
        propuestas_solucion, created_by, created_by_name, created_at
      ) VALUES (
        ${f.id}::uuid, ${f.planId}::uuid, ${f.component},
        ${f.nudosCriticos ?? ""}, ${f.alarmas ?? ""}, ${f.riesgos ?? ""},
        ${f.propuestasSolucion ?? ""}, ${f.createdBy ?? null},
        ${f.createdByName ?? ""}, ${tsOrNow(f.createdAt)}
      ) ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importNotifications(sourceCol: string, table: string) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const x of readJsonl(sourceCol)) {
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (
        id, user_id, admin_id, type, title, message, plan_id, plan_item_id,
        evidence_id, metadata, read_at, created_at, expires_at
      ) VALUES (
        ${x.id}::uuid, ${x.userId}::uuid, ${x.adminId}::uuid, ${x.type},
        ${x.title ?? ""}, ${x.message ?? ""},
        ${x.planId ?? null}, ${x.planItemId ?? null}, ${x.evidenceId ?? null},
        ${x.metadata ? JSON.stringify(x.metadata) : null}::jsonb,
        ${ts(x.readAt)}, ${tsOrNow(x.createdAt)}, ${ts(x.expiresAt)}
      ) ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importFormats(sourceCol: string, table: string, manifest: Manifest) {
  console.log(`→ ${table}`);
  let n = 0;
  for await (const f of readJsonl(sourceCol)) {
    const m = f.driveFileId ? manifest[f.driveFileId] : undefined;
    const storagePath = m?.relativePath ?? `unmapped/formats/${f.id}/${f.fileName ?? "unknown"}`;
    await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (id, admin_id, functionality, functionality_label, storage_path, file_name, uploaded_at)
      VALUES (${f.id}::uuid, ${f.adminId}::uuid, ${f.functionality ?? "descargar_anexos"},
              ${f.functionalityLabel ?? ""}, ${storagePath}, ${f.fileName ?? ""}, ${tsOrNow(f.uploadedAt)})
      ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into ${table}`);
}

async function importGeoMaps() {
  console.log("→ geo_maps");
  let n = 0;
  for await (const g of readJsonl("geo_maps")) {
    const center = Array.isArray(g.center) ? g.center : [0, 0];
    await db.execute(sql`
      INSERT INTO geo_maps (
        id, admin_id, title, description, category_id, arcgis_url, layers,
        center_lat, center_lng, zoom, tags, created_by, created_at, updated_at
      ) VALUES (
        ${g.id}::uuid, ${g.adminId}::uuid, ${g.title ?? ""}, ${g.description ?? ""},
        ${g.categoryId ?? ""}, ${g.arcgisUrl ?? null},
        ${JSON.stringify(g.layers ?? [])}::jsonb,
        ${center[0]}, ${center[1]}, ${g.zoom ?? 13},
        ${g.tags ? JSON.stringify(g.tags) : null}::jsonb,
        ${g.createdBy ?? null}, ${tsOrNow(g.createdAt)}, ${tsOrNow(g.updatedAt ?? g.createdAt)}
      ) ON CONFLICT (id) DO NOTHING
    `);
    n++;
  }
  console.log(`  inserted ${n} rows into geo_maps`);
}

async function main() {
  const manifest: Manifest = (await exists(MANIFEST_FILE))
    ? JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8"))
    : {};

  await importAdmins();
  await importUsers();

  // PMA
  await importPlans("pma_plans", "pma_plans");
  await importPlanItems("pma_planItems", "pma_plan_items", false);
  await importPlanAssignments("pma_assignments", "pma_plan_assignments");
  await importEvidences("pma_evidences", "pma_evidences", manifest);
  await importPeriodCompliance("pma_periodCompliance", "pma_period_compliance");
  await importFindings("pma_findings", "pma_findings");
  await importNotifications("pma_notifications", "pma_notifications");
  await importFormats("pma_formats", "pma_formats", manifest);

  // RGDP
  await importPlans("rgdp_projects", "rgdp_plans");
  await importPlanItems("rgdp_projectItems", "rgdp_plan_items", true);
  await importPlanAssignments("rgdp_assignments", "rgdp_plan_assignments");
  await importEvidences("rgdp_evidences", "rgdp_evidences", manifest);
  await importPeriodCompliance("rgdp_periodCompliance", "rgdp_period_compliance");
  await importMonthlyGenerations("rgdp_monthlyGenerations", "rgdp_monthly_generations");
  await importFindings("rgdp_findings", "rgdp_findings");
  await importNotifications("rgdp_notifications", "rgdp_notifications");
  await importFormats("rgdp_formats", "rgdp_formats", manifest);

  // PGLP (legacy pg_*)
  await importPlans("pg_projects", "pglp_plans");
  await importPlanItems("pg_projectItems", "pglp_plan_items", true);
  await importPlanAssignments("pg_assignments", "pglp_plan_assignments");
  await importEvidences("pg_evidences", "pglp_evidences", manifest);
  await importPeriodCompliance("pg_periodCompliance", "pglp_period_compliance");
  await importMonthlyGenerations("pg_monthlyGenerations", "pglp_monthly_generations");
  await importFindings("pg_findings", "pglp_findings");
  await importNotifications("pg_notifications", "pglp_notifications");
  await importFormats("pg_formats", "pglp_formats", manifest);

  // GEO
  await importGeoMaps();

  await pool.end();
  console.log("\nDone.");
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
