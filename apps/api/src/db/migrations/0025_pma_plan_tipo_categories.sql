-- Give PMA its own permit categories.
--
-- `pma_plans.tipo` and `rgdp_plans.tipo` shared the `plan_tipo` type, whose
-- values were 'Licencia', 'Registro Ambiental' and 'N/A'. That list is wrong
-- for PMA on three counts: 'Licencia' does not say which licence, 'Certificado
-- Ambiental' is a real instrument of regularización ambiental and was missing
-- outright, and 'N/A' is an abbreviation where the other options are full
-- category names. PMA moves to a type of its own so RGDP keeps the values its
-- rows already hold.
DO $$ BEGIN
  CREATE TYPE "pma_plan_tipo" AS ENUM ('Licencia Ambiental', 'Registro Ambiental', 'Certificado Ambiental', 'No Aplica');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Existing rows are renamed, not dropped: the two retired labels each map onto
-- exactly one new category, so no plan loses its classification and nobody has
-- to re-enter one. 'Registro Ambiental' is spelled the same in both types and
-- carries over unchanged; NULL stays NULL, since the column is optional.
ALTER TABLE "pma_plans"
  ALTER COLUMN "tipo" TYPE "pma_plan_tipo"
  USING CASE "tipo"::text
    WHEN 'Licencia' THEN 'Licencia Ambiental'
    WHEN 'N/A' THEN 'No Aplica'
    ELSE "tipo"::text
  END::"pma_plan_tipo";
