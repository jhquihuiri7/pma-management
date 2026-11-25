-- SIMAT-GAL · estación de lluvia de respaldo por criterio (2026-11-25).
-- Si la estación principal no da una ventana de lluvia válida y vigente (por
-- ejemplo, INAMHI M0191 «NO TRANSMITIENDO» desde el 22/11/2026), el sector se
-- evalúa con la de respaldo. Decisión del usuario: Santa Rosa (IERSE n_glps09)
-- respalda a los 7 sectores de Santa Cruz que usan Charles Darwin 1.
ALTER TABLE "simat_criterios"
  ADD COLUMN IF NOT EXISTS "estacion_respaldo_id" text
  REFERENCES "simat_estaciones"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "simat_criterios" DROP CONSTRAINT IF EXISTS "simat_criterios_respaldo_distinta_chk";
--> statement-breakpoint
ALTER TABLE "simat_criterios" ADD CONSTRAINT "simat_criterios_respaldo_distinta_chk"
  CHECK ("estacion_respaldo_id" IS NULL OR ("estacion_id" IS NOT NULL AND "estacion_respaldo_id" <> "estacion_id"));
--> statement-breakpoint
UPDATE "simat_criterios"
SET "estacion_respaldo_id" = 'IERSE-n_glps09',
    "version" = "version" + 1,
    "actualizado_en" = now()
WHERE "estacion_id" = 'INAMHI-64210'
  AND "estacion_respaldo_id" IS NULL
  AND EXISTS (SELECT 1 FROM "simat_estaciones" WHERE "id" = 'IERSE-n_glps09');
