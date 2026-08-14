CREATE TABLE IF NOT EXISTS "geo_layer_visualizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "map_id" uuid NOT NULL,
  "layer_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "config" jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "geo_layer_visualizations_map_id_geo_maps_id_fk"
    FOREIGN KEY ("map_id") REFERENCES "public"."geo_maps"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "geo_layer_visualizations_layer_id_geo_map_layers_id_fk"
    FOREIGN KEY ("layer_id") REFERENCES "public"."geo_map_layers"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "geo_layer_visualizations_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "geo_layer_visualizations_version_check" CHECK ("version" = 1),
  CONSTRAINT "geo_layer_visualizations_position_check" CHECK ("position" >= 0),
  CONSTRAINT "geo_layer_visualizations_title_check" CHECK (length(btrim("title")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_layer_visualizations_layer_idx"
  ON "geo_layer_visualizations" ("map_id", "layer_id", "position");
