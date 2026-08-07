-- Rollback of 0018_previene_module.sql — Galápagos Previene.
--
-- NOT run by the migration runner, and not expected to be run at all. It exists
-- because 0018 is the only irreversible step of the deploy, and the shape of the
-- undo should be decided while the schema is fresh in mind rather than during an
-- incident.
--
-- WHEN TO USE IT: almost never. Rolling the images back is enough — the four
-- previene_* tables and the 'previene' value in app_key are inert once the api
-- and worker no longer reference them. Use this only if the tables must actually
-- disappear (a clean re-run of the migration, an audit that objects to unused
-- structures).
--
-- ORDER MATTERS. Run it inside a single transaction:
--
--   docker compose exec -T postgres psql -U postgres -d pma_db -v ON_ERROR_STOP=1 \
--     --single-transaction -f /tmp/0018_down.sql
--
-- And afterwards, so the runner does not think 0018 is still applied:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0018_previene_module%';

-- ── 1. The tables ──────────────────────────────────────────────────────────
-- previene_media has an ON DELETE CASCADE FK onto previene_reports, so it goes
-- first. Nothing outside this module references any of them.
DROP TABLE IF EXISTS "previene_media";
DROP TABLE IF EXISTS "previene_sync_state";
DROP TABLE IF EXISTS "previene_event_types";
DROP TABLE IF EXISTS "previene_reports";

-- ── 2. The enum value ──────────────────────────────────────────────────────
-- Postgres cannot remove a value from an enum. The type has to be rebuilt, and
-- every column that uses it re-pointed at the new one.
--
-- STOP HERE unless the value must genuinely go: leaving 'previene' in app_key
-- costs nothing, while this block rewrites a column on a live table.
--
-- Any user_apps row granting 'previene' has to go first — otherwise the USING
-- cast below fails on a value the new type does not have.

DELETE FROM "user_apps" WHERE "app_key" = 'previene';

ALTER TYPE "public"."app_key" RENAME TO "app_key_old";

-- Recreate WITHOUT 'previene'. Keep this list in sync with schema/enums.ts: it
-- is a literal snapshot, so a value added between 0018 and the rollback would be
-- silently dropped here.
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo');

ALTER TABLE "user_apps"
  ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";

DROP TYPE "public"."app_key_old";
