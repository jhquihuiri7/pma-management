/**
 * 04-import-storage.ts
 *
 * Copies the staging directory $FILES_DIR (populated by 02-export-drive.ts)
 * to the final storage destination $STORAGE_ROOT, preserving the directory
 * hierarchy. The destination is expected to be a CIFS/SMB mount of the
 * Synology share in production.
 *
 * Verifies each file by comparing source and destination SHA-256 checksums.
 *
 * Idempotent: skips files where destination already exists with matching
 * checksum.
 *
 * Usage: tsx 04-import-storage.ts
 */
import "dotenv/config";
import { promises as fs, createReadStream } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";

const FILES_DIR = process.env.FILES_DIR ?? "./files";
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "./files-staging";

async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  let copied = 0, skipped = 0, failed = 0;
  console.log(`Copying ${FILES_DIR} → ${STORAGE_ROOT}`);

  if (!(await exists(FILES_DIR))) {
    console.error(`Staging dir ${FILES_DIR} does not exist; run 02-export-drive.ts first.`);
    process.exit(1);
  }
  await fs.mkdir(STORAGE_ROOT, { recursive: true });

  for await (const src of walk(FILES_DIR)) {
    const rel = relative(FILES_DIR, src);
    const dst = join(STORAGE_ROOT, rel);
    if (await exists(dst)) {
      const [a, b] = await Promise.all([hashFile(src), hashFile(dst)]);
      if (a === b) { skipped++; continue; }
    }
    try {
      await fs.mkdir(dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      const [a, b] = await Promise.all([hashFile(src), hashFile(dst)]);
      if (a !== b) {
        console.warn(`  checksum mismatch after copy: ${rel}`);
        failed++;
        continue;
      }
      copied++;
      if (copied % 100 === 0) console.log(`  copied ${copied}...`);
    } catch (err: any) {
      console.warn(`  ${rel}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nCopied: ${copied}  Skipped (already matched): ${skipped}  Failed: ${failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
