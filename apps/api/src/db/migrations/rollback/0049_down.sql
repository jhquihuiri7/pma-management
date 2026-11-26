-- Rollback of 0049_coe_reporte_module.sql — Reporte territorial COE.
--
-- NOT run by the migration runner. Rolling the images back is enough: the
-- tables and the 'coe_reporte' value in app_key are inert once the api no
-- longer references them. Use this only if they must actually disappear.
-- Every activity is destroyed; dump them first if they matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'coe_*' > coe_reporte.sql
--
-- Run it inside a single transaction.
DROP TABLE IF EXISTS "coe_actividades";
DROP TABLE IF EXISTS "coe_eventos";
DROP TABLE IF EXISTS "coe_destinatarios";
DROP TABLE IF EXISTS "coe_delegados";

-- PostgreSQL cannot drop one enum value directly. Recreate app_key without
-- 'coe_reporte' after deleting the grants that reference it. Keep this list in
-- sync with schema/enums.ts: it is a literal snapshot.
DELETE FROM "user_apps" WHERE "app_key" = 'coe_reporte';
ALTER TYPE "public"."app_key" RENAME TO "app_key_with_coe_reporte";
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene', 'pg2030', 'plan_familiar', 'riesgos', 'protocolo_limpieza', 'simat');
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";
DROP TYPE "public"."app_key_with_coe_reporte";

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793277600000;
