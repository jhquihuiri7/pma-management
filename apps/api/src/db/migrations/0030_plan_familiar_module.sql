-- Plan Familiar de Emergencia: public submissions and protected results.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'plan_familiar';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_emergency_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "submission_id" uuid NOT NULL,
  "download_hash" text NOT NULL,
  "family" text NOT NULL,
  "island" text NOT NULL,
  "sector" text NOT NULL,
  "phone" text NOT NULL,
  "members_count" integer NOT NULL,
  "latitude" double precision,
  "longitude" double precision,
  "plan_json" jsonb NOT NULL,
  "pdf_storage_path" text NOT NULL,
  "source_hash" text NOT NULL,
  "consent_version" text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "family_emergency_plans_status_check" CHECK ("status" IN ('active', 'withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_emergency_plans_submission_idx"
  ON "family_emergency_plans" ("submission_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_emergency_plans_storage_idx"
  ON "family_emergency_plans" ("pdf_storage_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_emergency_plans_created_idx"
  ON "family_emergency_plans" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_emergency_plans_island_idx"
  ON "family_emergency_plans" ("island");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_emergency_plans_source_idx"
  ON "family_emergency_plans" ("source_hash", "created_at");
