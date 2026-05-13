# Migration runbook — Firestore + Drive → Postgres + Synology

This directory contains the ETL pipeline for the big-bang migration from the
legacy Firestore + Google Drive + Gmail stack to PostgreSQL + Synology SMB +
SMTP.

## Prerequisites

Before the cut you must have working:

1. PostgreSQL 16 reachable at `DATABASE_URL` with `pma_management` DB
   created and `pma_app` user owning it.
2. Schema applied: `cd ../../apps/api && npm run db:generate && npm run db:migrate`.
3. SMB share mounted at `STORAGE_ROOT` (e.g. `/mnt/synology/pma-data`)
   with write permission for the user running the scripts.
4. `tools/migration/.env` populated (see `.env.example`).
5. Read access to production Firestore via service-account JSON
   (`FIREBASE_ADMIN_*` or `GOOGLE_APPLICATION_CREDENTIALS`).
6. Google OAuth client credentials matching the ones the admins authorized
   (so per-admin tokens stored in `*_admins` can be refreshed during download).

## Dry run (days before the cut)

Run the full pipeline against a staging Postgres and a staging SMB share with
a recent Firestore export. Time each step. Iterate on `05-verify.ts` until the
report is clean.

## Order of execution (during the cut)

```
# 1. Freeze writes — put the live app behind a maintenance banner.

cd tools/migration
cp .env.example .env       # then edit

# 2. Dump Firestore. ~10–30 min depending on volume.
npm run export:firestore

# 3. Download every Drive file. SLOW — usually the longest step.
#    Resumable: re-run to pick up where it stopped.
npm run export:drive

# 4. Import structured data into Postgres. ~5–20 min.
npm run import:postgres

# 5. Copy files into Synology mount with checksum verification.
npm run import:storage

# 6. Verify counts & file presence. Must report 0 diffs and 0 missing.
npm run verify
```

## What each script does

| Script | Reads | Writes |
| --- | --- | --- |
| `01-export-firestore.ts` | Firestore (all collections) | `dump/*.jsonl`, `dump/_counts.json` |
| `02-export-drive.ts` | Firestore + Google Drive | `files/<adminId>/<sub>/<plan>/<item>/<name>`, `drive-manifest.json` |
| `03-import-postgres.ts` | `dump/*.jsonl`, `drive-manifest.json` | Postgres (all tables) |
| `04-import-storage.ts` | `files/**` | `$STORAGE_ROOT/**` (with checksum check) |
| `05-verify.ts` | `dump/_counts.json`, Postgres, `$STORAGE_ROOT` | `verify-report.json`, exit code |

## Important transforms applied in step 3

- Firestore `pg_*` collections → Postgres `pglp_*` tables (subsystem rename).
- Firestore `*_admins` (one per subsystem) → unified `admins` table, dedup by
  email. Original `id` is preserved as the primary key of the surviving row.
- `users.password` (bcrypt hash) → `users.password_hash`. `passwordSet` becomes
  `true` if a hash exists.
- `users.apps[]` → rows in `user_apps`. `"pg"` is rewritten to `"pglp"`.
- `Evidence.driveFileId` → `evidences.storage_path` (looked up in
  `drive-manifest.json`). `driveUrl` is preserved in `storage_url` for
  forensic purposes but is not used by the running app.
- Document `id`s are kept verbatim and inserted into `uuid` columns. If
  legacy ids are not valid UUIDs you must coerce them before this step —
  add a `LEGACY_ID_MAP` table or convert via `uuid-v5`.
- Camel-case Firestore field names are mapped to snake-case columns.
- `period_compliance` and `monthly_generations` use composite PKs; the
  Firestore-side `id` is dropped.

## Rollback

If `05-verify.ts` fails or the post-cut smoke test surfaces a critical issue
within the first 24 hours:

1. Revert DNS / reverse proxy to point at the old `apps/web` deployment using
   NextAuth + Firestore + Drive.
2. The Firestore database is untouched (the pipeline never writes to it).
   Drive files are untouched. Postgres and Synology can be wiped without data
   loss.
3. Triage the failure, fix the script, and re-attempt during the next window.

Keep Firestore + Drive read-only for **at least 30 days** post-cut before
decommissioning, to give time for hidden issues to surface.

## Open items requiring decisions before the cut

- **Legacy ids and UUIDs**: confirm that Firestore document ids are RFC 4122
  UUIDs. The current generator (`adminDb.collection(...).doc()`) produces
  random ids that are not UUIDs; for those, add a translation map.
- **Email service**: confirm SMTP credentials and `SMTP_FROM` before the cut,
  otherwise the "establece tu contraseña" emails to legacy OAuth-only admins
  will fail.
- **SMB credentials**: the user running step 4 must have write permission to
  every subfolder. If using `/etc/fstab` with `noperm`, verify writes succeed
  before depending on it.
