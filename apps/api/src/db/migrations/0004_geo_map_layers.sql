CREATE TABLE IF NOT EXISTS "geo_map_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"geometry_type" text NOT NULL,
	"crs" text DEFAULT 'EPSG:4326' NOT NULL,
	"feature_count" integer DEFAULT 0 NOT NULL,
	"bbox" jsonb,
	"source_format" text DEFAULT 'geojson' NOT NULL,
	"source_path" text,
	"data_path" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"style" jsonb NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_map_layers" ADD CONSTRAINT "geo_map_layers_map_id_geo_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."geo_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_map_layers" ADD CONSTRAINT "geo_map_layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_map_layers_map_idx" ON "geo_map_layers" USING btree ("map_id");
