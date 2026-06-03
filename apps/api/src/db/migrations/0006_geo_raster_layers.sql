CREATE TABLE IF NOT EXISTS "geo_raster_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"error_message" text,
	"original_filename" text NOT NULL,
	"original_path" text NOT NULL,
	"cog_path" text,
	"file_type" text DEFAULT 'tif' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"srid" integer,
	"crs" text,
	"bbox" jsonb,
	"width_px" integer,
	"height_px" integer,
	"band_count" integer,
	"has_alpha" boolean DEFAULT false NOT NULL,
	"resolution_x" double precision,
	"resolution_y" double precision,
	"min_zoom" integer,
	"max_zoom" integer,
	"aux_files" jsonb,
	"opacity" double precision DEFAULT 1 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_raster_layers" ADD CONSTRAINT "geo_raster_layers_map_id_geo_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."geo_maps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_raster_layers" ADD CONSTRAINT "geo_raster_layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_raster_layers_map_idx" ON "geo_raster_layers" USING btree ("map_id");
