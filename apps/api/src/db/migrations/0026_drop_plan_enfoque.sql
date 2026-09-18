-- Retire the plan "Enfoque clave" field everywhere.
--
-- `enfoque` classified a plan as prevenir / controlar / monitorear / restaurar.
-- Nothing downstream ever read it — no compliance calculation, report, export
-- or filter branched on the value; it was only written by the create and edit
-- forms and echoed back as a badge. PMA is dropping it, and RGDP carried the
-- same unused column with no row ever setting it, so the field goes in full
-- rather than surviving as a column nobody writes to or reads.
ALTER TABLE "pma_plans" DROP COLUMN IF EXISTS "enfoque";--> statement-breakpoint
ALTER TABLE "rgdp_plans" DROP COLUMN IF EXISTS "enfoque";--> statement-breakpoint
-- Both columns above were the type's only remaining users: `pglp_plans`, the
-- third table the initial migration gave an `enfoque`, was dropped in 0002.
DROP TYPE IF EXISTS "plan_enfoque";
