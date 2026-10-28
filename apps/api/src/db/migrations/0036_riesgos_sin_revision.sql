-- Gestión de Riesgos: what an institution submits counts at once. The
-- coordinator no longer validates or excludes fichas (user decision,
-- 2026-10-27), so the review state and its trail go away.
--
-- The partial unique index kept a validated asset from being counted twice.
-- Without validation that rule moves into the reports: when an institution
-- declares the same asset (type, name, island, place) in more than one ficha,
-- only its most recent declaration counts. The new index serves that lookup.
--
-- A ficha excluded before this migration counts again; the pre-deploy dump
-- keeps the old review state.
DROP INDEX IF EXISTS "riesgos_recursos_validado_unico_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riesgos_recursos_activo_idx"
  ON "riesgos_recursos" ("institucion_clave", "tipo", "clave_activo", "isla");
--> statement-breakpoint
-- Dropping "estado" also drops riesgos_recursos_filtro_idx, which led with it.
ALTER TABLE "riesgos_recursos" DROP COLUMN IF EXISTS "estado";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riesgos_recursos_filtro_idx" ON "riesgos_recursos" ("isla", "tipo");
--> statement-breakpoint
ALTER TABLE "riesgos_fichas"
  DROP COLUMN IF EXISTS "estado",
  DROP COLUMN IF EXISTS "nota_revision",
  DROP COLUMN IF EXISTS "revisado_por",
  DROP COLUMN IF EXISTS "revisado_por_nombre",
  DROP COLUMN IF EXISTS "revisado_at";
--> statement-breakpoint
DROP TYPE IF EXISTS "riesgos_estado";
