-- Consolidate to a single shared organization: admin_id is no longer a tenant
-- partition key. Plans/formats keep a nullable "created_by" (which admin made
-- the row) referencing users; notifications/users/geo drop the column entirely.

-- pma_plans: admin_id -> created_by
ALTER TABLE "pma_plans" DROP CONSTRAINT "pma_plans_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "pma_plans" RENAME COLUMN "admin_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "pma_plans" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pma_plans" ADD CONSTRAINT "pma_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- rgdp_plans: admin_id -> created_by
ALTER TABLE "rgdp_plans" DROP CONSTRAINT "rgdp_plans_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "rgdp_plans" RENAME COLUMN "admin_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "rgdp_plans" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rgdp_plans" ADD CONSTRAINT "rgdp_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- pma_formats: admin_id -> created_by
ALTER TABLE "pma_formats" DROP CONSTRAINT "pma_formats_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "pma_formats" RENAME COLUMN "admin_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "pma_formats" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pma_formats" ADD CONSTRAINT "pma_formats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- rgdp_formats: admin_id -> created_by
ALTER TABLE "rgdp_formats" DROP CONSTRAINT "rgdp_formats_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "rgdp_formats" RENAME COLUMN "admin_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "rgdp_formats" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rgdp_formats" ADD CONSTRAINT "rgdp_formats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- geo_maps: drop admin_id (created_by already exists); re-point the index
ALTER TABLE "geo_maps" DROP CONSTRAINT "geo_maps_admin_id_admins_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "geo_maps_admin_idx";--> statement-breakpoint
ALTER TABLE "geo_maps" DROP COLUMN "admin_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_maps_admin_idx" ON "geo_maps" USING btree ("created_by");--> statement-breakpoint

-- pma_notifications: drop admin_id
ALTER TABLE "pma_notifications" DROP CONSTRAINT "pma_notifications_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "pma_notifications" DROP COLUMN "admin_id";--> statement-breakpoint

-- rgdp_notifications: drop admin_id
ALTER TABLE "rgdp_notifications" DROP CONSTRAINT "rgdp_notifications_admin_id_admins_id_fk";--> statement-breakpoint
ALTER TABLE "rgdp_notifications" DROP COLUMN "admin_id";--> statement-breakpoint

-- users: drop admin_id
ALTER TABLE "users" DROP CONSTRAINT "users_admin_id_admins_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "users_admin_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "admin_id";
