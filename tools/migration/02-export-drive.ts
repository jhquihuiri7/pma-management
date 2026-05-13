/**
 * 02-export-drive.ts
 *
 * Downloads every Google Drive file referenced by an evidence or format
 * document into $FILES_DIR/<adminId>/<subsystem>/<planId>/<itemId>/<filename>.
 * Produces $MANIFEST_FILE that maps driveFileId → relative storage path.
 *
 * Authentication: uses per-admin OAuth tokens stored in {pma,rgdp,pg}_admins
 * Firestore docs (same scheme the running app uses today). Tokens are
 * refreshed transparently via google-auth-library when they have expired.
 *
 * Idempotent: skips files that already exist in $FILES_DIR.
 *
 * Usage: tsx 02-export-drive.ts
 */
import "dotenv/config";
import { promises as fs, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { google } from "googleapis";
import { fsdb } from "./lib/firebase.js";

const FILES_DIR = process.env.FILES_DIR ?? "./files";
const MANIFEST_FILE = process.env.MANIFEST_FILE ?? "./drive-manifest.json";

interface Manifest {
  // driveFileId → { relativePath, adminId, subsystem, planId, planItemId?, fileName, originalDriveFileId }
  [driveFileId: string]: {
    relativePath: string;
    adminId: string;
    subsystem: "pma" | "rgdp" | "pglp";
    planId: string;
    planItemId?: string;
    fileName: string;
  };
}

async function getDriveClient(adminId: string, adminCollection: string) {
  const adminDoc = await fsdb().collection(adminCollection).doc(adminId).get();
  if (!adminDoc.exists) throw new Error(`Admin ${adminId} not found in ${adminCollection}`);
  const admin = adminDoc.data()!;
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth.setCredentials({
    access_token: admin.googleAccessToken,
    refresh_token: admin.googleRefreshToken,
    expiry_date: admin.tokenExpiresAt,
  });
  return google.drive({ version: "v3", auth: oauth });
}

async function downloadFile(driveClient: ReturnType<typeof google.drive>, fileId: string, dest: string) {
  await fs.mkdir(dirname(dest), { recursive: true });
  const res = await driveClient.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  await pipeline(res.data, createWriteStream(dest));
}

async function processSubsystem(
  subsystem: "pma" | "rgdp" | "pglp",
  evidenceCollection: string,
  formatCollection: string,
  adminCollection: string,
  manifest: Manifest
) {
  console.log(`\nProcessing ${subsystem}...`);
  const db = fsdb();
  const driveByAdmin = new Map<string, ReturnType<typeof google.drive>>();

  async function client(adminId: string) {
    let c = driveByAdmin.get(adminId);
    if (!c) {
      c = await getDriveClient(adminId, adminCollection);
      driveByAdmin.set(adminId, c);
    }
    return c;
  }

  const evSnap = await db.collection(evidenceCollection).get();
  console.log(`  ${evidenceCollection}: ${evSnap.size} evidences`);
  for (const doc of evSnap.docs) {
    const e = doc.data();
    if (!e.driveFileId || !e.fileName) continue;
    const planId = e.planId as string;
    const itemId = (e.planItemId as string | undefined) ?? "_plan";
    // adminId may not be on the evidence; resolve via plan
    let adminId = e.adminId as string | undefined;
    if (!adminId) {
      const planDoc = await db.collection(`${subsystem === "pglp" ? "pg" : subsystem}_${subsystem === "pma" ? "plans" : "projects"}`).doc(planId).get();
      adminId = planDoc.exists ? (planDoc.data()!.adminId as string) : undefined;
    }
    if (!adminId) {
      console.warn(`    evidence ${doc.id}: missing adminId, skipping`);
      continue;
    }
    const relPath = `${adminId}/${subsystem}/${planId}/${itemId}/${e.fileName}`;
    const abs = join(FILES_DIR, relPath);
    if (await exists(abs)) {
      manifest[e.driveFileId] = { relativePath: relPath, adminId, subsystem, planId, planItemId: e.planItemId, fileName: e.fileName };
      continue;
    }
    try {
      const drv = await client(adminId);
      await downloadFile(drv, e.driveFileId, abs);
      manifest[e.driveFileId] = { relativePath: relPath, adminId, subsystem, planId, planItemId: e.planItemId, fileName: e.fileName };
    } catch (err: any) {
      console.warn(`    evidence ${doc.id} (drive ${e.driveFileId}): ${err.message}`);
    }
  }

  const fmtSnap = await db.collection(formatCollection).get();
  console.log(`  ${formatCollection}: ${fmtSnap.size} formats`);
  for (const doc of fmtSnap.docs) {
    const f = doc.data();
    if (!f.driveFileId || !f.fileName || !f.adminId) continue;
    const relPath = `${f.adminId}/${subsystem}/_formats/${f.fileName}`;
    const abs = join(FILES_DIR, relPath);
    if (await exists(abs)) {
      manifest[f.driveFileId] = { relativePath: relPath, adminId: f.adminId, subsystem, planId: "_formats", fileName: f.fileName };
      continue;
    }
    try {
      const drv = await client(f.adminId);
      await downloadFile(drv, f.driveFileId, abs);
      manifest[f.driveFileId] = { relativePath: relPath, adminId: f.adminId, subsystem, planId: "_formats", fileName: f.fileName };
    } catch (err: any) {
      console.warn(`    format ${doc.id} (drive ${f.driveFileId}): ${err.message}`);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  const manifest: Manifest = {};
  if (await exists(MANIFEST_FILE)) {
    Object.assign(manifest, JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8")));
    console.log(`Resuming with ${Object.keys(manifest).length} entries in manifest.`);
  }
  await processSubsystem("pma", "pma_evidences", "pma_formats", "pma_admins", manifest);
  await processSubsystem("rgdp", "rgdp_evidences", "rgdp_formats", "rgdp_admins", manifest);
  await processSubsystem("pglp", "pg_evidences", "pg_formats", "pg_admins", manifest);
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${Object.keys(manifest).length} files → ${MANIFEST_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
