-- Rollback of 0035_riesgos_module.sql — Gestión de Riesgos.
--
-- NOT run by the migration runner. Rolling the images back is enough: the
-- tables and the 'riesgos' value in app_key are inert once the api no longer
-- references them. Use this only if they must actually disappear. Every ficha,
-- resource and COE designation is destroyed; dump them first if they matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'riesgos_*' > riesgos.sql
--
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0035_riesgos_module%';
DROP TABLE IF EXISTS "riesgos_delegaciones";
DROP TABLE IF EXISTS "riesgos_recursos";
DROP TABLE IF EXISTS "riesgos_fichas";
DROP TYPE IF EXISTS "riesgos_estado";
DROP TYPE IF EXISTS "riesgos_disponibilidad";
DROP TYPE IF EXISTS "riesgos_recurso_tipo";
DROP TYPE IF EXISTS "riesgos_institucion_tipo";
DROP TYPE IF EXISTS "riesgos_isla";

-- PostgreSQL cannot drop one enum value directly. Recreate app_key without
-- 'riesgos' after deleting the grants that reference it. Keep this list in
-- sync with schema/enums.ts: it is a literal snapshot.
DELETE FROM "user_apps" WHERE "app_key" = 'riesgos';
ALTER TYPE "public"."app_key" RENAME TO "app_key_with_riesgos";
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene', 'pg2030', 'plan_familiar');
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";
DROP TYPE "public"."app_key_with_riesgos";
