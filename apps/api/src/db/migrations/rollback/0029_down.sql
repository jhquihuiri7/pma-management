-- Rollback of 0029_pg2030_module.sql — PG2030.
--
-- NOT run by the migration runner. Rolling the images back is enough: the
-- 'pg2030' value in app_key is inert once the api no longer references it. Use
-- this only if the value must actually disappear.
--
-- Run it inside a single transaction:
--
--   docker compose exec -T postgres psql -U postgres -d pma_db -v ON_ERROR_STOP=1 \
--     --single-transaction -f /tmp/0029_down.sql
--
-- And afterwards, so the runner does not think 0029 is still applied:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0029_pg2030_module%';

-- Postgres cannot remove a value from an enum. The type has to be rebuilt, and
-- every column that uses it re-pointed at the new one.
--
-- Any user_apps row granting 'pg2030' has to go first — otherwise the USING
-- cast below fails on a value the new type does not have.
DELETE FROM "user_apps" WHERE "app_key" = 'pg2030';

ALTER TYPE "public"."app_key" RENAME TO "app_key_old";

-- Recreate WITHOUT 'pg2030'. Keep this list in sync with schema/enums.ts: it
-- is a literal snapshot, so a value added between 0029 and the rollback would be
-- silently dropped here.
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene');

ALTER TABLE "user_apps"
  ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";

DROP TYPE "public"."app_key_old";
