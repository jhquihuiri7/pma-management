-- Rollback for the Plan Familiar module. It intentionally removes its stored
-- records; run only after the module has been retired and its NAS directory
-- has been archived or removed separately.
DROP TABLE IF EXISTS "family_emergency_plans";

-- PostgreSQL cannot drop one enum value directly. Recreate app_key without
-- plan_familiar after deleting grants that reference it.
DELETE FROM "user_apps" WHERE "app_key" = 'plan_familiar';
ALTER TYPE "public"."app_key" RENAME TO "app_key_with_plan_familiar";
CREATE TYPE "public"."app_key" AS ENUM ('pma', 'rgdp', 'geo', 'previene', 'pg2030');
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key"
  USING "app_key"::text::"public"."app_key";
DROP TYPE "public"."app_key_with_plan_familiar";
