-- Remove dead tables: the pglp subsystem was deleted from the app, and the
-- admins table is no longer referenced after admin_id was dropped everywhere.

DROP TABLE IF EXISTS "pglp_period_compliance" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_monthly_generations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_evidences" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_findings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_item_assignments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_plan_assignments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_notifications" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_formats" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_plan_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "pglp_plans" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "admins" CASCADE;
