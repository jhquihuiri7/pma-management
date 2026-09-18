-- Reverse 0026: restore the `plan_enfoque` type and both `enfoque` columns.
--
-- The columns come back nullable and empty. The dropped values are not
-- recoverable from this file, so every plan reads as unclassified — which is
-- what a NULL `enfoque` always meant.
DO $$ BEGIN
  CREATE TYPE "plan_enfoque" AS ENUM ('Prevenir impactos', 'Controlar impactos', 'Monitorear y optimizar', 'Restaurar el ambiente');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "pma_plans" ADD COLUMN IF NOT EXISTS "enfoque" "plan_enfoque";--> statement-breakpoint
ALTER TABLE "rgdp_plans" ADD COLUMN IF NOT EXISTS "enfoque" "plan_enfoque";
