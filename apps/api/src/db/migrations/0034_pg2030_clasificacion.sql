-- PG2030 phase 4: AI classification of each institutional goal
-- (docs/pg2030-plan.md §8).
--
-- One row per request. A request is created, in the same transaction as the
-- write that changed the model's input, only when that input's fingerprint
-- differs from the goal's latest request. Rows are never deleted when
-- processed: a cutoff's report uses the latest request created before that
-- cutoff's deadline, even if it was answered later.
CREATE TABLE IF NOT EXISTS "pg2030_clasificaciones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meta_id" uuid NOT NULL,
  -- sha256 of what the model receives (and the prompt version).
  "huella" text NOT NULL,
  -- `meta` and `contexto` exactly as sent, so a request can be audited and
  -- re-sent without rebuilding them from data that may have changed since.
  "meta_texto" text NOT NULL,
  "contexto" text NOT NULL,
  "estado" text DEFAULT 'pendiente' NOT NULL,
  "contribucion" text,
  "tipo_inversion" text,
  -- The model's last raw answers, kept for review of invalid ones.
  "respuesta_contribucion" text,
  "respuesta_inversion" text,
  -- Provider failures (network, 429, 5xx, timeout, missing key) are retried
  -- forever with growing delays; answers outside the closed list only N times.
  "intentos" integer DEFAULT 0 NOT NULL,
  "respuestas_invalidas" integer DEFAULT 0 NOT NULL,
  "modelo" text,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "procesada_at" timestamp with time zone,
  CONSTRAINT "pg2030_clasificaciones_meta_id_pg2030_metas_institucionales_id_fk"
    FOREIGN KEY ("meta_id") REFERENCES "public"."pg2030_metas_institucionales"("id") ON DELETE cascade,
  CONSTRAINT "pg2030_clasificaciones_estado_check"
    CHECK ("estado" IN ('pendiente', 'clasificada', 'sin_clasificar')),
  CONSTRAINT "pg2030_clasificaciones_contribucion_check" CHECK (
    "contribucion" IS NULL OR "contribucion" IN
      ('Contribución directa', 'Contribución complementaria', 'Alineación relativa', 'Sin alineación')
  ),
  CONSTRAINT "pg2030_clasificaciones_tipo_inversion_check" CHECK (
    "tipo_inversion" IS NULL OR "tipo_inversion" IN
      ('Adquisición de bienes', 'Bienes-servicios', 'Estudios', 'Obras', 'Servicios', 'Contratación de personal', 'Sin datos')
  ),
  CONSTRAINT "pg2030_clasificaciones_clasificada_check" CHECK (
    "estado" <> 'clasificada' OR ("contribucion" IS NOT NULL AND "tipo_inversion" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_clasificaciones_meta_idx"
  ON "pg2030_clasificaciones" ("meta_id", "created_at");
--> statement-breakpoint
-- The worker's queue: only pending rows, in arrival order.
CREATE INDEX IF NOT EXISTS "pg2030_clasificaciones_pendientes_idx"
  ON "pg2030_clasificaciones" ("available_at")
  WHERE "estado" = 'pendiente';
