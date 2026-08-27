CREATE TABLE IF NOT EXISTS "pma_pending_notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL,
  "period_key" text NOT NULL,
  "reporter_id" uuid,
  "reporter_name" text NOT NULL,
  "reporter_email" text NOT NULL,
  "cc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subject" text NOT NULL,
  "activity_count" integer NOT NULL,
  "delivered" boolean NOT NULL,
  "error_message" text,
  "sent_by" uuid,
  "sent_by_email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pma_pending_notification_log_plan_id_pma_plans_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade,
  CONSTRAINT "pma_pending_notification_log_reporter_id_users_id_fk"
    FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pma_pending_notification_log_sent_by_users_id_fk"
    FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pma_pending_notification_log_activity_count_check" CHECK ("activity_count" > 0),
  CONSTRAINT "pma_pending_notification_log_cc_emails_check" CHECK (jsonb_typeof("cc_emails") = 'array')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_pending_notification_log_plan_period_idx"
  ON "pma_pending_notification_log" ("plan_id", "period_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_pending_notification_log_created_at_idx"
  ON "pma_pending_notification_log" ("created_at");
