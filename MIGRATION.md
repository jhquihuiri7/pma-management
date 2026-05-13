# Migration Status

This document describes what is implemented, what is scaffolded but pending,
and what must be done before the production cut.

## Architecture (after restructure)

```
pma-management/
├── apps/
│   ├── web/      Next.js 14 frontend (still has all legacy API routes today)
│   └── api/      Fastify backend with Drizzle + Postgres + SMB + SMTP + JWT
├── packages/
│   └── types/    Shared TypeScript types (User, Plan, Evidence, ...)
└── tools/
    └── migration/  Big-bang ETL pipeline (Firestore + Drive → Postgres + Synology)
```

Node 20+. npm workspaces. No Turbo/Nx.

## What is implemented and compiling

| Area | Status | Location |
| --- | --- | --- |
| Workspace structure | ✅ Done | `package.json`, `apps/*`, `packages/*` |
| `next build` of apps/web | ✅ Passes | `apps/web/` |
| `tsc --noEmit` of apps/api | ✅ Passes | `apps/api/` |
| Drizzle schemas (all 4 subsystems) | ✅ Done | `apps/api/src/db/schema/` |
| Drizzle config + migration runner | ✅ Done | `apps/api/drizzle.config.ts`, `src/db/run-migrations.ts` |
| JWT auth (access + refresh, rotation) | ✅ Done | `apps/api/src/auth/`, `src/routes/auth.ts` |
| Password reset / set-password flows | ✅ Done | `apps/api/src/routes/auth.ts` |
| Storage provider interface | ✅ Done | `apps/api/src/storage/index.ts` |
| Synology SMB storage impl (fs over mount) | ✅ Done | `apps/api/src/storage/synology-smb.ts` |
| Mail provider interface | ✅ Done | `apps/api/src/mail/index.ts` |
| SMTP mail impl (nodemailer) | ✅ Done | `apps/api/src/mail/smtp.ts` |
| Storage proxy (`GET /storage/*`) with JWT | ✅ Done | `apps/api/src/routes/storage.ts` |
| Frontend API client w/ refresh | ✅ Done | `apps/web/lib/api-client.ts` |
| ETL: Firestore dump | ✅ Done | `tools/migration/01-export-firestore.ts` |
| ETL: Drive download | ✅ Done | `tools/migration/02-export-drive.ts` |
| ETL: Postgres import | ✅ Done | `tools/migration/03-import-postgres.ts` |
| ETL: Storage copy + checksum | ✅ Done | `tools/migration/04-import-storage.ts` |
| ETL: Verification | ✅ Done | `tools/migration/05-verify.ts` |
| Migration runbook | ✅ Done | `tools/migration/README.md` |
| **PMA** subsystem (plans, items, evidences, findings, period compliance, notifications, formats, users) | ✅ Done | `apps/api/src/modules/pma/`, `apps/api/src/routes/pma/` |
| **RGDP** subsystem (PMA features + waste fields + monthly generations) | ✅ Done | `apps/api/src/modules/rgdp/`, `apps/api/src/routes/rgdp/` |
| **PGLP** subsystem (mirrors RGDP; uses `pglp_*` tables) | ✅ Done | `apps/api/src/modules/pglp/`, `apps/api/src/routes/pglp/` |
| **GEO** maps CRUD | ✅ Done | `apps/api/src/modules/geo/mapsModule.ts`, `apps/api/src/routes/geo/index.ts` |
| Multipart upload (evidence + format) | ✅ Done | `apps/api/src/routes/{pma,rgdp,pglp}/evidences.ts` |
| Frontend `AuthProvider` + `useAuth` hook | ✅ Done | `apps/web/lib/auth-context.tsx` |
| Login / forgot / reset / set-password pages | ✅ Done | `apps/web/app/(auth)/**` — all use `auth.*` from `lib/api-client.ts` |
| `apps/web/middleware.ts` checks `pma_access` cookie | ✅ Done | NextAuth `withAuth` removed; cookie presence only |
| `<AuthProvider>` wired in root layout | ✅ Done | `apps/web/app/layout.tsx` |
| `useSession()` → `useAuth()` across all components | ✅ Done | 22 files migrated |
| Legacy `fetch("/pma/api/...")` calls → `apiFetch(...)` (auto-redirects to backend) | ✅ Done | 27 files; URL rewriting handled by `lib/api-client.ts` |
| Removed: NextAuth, Firebase, Drive, Gmail dependencies | ✅ Done | `apps/web/package.json` |
| Removed: `apps/web/app/api/auth/**`, `apps/web/app/{pma,rgdp,pg,geo}/api/**` | ✅ Done | All Next.js subsystem API routes deleted |
| Removed: `apps/web/services/`, `services-rgdp/`, `services-pg/` | ✅ Done | Logic moved to `apps/api/src/modules/` |
| Removed: `lib/firebase*.ts`, `lib/drive*.ts`, `lib/gmail*.ts`, `lib/auth.ts`, `lib/api-utils.ts` | ✅ Done | All Firebase/Google/NextAuth code removed |
| Removed: `apps/web/types/next-auth.d.ts`, `components/providers/SessionProvider.tsx` | ✅ Done | |
| Removed: `serverComponentsExternalPackages: ["firebase-admin"]` | ✅ Done | `apps/web/next.config.mjs` |

## Remaining items (small, non-blocking)

| Module | Status | Notes |
| --- | --- | --- |
| Document export (item-period, zip) | TODO | New route in `apps/api/src/routes/pma/` using `docx`/`jszip`. Today the frontend still calls `/pma/api/download/item-period` which returns 502 until implemented. |
| RGDP waste catalog endpoint | TODO | Static lookup; serve as JSON or move catalog into a `rgdp_waste_codes` table. |
| Drive migrate endpoint | N/A — delete from UI | Only used by the old Drive-based system. Remove the corresponding admin button from the formats page if still present. |
| Rename `apps/web/app/pg/` → `apps/web/app/pglp/` | OPTIONAL | The `apiFetch` translator already maps `/pg/api/*` → backend `/pglp/*`. URL space alignment is cosmetic; both names work in `AppKey`. |
| Real-time notifications via Firestore onSnapshot | REPLACED | Notifications now poll every 30s via `apiFetch("/pma/api/notifications")`. For true real-time, add SSE or WebSockets on the backend post-cut. |

### How to migrate one route handler (recipe)

1. Read the current handler in `apps/web/app/.../route.ts` and the service
   functions it calls.
2. Create the equivalent module in `apps/api/src/modules/<subsystem>/` using
   Drizzle, mirroring authorization checks. See
   [plansModule.ts](apps/api/src/modules/pma/plansModule.ts) for the pattern.
3. Create the Fastify route in `apps/api/src/routes/<subsystem>/`. Wrap the
   module call with `zod` validation and the `authenticate` + `requireApp` +
   `requireRole` preHandlers as needed.
4. Register the new route in `apps/api/src/routes/<subsystem>/index.ts`.
5. Update the corresponding frontend code to call `api.get(...)` /
   `api.post(...)` from `apps/web/lib/api-client.ts` instead of
   `fetch("/pma/api/...")`.
6. Delete the Next.js route handler when no consumer remains.

## Infrastructure tasks (Fase 0, outside this repo)

- [ ] Provision VPS for Postgres 16. Configure TLS, daily `pg_dump` to
      Synology.
- [ ] Create DB `pma_management`, user `pma_app` with `CREATE`, `INSERT`,
      `UPDATE`, `DELETE`, `SELECT`, `USAGE` on schema `public`.
- [ ] Configure Synology share `pma-data`. Create service account with R/W
      permission. Enable SMB v3.
- [ ] Mount Synology on backend host: install `cifs-utils`, add `/etc/fstab`
      entry with `vers=3.0,credentials=/etc/cifs.creds,uid=...`. Verify with
      `touch /mnt/synology/pma-data/.write-test`.
- [ ] Confirm contracted email service. Capture SMTP host/port/user/pass and
      set `SMTP_FROM`.
- [ ] Generate JWT secrets: `openssl rand -base64 48` for `JWT_ACCESS_SECRET`
      and `JWT_REFRESH_SECRET`.
- [ ] Configure reverse proxy (nginx/caddy/traefik) so `app.tudominio.com`
      serves `apps/web` and `api.tudominio.com` serves `apps/api`.

## Migration cut checklist (Fase 7)

1. Announce maintenance window. Display banner in the live app.
2. Freeze writes (read-only mode, or take the app offline entirely).
3. `cd tools/migration && npm run export:firestore`.
4. `npm run export:drive` (longest step; resumable).
5. `npm run import:postgres`.
6. `npm run import:storage`.
7. `npm run verify`. Must exit 0.
8. Smoke test against the new stack:
   - Login as admin → list plans → create plan → upload evidence → validate.
   - Login as reporter, upload evidence, see notification go to admin.
   - Login as viewer, see assigned plan.
   - Reset password by email.
9. Flip DNS / proxy to new backend.
10. Keep Firestore + Drive read-only for 30 days.

## Post-cut cleanup checklist (Fase 8)

After the new stack runs cleanly for 1–2 weeks:

- [ ] Delete `apps/web/services/`, `services-rgdp/`, `services-pg/`.
- [ ] Delete `apps/web/lib/firebase.ts`, `firebase-admin.ts`, `drive*.ts`,
      `gmail*.ts`, `auth.ts`, `api-utils.ts`.
- [ ] Delete `apps/web/app/api/auth/[...nextauth]/`.
- [ ] Delete `apps/web/app/**/api/**` once every consumer has migrated.
- [ ] Remove from `apps/web/package.json`: `firebase`, `firebase-admin`,
      `googleapis`, `next-auth`.
- [ ] Remove `serverComponentsExternalPackages: ["firebase-admin"]` from
      `apps/web/next.config.mjs`.
- [ ] Delete `apps/web/types/next-auth.d.ts`.
- [ ] Revoke the Google OAuth client used by the old admin tokens.
- [ ] Archive the Firebase project and disable billing.
- [ ] Update `MIGRATION.md` to reflect completion; delete this file.

## Known unknowns

- **Firestore ids**: the current schema assumes ids are valid UUIDs (the
  Drizzle columns are `uuid`). The legacy code uses Firestore auto-ids,
  which are not UUIDs. If verification fails because of this, add a
  pre-import step that builds `LEGACY_ID_MAP` and inserts deterministic
  UUID v5 values derived from the legacy ids.
- **Drive folder hierarchy**: storage_path is computed as
  `<adminId>/<sub>/<planId>/<itemId>/<filename>`. If the live app stores
  files with non-ASCII names that the Synology share rejects, normalize in
  `02-export-drive.ts` (replace with sanitized name and update the
  manifest).
