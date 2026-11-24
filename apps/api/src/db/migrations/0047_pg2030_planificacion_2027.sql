ALTER TABLE "pg2030_metas_institucionales"
  ADD COLUMN IF NOT EXISTS "indicador" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "meta_anual" numeric(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "presupuesto_anual" numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "observaciones" text;

UPDATE "pg2030_metas_institucionales" m
SET "meta_anual" = COALESCE((SELECT SUM(mm."fisico_planificado") FROM "pg2030_meta_meses" mm WHERE mm."meta_id" = m."id"), 0),
    "presupuesto_anual" = COALESCE((SELECT SUM(mm."presupuesto_planificado") FROM "pg2030_meta_meses" mm WHERE mm."meta_id" = m."id"), 0);
