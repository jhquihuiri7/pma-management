-- Make a plan's start date mandatory at the storage layer.
--
-- `start_date` is the origin of every schedule derived from a plan: the
-- reporting-period blocks that key `pma_period_compliance`, each item's
-- evidence ranges and deadline months, which months accept an upload, and the
-- folder each evidence file is written to. It is now immutable after creation
-- (PUT /pma/plans/:id refuses it), which turns a missing value into a permanent
-- one: a plan created without a start date would be anchored to its `created_at`
-- for good, with no way to correct it. Requiring it closes that.
--
-- The backfill reproduces exactly what the application fallback computed —
-- `getPlanStartDate` resolved a null `start_date` to the Galápagos calendar date
-- of `created_at` — so no existing plan's calendar shifts. Production has no
-- null values (12 of 12 plans carry a date); the UPDATE is here so any other
-- environment converges on the same rule instead of failing the ALTER.
UPDATE "pma_plans"
SET "start_date" = ("created_at" AT TIME ZONE 'Pacific/Galapagos')::date
WHERE "start_date" IS NULL;
--> statement-breakpoint
ALTER TABLE "pma_plans" ALTER COLUMN "start_date" SET NOT NULL;
