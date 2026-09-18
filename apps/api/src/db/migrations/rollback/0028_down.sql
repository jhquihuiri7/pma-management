-- Reverse 0028: drop the end date and both of its constraints.
--
-- The recorded end dates are destroyed with the column. Every plan reverts to
-- an open-ended calendar, so a 'Vencida' plan starts showing months and
-- reporting periods past its end again. Dump "id", "estado" and "end_date"
-- from "pma_plans" first if those dates still matter.
ALTER TABLE "pma_plans" DROP CONSTRAINT IF EXISTS "pma_plans_vigente_has_no_end_date";--> statement-breakpoint
ALTER TABLE "pma_plans" DROP CONSTRAINT IF EXISTS "pma_plans_end_date_not_before_start";--> statement-breakpoint
ALTER TABLE "pma_plans" DROP COLUMN IF EXISTS "end_date";
