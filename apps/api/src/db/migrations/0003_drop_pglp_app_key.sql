-- Remove the dead "pglp" value from the app_key enum. Postgres cannot drop an
-- enum value in place, so rebuild the type. First clear the orphaned user_apps
-- rows that still point at the removed pglp subsystem.

DELETE FROM "user_apps" WHERE "app_key" = 'pglp';--> statement-breakpoint
ALTER TYPE "public"."app_key" RENAME TO "app_key_old";--> statement-breakpoint
CREATE TYPE "public"."app_key" AS ENUM('pma', 'rgdp', 'geo');--> statement-breakpoint
ALTER TABLE "user_apps" ALTER COLUMN "app_key" TYPE "public"."app_key" USING "app_key"::text::"public"."app_key";--> statement-breakpoint
DROP TYPE "public"."app_key_old";
