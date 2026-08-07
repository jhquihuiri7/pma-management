-- Galápagos Previene: citizen emergency reports arriving from a Telegram bot,
-- read from an external API and cached here.

-- Postgres 12+ allows ADD VALUE inside a transaction block as long as the new
-- value is not *used* in the same transaction. This migration only declares it;
-- the first user_apps row referencing 'previene' is written later by the app.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'previene';
--> statement-breakpoint
-- Local mirror of a report published by the reports API.
--
-- `reporter_id` is deliberately ABSENT. The upstream payload carries a stable
-- anonymous UUID per reporter, and the module must never surface it. Not
-- storing the column at all makes the guarantee structural: no future query,
-- serializer or CSV export can leak a field that does not exist.
CREATE TABLE IF NOT EXISTS "previene_reports" (
  -- The upstream id, not a locally generated one: it is the upsert key that
  -- makes re-reading a modified report idempotent.
  "id" uuid PRIMARY KEY NOT NULL,
  "report_kind" text NOT NULL,
  "event_type_code" text,
  "event_type_name" text,
  "latitude" double precision,
  "longitude" double precision,
  "location_accuracy" double precision,
  "description" text NOT NULL DEFAULT '',
  "submitted_at" timestamp with time zone,
  "remote_created_at" timestamp with time zone,
  -- Drives the incremental cursor; kept separate from our own synced_at so a
  -- local re-sync never looks like an upstream modification.
  "remote_updated_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Mirrors the upstream cursor ordering (updated_at, id) so a resumed sync can
-- be reconciled against local state without a sequential scan.
CREATE INDEX IF NOT EXISTS "previene_reports_cursor_idx"
  ON "previene_reports" ("remote_updated_at", "id");
--> statement-breakpoint
-- The viewer's default filter is a date range over submitted_at.
CREATE INDEX IF NOT EXISTS "previene_reports_submitted_idx"
  ON "previene_reports" ("submitted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "previene_reports_type_idx"
  ON "previene_reports" ("event_type_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "previene_media" (
  "id" uuid PRIMARY KEY NOT NULL,
  "report_id" uuid NOT NULL,
  "media_type" text NOT NULL,
  -- Upstream-relative path (e.g. /v1/media/<id>/content). Stored rather than
  -- rebuilt so a future change in the upstream URL shape does not break the
  -- proxy for already-ingested rows.
  "content_path" text NOT NULL,
  "mime_type" text,
  -- bigint: a video can exceed the int4 ceiling.
  "file_size" bigint,
  "width" integer,
  "height" integer,
  "duration_seconds" integer,
  "caption" text,
  -- 'unknown' until someone fetches it; 'gone' once upstream answered 404,
  -- which is how Telegram expiry becomes visible in the UI instead of a
  -- silent broken thumbnail.
  "availability" text NOT NULL DEFAULT 'unknown',
  "last_checked_at" timestamp with time zone,
  "remote_created_at" timestamp with time zone,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Named explicitly, following the repo's `<table>_<col>_<ref-table>_<ref-col>_fk`
  -- convention. An inline REFERENCES would let Postgres pick
  -- `previene_media_report_id_fkey`, which is what `drizzle-kit generate`
  -- compares against — and it would report drift on every future run.
  CONSTRAINT "previene_media_report_id_previene_reports_id_fk"
    FOREIGN KEY ("report_id") REFERENCES "public"."previene_reports"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "previene_media_report_idx"
  ON "previene_media" ("report_id");
--> statement-breakpoint
-- Cached /v1/event-types. The catalog is expected to grow, so legend, filter
-- and palette are built from this table instead of a hardcoded list.
CREATE TABLE IF NOT EXISTS "previene_event_types" (
  "code" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Single-row table holding the incremental cursor. Persistent on purpose: an
-- in-memory cursor would restart the whole catalog on every deploy.
CREATE TABLE IF NOT EXISTS "previene_sync_state" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'default',
  -- Text, not timestamptz, on purpose: this is an opaque token handed back to
  -- the reports API verbatim. Upstream timestamps carry microseconds, and a
  -- JS Date truncates to milliseconds — echoing a truncated value back makes
  -- upstream resend the boundary report on every cycle. Storing the raw string
  -- round-trips exactly.
  "since_cursor" text,
  "cursor_id" uuid,
  "last_success_at" timestamp with time zone,
  "last_error_at" timestamp with time zone,
  "last_error" text,
  "last_run_reports" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "previene_sync_state_singleton" CHECK ("id" = 'default')
);
--> statement-breakpoint
INSERT INTO "previene_sync_state" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
