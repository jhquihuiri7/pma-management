-- Reverse 0027: drop the activation log, both plan columns and the estado type.
--
-- The recorded activations are destroyed with the table and are not
-- recoverable from this file. Take a dump of "pma_action_plan_activations"
-- first if the history still matters.
DROP TABLE IF EXISTS "pma_action_plan_activations";--> statement-breakpoint
ALTER TABLE "pma_plans" DROP COLUMN IF EXISTS "action_plan_active";--> statement-breakpoint
ALTER TABLE "pma_plans" DROP COLUMN IF EXISTS "estado";--> statement-breakpoint
-- `pma_plans.estado` was the type's only user, so it goes with the column.
DROP TYPE IF EXISTS "pma_plan_estado";
