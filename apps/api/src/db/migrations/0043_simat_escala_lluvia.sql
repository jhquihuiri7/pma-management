-- SIMAT-GAL · escala de riesgo por lluvia (2026-11-18).
-- Los umbrales del equipo técnico traen tres niveles de lluvia (vigilancia,
-- preparación y respuesta, en mm/h) en lugar de un solo umbral de «lluvia
-- alta», pueden no tener umbral de mar (mar_m nulo) ni estación de lluvia
-- asignada, y declaran su estado de validación y si habilitan alertas
-- públicas. lluvia_mm_h (umbral único anterior) se conserva sin uso.
ALTER TABLE "simat_criterios"
  ALTER COLUMN "estacion_id" DROP NOT NULL,
  ALTER COLUMN "mar_m" DROP NOT NULL,
  ALTER COLUMN "lluvia_mm_h" DROP NOT NULL,
  ADD COLUMN "lluvia_vigilancia_mm_h" double precision,
  ADD COLUMN "lluvia_preparacion_mm_h" double precision,
  ADD COLUMN "lluvia_respuesta_mm_h" double precision,
  ADD COLUMN "estado_validacion" text NOT NULL DEFAULT 'experimental',
  ADD COLUMN "alertas_publicas" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "simat_criterios"
SET "lluvia_vigilancia_mm_h" = "lluvia_mm_h",
    "lluvia_preparacion_mm_h" = "lluvia_mm_h",
    "lluvia_respuesta_mm_h" = "lluvia_mm_h"
WHERE "lluvia_vigilancia_mm_h" IS NULL;
--> statement-breakpoint
ALTER TABLE "simat_criterios"
  ALTER COLUMN "lluvia_vigilancia_mm_h" SET NOT NULL,
  ALTER COLUMN "lluvia_preparacion_mm_h" SET NOT NULL,
  ALTER COLUMN "lluvia_respuesta_mm_h" SET NOT NULL,
  ADD CONSTRAINT "simat_criterios_escala_chk" CHECK (
    "lluvia_vigilancia_mm_h" >= 0
    AND "lluvia_preparacion_mm_h" >= "lluvia_vigilancia_mm_h"
    AND "lluvia_respuesta_mm_h" >= "lluvia_preparacion_mm_h"
  ),
  ADD CONSTRAINT "simat_criterios_validacion_chk" CHECK ("estado_validacion" IN ('experimental', 'validado'));
