CREATE TABLE IF NOT EXISTS "mail_outbox_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient" text NOT NULL,
  "subject" text NOT NULL,
  "html" text NOT NULL,
  "text_body" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_outbox_jobs_available_idx"
  ON "mail_outbox_jobs" ("available_at");
