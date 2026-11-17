-- Rollback of 0040_simat_module.sql — SIMAT-GAL.
--
-- NOT run by the migration runner. Rolling the images back is enough: the
-- tables and the 'simat' value in app_key are inert once the api no longer
-- references them. Use this only if they must actually disappear. Every
-- observation, sea level, criterion and sync record is destroyed; dump them
-- first if they matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'simat_*' > simat.sql
--
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where created_at = 1792377600000;
--
-- (`hash` is the SHA-256 of the SQL, not the file name; `created_at` is the
-- migration's `when` in meta/_journal.json.)
DROP TABLE IF EXISTS "simat_sincronizaciones";
DROP TABLE IF EXISTS "simat_criterios";
DROP TABLE IF EXISTS "simat_nivel_mar";
DROP TABLE IF EXISTS "simat_observaciones";
DROP TABLE IF EXISTS "simat_estaciones";

-- PostgreSQL cannot drop one enum value directly. Recreate app_key without
-- 'simat' after deleting the grants that reference it. Keep this list in sync
-- with schema/enums.ts: it is a literal snapshot.
DELETE FROM "user_apps" WHERE "app_key" = 'simat';
ALTER TYPE "public"."app_key" RENAME TO "app_key_with_simat";
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene', 'pg2030', 'plan_familiar', 'riesgos', 'protocolo_limpieza');
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";
DROP TYPE "public"."app_key_with_simat";
