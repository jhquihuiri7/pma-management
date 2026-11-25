-- Revierte 0048: quita la estación de respaldo de los criterios.
ALTER TABLE "simat_criterios" DROP CONSTRAINT IF EXISTS "simat_criterios_respaldo_distinta_chk";
ALTER TABLE "simat_criterios" DROP COLUMN IF EXISTS "estacion_respaldo_id";
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793177600000;
