-- Rollback of 0038_protocolo_limpieza_module.sql — Protocolo de limpieza.
--
-- NOT run by the migration runner. Rolling the images back is enough: the
-- tables and the 'protocolo_limpieza' value in app_key are inert once the api
-- no longer references them. Use this only if they must actually disappear.
-- Every report and photo record is destroyed; dump them first if they matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'protocolo_limpieza_*' > protocolo_limpieza.sql
--
-- The photo files stay in storage under PROTOCOLO_LIMPIEZA/fotos/ and can be
-- deleted by hand. Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where created_at = 1792177600000;
--
-- (`hash` is the SHA-256 of the SQL, not the file name; `created_at` is the
-- migration's `when` in meta/_journal.json.)
DROP TABLE IF EXISTS "protocolo_limpieza_fotos";
DROP TABLE IF EXISTS "protocolo_limpieza_registros";

-- PostgreSQL cannot drop one enum value directly. Recreate app_key without
-- 'protocolo_limpieza' after deleting the grants that reference it. Keep this
-- list in sync with schema/enums.ts: it is a literal snapshot.
DELETE FROM "user_apps" WHERE "app_key" = 'protocolo_limpieza';
ALTER TYPE "public"."app_key" RENAME TO "app_key_with_protocolo_limpieza";
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene', 'pg2030', 'plan_familiar', 'riesgos');
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";
DROP TYPE "public"."app_key_with_protocolo_limpieza";
