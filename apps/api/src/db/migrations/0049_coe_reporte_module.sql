-- Reporte territorial diario del COE Provincial de Galápagos (coe_reporte).
-- Institutions report the activities planned for the day (08h00 cut) and
-- their results (19h00 cut). Reporting is public and anonymous: each browser
-- holds a random history code and only its SHA-256 (`propietario`) is stored.
-- The results board needs a session with access to the module.
--
-- Ported from a standalone Vercel app whose data lived in Vercel Blob as JSON
-- files. That data was not migrated (decision of 2026-11-26): the module
-- starts empty. Its own administrator login is replaced by users/user_apps.
--
-- The module's tables never reference app_key, so adding the value here is
-- safe even though the runner applies every pending migration in one
-- transaction.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'coe_reporte';
--> statement-breakpoint
-- An emergency event. The code is EVT-<year>-<16 hex of the SHA-256 of the
-- normalized title>, so the same title in the same year is the same event.
CREATE TABLE IF NOT EXISTS "coe_eventos" (
  "id" text PRIMARY KEY NOT NULL,
  "titulo" text NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coe_eventos_id_chk" CHECK ("id" ~ '^EVT-[0-9]{4}-[A-F0-9]{16}$'),
  CONSTRAINT "coe_eventos_titulo_chk" CHECK (char_length("titulo") BETWEEN 1 AND 150)
);
--> statement-breakpoint
-- One activity. The id comes from the browser, so a retried save lands on the
-- same row. A programmed activity starts as 'pending' and gets its result
-- once ('done', 'partial' or 'missed'); an unprogrammed one is stored already
-- with its result ('extra'). `envio_id` makes the result save idempotent.
-- `metas` and `numeros` are [{indicador, cantidad, unidad}], with `cantidad`
-- kept as the numeric text that was typed.
CREATE TABLE IF NOT EXISTS "coe_actividades" (
  "id" uuid PRIMARY KEY NOT NULL,
  "propietario" text NOT NULL,
  "evento_id" text NOT NULL REFERENCES "coe_eventos"("id"),
  "dia" date NOT NULL,
  "isla" text NOT NULL,
  "sector" text NOT NULL,
  "institucion" text NOT NULL,
  "instancia" text NOT NULL,
  "equipo" text DEFAULT '' NOT NULL,
  "descripcion" text NOT NULL,
  "metas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "estado" text NOT NULL,
  "resultado" text DEFAULT '' NOT NULL,
  "motivo" text DEFAULT '' NOT NULL,
  "numeros" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "envio_id" uuid,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  "completado_en" timestamp with time zone,
  CONSTRAINT "coe_actividades_propietario_chk" CHECK ("propietario" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "coe_actividades_instancia_chk" CHECK ("instancia" IN ('MTT', 'GT', 'Directa')),
  CONSTRAINT "coe_actividades_equipo_chk" CHECK (
    ("instancia" = 'Directa' AND "equipo" = '')
    OR ("instancia" = 'MTT' AND "equipo" ~ '^MTT [1-7]$')
    OR ("instancia" = 'GT' AND "equipo" ~ '^GT [1-3]$')
  ),
  CONSTRAINT "coe_actividades_estado_chk" CHECK ("estado" IN ('pending', 'done', 'partial', 'missed', 'extra')),
  CONSTRAINT "coe_actividades_motivo_chk" CHECK ("estado" NOT IN ('partial', 'missed') OR "motivo" <> ''),
  CONSTRAINT "coe_actividades_resultado_chk" CHECK ("estado" = 'pending' OR "resultado" <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coe_actividades_propietario_idx" ON "coe_actividades" ("propietario", "dia" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coe_actividades_dia_idx" ON "coe_actividades" ("dia" DESC, "evento_id");
--> statement-breakpoint
-- Who receives an email for every activity or result saved.
CREATE TABLE IF NOT EXISTS "coe_destinatarios" (
  "email" text PRIMARY KEY NOT NULL,
  "creado_por" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coe_destinatarios_email_chk" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
-- Directory of the institutions' delegates. It grants no access: the board is
-- reached through users/user_apps. Separate from Gestión de Riesgos'
-- "Delegados al COE" (decision of 2026-11-26).
CREATE TABLE IF NOT EXISTS "coe_delegados" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "email" text NOT NULL,
  "institucion" text NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "coe_delegados_email_key" UNIQUE ("email"),
  CONSTRAINT "coe_delegados_email_chk" CHECK ("email" = lower("email"))
);
