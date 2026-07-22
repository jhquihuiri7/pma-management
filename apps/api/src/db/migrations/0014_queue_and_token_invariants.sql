-- Token hashes are security identifiers. Keep the newest row if legacy data
-- somehow contains a duplicate, then enforce one-record semantics in DB.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "token_hash" ORDER BY "created_at" DESC, "id" DESC) AS rn
  FROM "refresh_tokens"
)
DELETE FROM "refresh_tokens" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "token_hash" ORDER BY "created_at" DESC, "id" DESC) AS rn
  FROM "password_resets"
)
DELETE FROM "password_resets" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);
--> statement-breakpoint
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash");
--> statement-breakpoint
ALTER TABLE "password_resets"
  ADD CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash");
--> statement-breakpoint

UPDATE "pma_notifications"
SET "expires_at" = "created_at" + interval '30 days'
WHERE "expires_at" IS NULL;
--> statement-breakpoint
UPDATE "rgdp_notifications"
SET "expires_at" = "created_at" + interval '30 days'
WHERE "expires_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "pma_notifications" ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "rgdp_notifications" ALTER COLUMN "expires_at" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "storage_cleanup_jobs"
  ADD COLUMN IF NOT EXISTS "available_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "storage_cleanup_jobs"
  ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_cleanup_jobs_available_idx"
  ON "storage_cleanup_jobs" ("available_at");
