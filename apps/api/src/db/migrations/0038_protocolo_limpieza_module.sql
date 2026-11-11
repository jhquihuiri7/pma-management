-- Protocolo de limpieza: traceability of waste and rubble from Santa Cruz
-- (Galápagos) to Guayaquil along routes R1 to R6, with R2.1 diverting to the
-- sanitary landfill. Every page and endpoint needs a session with access to
-- the module; there is no public part.
--
-- Ported from the standalone "trazabilidad-san-cristobal" app (Next.js +
-- SQLite). Its records were test data and were not migrated: the module starts
-- empty. Its own password gate (REQUIRE_LOGIN, /api/session) is replaced by
-- users/user_apps.
--
-- The module's tables never reference app_key, so adding the value here is
-- safe even though the runner applies every pending migration in one
-- transaction.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'protocolo_limpieza';
--> statement-breakpoint
-- One operational report of a route of the protocol. `data` holds the form's
-- values exactly as the shared rules return them (packages/types/src/
-- protocoloLimpieza.ts, ported from the app's lib/schema.js); the API
-- validates them before inserting. `recursos` lists the resources reported
-- with the operation (quantity, resource and institution); the dashboard
-- shows those of each route's latest report. `unique_key` is the rules' recordKey, so
-- the same movement cannot be reported twice. `version` grows on every edit,
-- and an edit made from an older version is rejected.
CREATE TABLE IF NOT EXISTS "protocolo_limpieza_registros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "data" jsonb NOT NULL,
  "recursos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "unique_key" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- Kept apart from the FKs so the trail survives the user's deletion.
  "created_by_name" text NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "protocolo_limpieza_registros_kind_chk" CHECK ("kind" IN (
    'recoleccion', 'carga', 'patioSCY', 'relleno', 'puertoSCY', 'embarque', 'patioGYE', 'recepcion', 'gestion'
  )),
  CONSTRAINT "protocolo_limpieza_registros_data_chk" CHECK (jsonb_typeof("data") = 'object'),
  CONSTRAINT "protocolo_limpieza_registros_recursos_chk" CHECK (jsonb_typeof("recursos") = 'array'),
  CONSTRAINT "protocolo_limpieza_registros_version_chk" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "protocolo_limpieza_registros_unique_key_idx" ON "protocolo_limpieza_registros" ("unique_key");
--> statement-breakpoint
-- The dashboard reads every report in this order.
CREATE INDEX IF NOT EXISTS "protocolo_limpieza_registros_updated_idx" ON "protocolo_limpieza_registros" ("updated_at", "id");
--> statement-breakpoint
-- A JPG attached to a report (the container's interior in R3), at most 4 MB.
-- The bytes live in SIGTAR's storage under PROTOCOLO_LIMPIEZA/fotos/; a report
-- keeps only the id, which is also the file name.
CREATE TABLE IF NOT EXISTS "protocolo_limpieza_fotos" (
  "id" text PRIMARY KEY NOT NULL,
  "storage_path" text NOT NULL UNIQUE,
  "size_bytes" integer NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "protocolo_limpieza_fotos_id_chk" CHECK ("id" ~ '^[0-9a-f-]{36}\.jpg$'),
  CONSTRAINT "protocolo_limpieza_fotos_size_chk" CHECK ("size_bytes" BETWEEN 1 AND 4194304)
);
