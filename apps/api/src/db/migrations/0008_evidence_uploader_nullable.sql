-- `ON DELETE SET NULL` cannot work while uploaded_by is NOT NULL. Preserve the
-- uploader display name while allowing user removal without deleting evidence.
ALTER TABLE "pma_evidences" ALTER COLUMN "uploaded_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "rgdp_evidences" ALTER COLUMN "uploaded_by" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pma_evidences" DROP CONSTRAINT IF EXISTS "pma_evidences_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pma_evidences" ADD CONSTRAINT "pma_evidences_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "rgdp_evidences" DROP CONSTRAINT IF EXISTS "rgdp_evidences_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "rgdp_evidences" ADD CONSTRAINT "rgdp_evidences_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
-- Storage authorization resolves registered objects by path. These are
-- deliberately non-unique because legacy rows already contain shared paths;
-- all newly-created paths are UUID-namespaced by application code.
CREATE INDEX IF NOT EXISTS "pma_evidences_storage_path_idx" ON "pma_evidences" ("storage_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_evidences_storage_path_idx" ON "rgdp_evidences" ("storage_path");
--> statement-breakpoint
-- Durable cleanup outbox used when plan/item deletion cascades remove evidence
-- rows. Queue insertion happens in the same transaction as the cascade.
CREATE TABLE IF NOT EXISTS "storage_cleanup_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_path" text NOT NULL,
  "reason" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_cleanup_jobs_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_cleanup_jobs_created_at_idx" ON "storage_cleanup_jobs" ("created_at");
