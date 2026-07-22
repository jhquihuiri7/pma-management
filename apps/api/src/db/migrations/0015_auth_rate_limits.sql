CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
  "bucket_key" text PRIMARY KEY NOT NULL,
  "attempt_count" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "auth_rate_limits_bucket_key_hash"
    CHECK ("bucket_key" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_rate_limits_attempt_count_positive"
    CHECK ("attempt_count" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_rate_limits_expires_at_idx"
  ON "auth_rate_limits" ("expires_at");
