ALTER TABLE "geo_map_layers"
  ADD COLUMN IF NOT EXISTS "data_revision" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "attribute_schema" jsonb,
  ADD COLUMN IF NOT EXISTS "schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN IF NOT EXISTS "manual_entry_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_layer_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "layer_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "data_path" text NOT NULL,
  "feature_count" integer NOT NULL,
  "bbox" jsonb,
  "size_bytes" integer NOT NULL,
  "checksum" text,
  "action" text DEFAULT 'snapshot' NOT NULL,
  "feature_id" uuid,
  "feature_snapshot" jsonb,
  "change_reason" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "geo_layer_revisions_layer_id_geo_map_layers_id_fk"
    FOREIGN KEY ("layer_id") REFERENCES "public"."geo_map_layers"("id") ON DELETE cascade,
  CONSTRAINT "geo_layer_revisions_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "geo_layer_revisions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "geo_layer_revisions_feature_count_check" CHECK ("feature_count" >= 0),
  CONSTRAINT "geo_layer_revisions_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "geo_layer_revisions_action_check" CHECK ("action" IN ('snapshot', 'append'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geo_layer_revisions_layer_revision_uq"
  ON "geo_layer_revisions" ("layer_id", "revision");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geo_layer_revisions_layer_feature_uq"
  ON "geo_layer_revisions" ("layer_id", "feature_id") WHERE "feature_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_layer_revisions_layer_created_idx"
  ON "geo_layer_revisions" ("layer_id", "created_at");
--> statement-breakpoint
INSERT INTO "geo_layer_revisions" (
  "layer_id", "revision", "data_path", "feature_count", "bbox", "size_bytes", "action", "created_by", "created_at"
)
SELECT "id", 1, "data_path", "feature_count", "bbox", "size_bytes", 'snapshot', "created_by", "created_at"
FROM "geo_map_layers"
ON CONFLICT ("layer_id", "revision") DO NOTHING;
