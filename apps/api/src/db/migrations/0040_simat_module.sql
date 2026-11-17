-- SIMAT-GAL: Sistema Provincial de Monitoreo Hidrometeorológico y Alerta
-- Temprana de Galápagos. Ported from the standalone Flask app
-- (SIMAT-GAL-Web-rediseno.zip). Data flows from public sources (IERSE, IOC,
-- INOCAR, INAMHI inventory, FCD, METAR, Open-Meteo) into these tables through
-- connectors the worker runs on a schedule. See docs/plan-integracion-simat.md.
--
-- The module's tables never reference app_key, so adding the value here is
-- safe even though the runner applies every pending migration in one
-- transaction.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'simat';
--> statement-breakpoint
-- A meteorological station, from any source. `id` is "<fuente>-<codigo>", so
-- the same physical station seen through two sources stays distinct. The
-- inventory never deletes: a station that stops transmitting keeps its row with
-- `activa=false`. `variables` lists the variable keys it measures and
-- `ultimo_dato` the last reading known per variable (for the Estaciones page).
CREATE TABLE IF NOT EXISTS "simat_estaciones" (
  "id" text PRIMARY KEY NOT NULL,
  "fuente" text NOT NULL,
  "codigo" text NOT NULL,
  "nombre" text NOT NULL,
  "isla" text NOT NULL,
  "lat" double precision NOT NULL,
  "lon" double precision NOT NULL,
  "altitud" double precision,
  "paso_min" integer NOT NULL,
  "propietario" text NOT NULL DEFAULT '',
  "estado" text NOT NULL DEFAULT '',
  "activa" boolean NOT NULL DEFAULT true,
  "variables" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "ultimo_dato" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "simat_estaciones_fuente_chk" CHECK ("fuente" IN ('IERSE','INAMHI','FCD','METAR','MANUAL')),
  CONSTRAINT "simat_estaciones_isla_chk" CHECK ("isla" IN ('Santa Cruz','San Cristóbal','Isabela','Floreana')),
  CONSTRAINT "simat_estaciones_lat_chk" CHECK ("lat" BETWEEN -90 AND 90),
  CONSTRAINT "simat_estaciones_lon_chk" CHECK ("lon" BETWEEN -180 AND 180),
  CONSTRAINT "simat_estaciones_paso_chk" CHECK ("paso_min" > 0),
  CONSTRAINT "simat_estaciones_variables_chk" CHECK (jsonb_typeof("variables") = 'array'),
  CONSTRAINT "simat_estaciones_ultimo_dato_chk" CHECK (jsonb_typeof("ultimo_dato") = 'array')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simat_estaciones_isla_idx" ON "simat_estaciones" ("isla");
--> statement-breakpoint
-- One observation of one variable at one instant. Idempotent: a re-sync of an
-- already stored reading is a no-op (INSERT … ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS "simat_observaciones" (
  "estacion_id" text NOT NULL REFERENCES "simat_estaciones"("id") ON DELETE CASCADE,
  "variable" text NOT NULL,
  "instante" timestamp with time zone NOT NULL,
  "valor" double precision NOT NULL,
  "calidad" text NOT NULL DEFAULT 'válido',
  "fuente" text NOT NULL,
  "uso" text NOT NULL DEFAULT '',
  CONSTRAINT "simat_observaciones_pk" PRIMARY KEY ("estacion_id", "variable", "instante"),
  CONSTRAINT "simat_observaciones_variable_chk" CHECK ("variable" IN (
    'precipitacion','temperatura','humedad','presion','viento_vel','viento_dir','radiacion','uv'
  )),
  CONSTRAINT "simat_observaciones_calidad_chk" CHECK ("calidad" IN ('válido','sospechoso','inválido'))
);
--> statement-breakpoint
-- Reads a station's recent rainfall in time order.
CREATE INDEX IF NOT EXISTS "simat_observaciones_serie_idx"
  ON "simat_observaciones" ("estacion_id", "variable", "instante" DESC);
--> statement-breakpoint
-- Sea level: astronomical tide predictions (INOCAR) and observed levels (IOC
-- gauge or a hand-registered validated level). A prediction keeps its published
-- local wall-clock time as text in `instante` with `hora_publicada=true`; an
-- observed level stores a true UTC instant. `fuente` is free text so the
-- idempotent unique index can tell two sources' rows apart.
CREATE TABLE IF NOT EXISTS "simat_nivel_mar" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "puerto" text NOT NULL,
  "tipo" text NOT NULL,
  "instante" text NOT NULL,
  "hora_publicada" boolean NOT NULL DEFAULT false,
  "valor" double precision NOT NULL,
  "unidad" text NOT NULL DEFAULT 'm',
  "referencia" text NOT NULL DEFAULT '',
  "fase" text,
  "calidad" text NOT NULL DEFAULT '',
  "fuente" text NOT NULL,
  "registrado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "registrado_por_nombre" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "simat_nivel_mar_tipo_chk" CHECK ("tipo" IN ('Predicción astronómica','Nivel observado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "simat_nivel_mar_unico_idx"
  ON "simat_nivel_mar" ("puerto", "tipo", "fuente", "instante");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "simat_nivel_mar_puerto_idx" ON "simat_nivel_mar" ("puerto", "tipo", "instante");
--> statement-breakpoint
-- A decision criterion for one sector: the rain and sea thresholds the matrix
-- compares against. Ported from riesgo.py's build_criteria. `version` grows on
-- every edit. At most one criterion per (station, port, sector).
CREATE TABLE IF NOT EXISTS "simat_criterios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "estacion_id" text NOT NULL REFERENCES "simat_estaciones"("id") ON DELETE CASCADE,
  "isla" text NOT NULL,
  "puerto" text NOT NULL,
  "datum" text NOT NULL,
  "sector" text NOT NULL,
  "respaldo" text NOT NULL DEFAULT '',
  "ventana_min" integer NOT NULL,
  "vigencia_min" integer NOT NULL,
  "desfase_min" integer NOT NULL,
  "lluvia_mm_h" double precision NOT NULL,
  "mar_m" double precision NOT NULL,
  "activo" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "actualizado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actualizado_por_nombre" text NOT NULL DEFAULT '',
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "simat_criterios_ventana_chk" CHECK ("ventana_min" BETWEEN 5 AND 720),
  CONSTRAINT "simat_criterios_vigencia_chk" CHECK ("vigencia_min" BETWEEN 1 AND 1440),
  CONSTRAINT "simat_criterios_desfase_chk" CHECK ("desfase_min" BETWEEN 0 AND 1440),
  CONSTRAINT "simat_criterios_lluvia_chk" CHECK ("lluvia_mm_h" >= 0),
  CONSTRAINT "simat_criterios_version_chk" CHECK ("version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "simat_criterios_unico_idx"
  ON "simat_criterios" ("estacion_id", "puerto", "sector");
--> statement-breakpoint
-- The health of each connector: last attempt, last success, a human summary and
-- the error of the last failure. `conector` is the stable key; the worker
-- upserts one row per connector. `aviso_enviado` guards the one-per-incident
-- alert e-mail.
CREATE TABLE IF NOT EXISTS "simat_sincronizaciones" (
  "conector" text PRIMARY KEY NOT NULL,
  "ultimo_intento" timestamp with time zone,
  "ultimo_exito" timestamp with time zone,
  "resultado" text,
  "registros" integer NOT NULL DEFAULT 0,
  "error" text,
  "fallos_seguidos" integer NOT NULL DEFAULT 0,
  "aviso_enviado" boolean NOT NULL DEFAULT false,
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now()
);
