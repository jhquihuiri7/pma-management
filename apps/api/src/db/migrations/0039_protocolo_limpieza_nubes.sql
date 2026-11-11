-- Protocolo de limpieza · Visualización 3D: point clouds of each site by survey
-- date. A site surveyed on several dates (for example the temporary storage
-- yard, every few days) is its timeline in the viewer.
--
-- The uploaded LAS/LAZ is kept as uploaded under PROTOCOLO_LIMPIEZA/nubes/<id>/
-- and the worker converts it to a COPC (cloud optimised point cloud) beside
-- it, which the viewer reads by HTTP ranges. `estado` is 'procesando' from the
-- upload until the worker finishes, then 'lista' or 'error'. `puntos` comes
-- from the LAS header at upload and is replaced by the exact count of the COPC.
-- `metadatos` holds what the viewer needs (CRS, bounds, colour, classes and
-- elevation statistics). Every role with the module may upload and edit the
-- data; only ADMIN deletes (the API checks it). `version` grows on every edit,
-- and an edit made from an older version is rejected.
CREATE TABLE IF NOT EXISTS "protocolo_limpieza_nubes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "sitio" text NOT NULL,
  "fecha" date NOT NULL,
  "descripcion" text DEFAULT '' NOT NULL,
  "archivo_nombre" text NOT NULL,
  "archivo_ruta" text NOT NULL UNIQUE,
  "archivo_bytes" bigint NOT NULL,
  "estado" text DEFAULT 'procesando' NOT NULL,
  "error" text,
  "puntos" bigint NOT NULL,
  "copc_ruta" text UNIQUE,
  "copc_bytes" bigint,
  "metadatos" jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "procesada_at" timestamp with time zone,
  CONSTRAINT "protocolo_limpieza_nubes_sitio_chk" CHECK (char_length("sitio") BETWEEN 1 AND 120),
  CONSTRAINT "protocolo_limpieza_nubes_descripcion_chk" CHECK (char_length("descripcion") <= 500),
  CONSTRAINT "protocolo_limpieza_nubes_archivo_nombre_chk" CHECK (char_length("archivo_nombre") BETWEEN 1 AND 255),
  CONSTRAINT "protocolo_limpieza_nubes_archivo_bytes_chk" CHECK ("archivo_bytes" > 0),
  CONSTRAINT "protocolo_limpieza_nubes_estado_chk" CHECK ("estado" IN ('procesando', 'lista', 'error')),
  CONSTRAINT "protocolo_limpieza_nubes_puntos_chk" CHECK ("puntos" > 0),
  CONSTRAINT "protocolo_limpieza_nubes_copc_bytes_chk" CHECK ("copc_bytes" IS NULL OR "copc_bytes" > 0),
  CONSTRAINT "protocolo_limpieza_nubes_metadatos_chk" CHECK ("metadatos" IS NULL OR jsonb_typeof("metadatos") = 'object'),
  CONSTRAINT "protocolo_limpieza_nubes_version_chk" CHECK ("version" >= 1),
  -- A cloud is ready only with its COPC and what the viewer needs to show it.
  CONSTRAINT "protocolo_limpieza_nubes_lista_chk" CHECK (
    "estado" <> 'lista' OR ("copc_ruta" IS NOT NULL AND "copc_bytes" IS NOT NULL AND "metadatos" IS NOT NULL AND "procesada_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "protocolo_limpieza_nubes_sitio_fecha_idx" ON "protocolo_limpieza_nubes" ("sitio", "fecha");
--> statement-breakpoint
-- The worker's reconciliation looks only at the clouds still being processed.
CREATE INDEX IF NOT EXISTS "protocolo_limpieza_nubes_procesando_idx" ON "protocolo_limpieza_nubes" ("created_at") WHERE "estado" = 'procesando';
