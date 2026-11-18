-- Revierte 0043 (aplicar después de 0044_down). Requiere que no queden
-- criterios sin estación ni sin umbral de mar.
ALTER TABLE "simat_criterios"
  DROP CONSTRAINT IF EXISTS "simat_criterios_escala_chk",
  DROP CONSTRAINT IF EXISTS "simat_criterios_validacion_chk";
--> statement-breakpoint
UPDATE "simat_criterios" SET "lluvia_mm_h" = "lluvia_preparacion_mm_h" WHERE "lluvia_mm_h" IS NULL;
--> statement-breakpoint
ALTER TABLE "simat_criterios"
  DROP COLUMN "lluvia_vigilancia_mm_h",
  DROP COLUMN "lluvia_preparacion_mm_h",
  DROP COLUMN "lluvia_respuesta_mm_h",
  DROP COLUMN "estado_validacion",
  DROP COLUMN "alertas_publicas",
  ALTER COLUMN "lluvia_mm_h" SET NOT NULL,
  ALTER COLUMN "mar_m" SET NOT NULL,
  ALTER COLUMN "estacion_id" SET NOT NULL;
