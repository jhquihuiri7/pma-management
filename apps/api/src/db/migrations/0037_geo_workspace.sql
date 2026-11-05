-- Workspace con RustGIS (docs/plan-integracion-rustgis.md). Additive only: the
-- old Workspace, the public map viewer and every existing row keep working.
--
-- 1. Per-map visibility. Every existing map stays 'public' (today's behaviour).
--    'internal' = any signed-in user with the geo app; 'restricted' = ADMIN, the
--    map's creator and the users listed in geo_map_access.
-- 2. geo_layer_artifacts: the FlatGeobuf (with a spatial index) of each vector
--    revision, which RustGIS reads by HTTP range instead of copying the GeoJSON
--    into every project. Built by the worker; rows are recreated on demand.
-- 3. geo_workspace_projects: RustGIS projects saved from the Workspace, with the
--    catalog layers they reference (layer_refs) so they can be re-authorised and
--    re-pointed at the current revision every time they are opened.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
ALTER TABLE "geo_maps" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "geo_maps" ADD CONSTRAINT "geo_maps_visibility_chk"
    CHECK ("visibility" IN ('public', 'internal', 'restricted'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_map_access" (
  "map_id" uuid NOT NULL REFERENCES "geo_maps"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("map_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_map_access_user_idx" ON "geo_map_access" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_layer_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "layer_id" uuid NOT NULL REFERENCES "geo_map_layers"("id") ON DELETE CASCADE,
  "revision" integer NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "path" text,
  "size_bytes" bigint,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "geo_layer_artifacts_kind_chk" CHECK ("kind" IN ('fgb')),
  CONSTRAINT "geo_layer_artifacts_status_chk" CHECK ("status" IN ('pending', 'ready', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geo_layer_artifacts_layer_rev_kind_uq"
  ON "geo_layer_artifacts" ("layer_id", "revision", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_workspace_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_map_id" uuid REFERENCES "geo_maps"("id") ON DELETE SET NULL,
  "rustgis_project" text NOT NULL,
  "layer_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rustgis_version" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_workspace_projects_owner_idx"
  ON "geo_workspace_projects" ("owner_id", "updated_at");
