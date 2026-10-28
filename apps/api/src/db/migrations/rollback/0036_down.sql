-- Rollback of 0036_riesgos_sin_revision.sql — restores the review columns.
--
-- NOT run by the migration runner. The review state dropped by 0036 is not
-- recovered: every ficha and resource comes back as 'pendiente' (restore the
-- pre-deploy dump if the old state matters). Run it inside a single
-- transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0036_riesgos_sin_revision%';
DO $$ BEGIN
  CREATE TYPE "riesgos_estado" AS ENUM ('pendiente', 'validado', 'excluido');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "riesgos_fichas"
  ADD COLUMN IF NOT EXISTS "estado" "riesgos_estado" DEFAULT 'pendiente' NOT NULL,
  ADD COLUMN IF NOT EXISTS "nota_revision" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "revisado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "revisado_por_nombre" text,
  ADD COLUMN IF NOT EXISTS "revisado_at" timestamp with time zone;

ALTER TABLE "riesgos_recursos"
  ADD COLUMN IF NOT EXISTS "estado" "riesgos_estado" DEFAULT 'pendiente' NOT NULL;

DROP INDEX IF EXISTS "riesgos_recursos_filtro_idx";
CREATE INDEX IF NOT EXISTS "riesgos_recursos_filtro_idx" ON "riesgos_recursos" ("estado", "isla", "tipo");
DROP INDEX IF EXISTS "riesgos_recursos_activo_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "riesgos_recursos_validado_unico_idx"
  ON "riesgos_recursos" ("institucion_clave", "tipo", "clave_activo", "isla")
  WHERE "estado" = 'validado' AND "es_titular";
