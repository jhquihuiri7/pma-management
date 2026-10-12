-- PG2030 phases 2 and 3: years and their cutoffs, the yearly call to
-- institutions, institutional goals with their monthly plan and execution,
-- reopenings and the audit log (docs/pg2030-plan.md §5–§7).
--
-- Locking is not stored anywhere: the API derives it on every write from the
-- year's configuration, the calendar and any reopening (see
-- modules/pg2030/cortes.ts), so it holds even with the worker down.
DO $$ BEGIN
  CREATE TYPE "pg2030_fuente_financiamiento" AS ENUM ('Corriente', 'Inversión', 'Cooperación');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- A fiscal year the administrator opened. Years are never closed.
CREATE TABLE IF NOT EXISTS "pg2030_anios" (
  "anio" integer PRIMARY KEY NOT NULL,
  -- Cutoffs before this one are "no habilitados"; their months travel with it.
  "primer_corte" smallint NOT NULL,
  -- Initial-load deadline, set when a habilitated cutoff had already expired
  -- on opening the year (2026 opened from T2). End of that day, Galápagos time.
  "fecha_limite_carga" date,
  "abierto_por" uuid,
  "abierto_por_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_anios_abierto_por_users_id_fk"
    FOREIGN KEY ("abierto_por") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_anios_anio_check" CHECK ("anio" BETWEEN 2020 AND 2100),
  CONSTRAINT "pg2030_anios_primer_corte_check" CHECK ("primer_corte" BETWEEN 1 AND 4)
);
--> statement-breakpoint
-- Institutions called to plan in a year. "Sin respuesta" is computed over
-- these: called, with no goals and no "sin acciones" declaration.
CREATE TABLE IF NOT EXISTS "pg2030_convocatorias" (
  "anio" integer NOT NULL,
  "institucion_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_convocatorias_pk" PRIMARY KEY ("anio", "institucion_id"),
  CONSTRAINT "pg2030_convocatorias_anio_pg2030_anios_anio_fk"
    FOREIGN KEY ("anio") REFERENCES "public"."pg2030_anios"("anio") ON DELETE cascade,
  CONSTRAINT "pg2030_convocatorias_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE cascade
);
--> statement-breakpoint
-- "No tenemos acciones vinculadas al Plan este año" (SRI, MINTEL in 2026).
-- Mutually exclusive with having goals that year; the API enforces it.
CREATE TABLE IF NOT EXISTS "pg2030_sin_acciones" (
  "anio" integer NOT NULL,
  "institucion_id" uuid NOT NULL,
  "declarado_por" uuid,
  "declarado_por_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_sin_acciones_pk" PRIMARY KEY ("anio", "institucion_id"),
  CONSTRAINT "pg2030_sin_acciones_anio_pg2030_anios_anio_fk"
    FOREIGN KEY ("anio") REFERENCES "public"."pg2030_anios"("anio") ON DELETE cascade,
  CONSTRAINT "pg2030_sin_acciones_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_sin_acciones_declarado_por_users_id_fk"
    FOREIGN KEY ("declarado_por") REFERENCES "public"."users"("id") ON DELETE set null
);
--> statement-breakpoint
-- What an institution sets out to do on one project in one year. Several per
-- project are allowed (SNGR had five on PG0005). The yearly target is never
-- stored: it is the sum of the twelve planned months.
CREATE TABLE IF NOT EXISTS "pg2030_metas_institucionales" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "anio" integer NOT NULL,
  "institucion_id" uuid NOT NULL,
  "proyecto_id" uuid NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "unidad_medida" text NOT NULL,
  "fuente_financiamiento" "pg2030_fuente_financiamiento",
  "beneficiarios_directos" text,
  "personal_tecnico" text,
  "responsables_internos" text,
  "entidades_coordinacion" text,
  "creado_por" uuid,
  "creado_por_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_metas_institucionales_anio_pg2030_anios_anio_fk"
    FOREIGN KEY ("anio") REFERENCES "public"."pg2030_anios"("anio") ON DELETE restrict,
  CONSTRAINT "pg2030_metas_institucionales_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_metas_institucionales_proyecto_id_pg2030_proyectos_id_fk"
    FOREIGN KEY ("proyecto_id") REFERENCES "public"."pg2030_proyectos"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_metas_institucionales_creado_por_users_id_fk"
    FOREIGN KEY ("creado_por") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_metas_institucionales_nombre_check" CHECK (btrim("nombre") <> ''),
  CONSTRAINT "pg2030_metas_institucionales_unidad_check" CHECK (btrim("unidad_medida") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_metas_institucionales_anio_institucion_idx"
  ON "pg2030_metas_institucionales" ("anio", "institucion_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_metas_institucionales_proyecto_idx"
  ON "pg2030_metas_institucionales" ("proyecto_id");
--> statement-breakpoint
-- One row per goal and month: the plan and, once saved, the execution. Values
-- are the month's own, never cumulative. A month counts as reported only when
-- saved (even with zeros), which is what tells "reported 0" from "not reported".
CREATE TABLE IF NOT EXISTS "pg2030_meta_meses" (
  "meta_id" uuid NOT NULL,
  "mes" smallint NOT NULL,
  "fisico_planificado" numeric(18, 4) DEFAULT 0 NOT NULL,
  "presupuesto_planificado" numeric(14, 2) DEFAULT 0 NOT NULL,
  "fisico_ejecutado" numeric(18, 4),
  "presupuesto_devengado" numeric(14, 2),
  "hitos_alcanzados" text,
  "observaciones" text,
  "reportado_at" timestamp with time zone,
  "reportado_por" uuid,
  "reportado_por_nombre" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_meta_meses_pk" PRIMARY KEY ("meta_id", "mes"),
  CONSTRAINT "pg2030_meta_meses_meta_id_pg2030_metas_institucionales_id_fk"
    FOREIGN KEY ("meta_id") REFERENCES "public"."pg2030_metas_institucionales"("id") ON DELETE cascade,
  CONSTRAINT "pg2030_meta_meses_reportado_por_users_id_fk"
    FOREIGN KEY ("reportado_por") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_meta_meses_mes_check" CHECK ("mes" BETWEEN 1 AND 12),
  CONSTRAINT "pg2030_meta_meses_valores_check" CHECK (
    "fisico_planificado" >= 0 AND "presupuesto_planificado" >= 0
    AND ("fisico_ejecutado" IS NULL OR "fisico_ejecutado" >= 0)
    AND ("presupuesto_devengado" IS NULL OR "presupuesto_devengado" >= 0)
  ),
  -- Reported means both execution figures are present; not reported, neither.
  CONSTRAINT "pg2030_meta_meses_reporte_check" CHECK (
    ("reportado_at" IS NULL) = ("fisico_ejecutado" IS NULL)
    AND ("reportado_at" IS NULL) = ("presupuesto_devengado" IS NULL)
  )
);
--> statement-breakpoint
-- An administrator reopened a closed cutoff for one institution until a new
-- deadline. Several may exist; the latest deadline wins.
CREATE TABLE IF NOT EXISTS "pg2030_reaperturas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "anio" integer NOT NULL,
  "trimestre" smallint NOT NULL,
  "institucion_id" uuid NOT NULL,
  "fecha_limite" date NOT NULL,
  "motivo" text NOT NULL,
  "creado_por" uuid,
  "creado_por_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_reaperturas_anio_pg2030_anios_anio_fk"
    FOREIGN KEY ("anio") REFERENCES "public"."pg2030_anios"("anio") ON DELETE cascade,
  CONSTRAINT "pg2030_reaperturas_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_reaperturas_creado_por_users_id_fk"
    FOREIGN KEY ("creado_por") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_reaperturas_trimestre_check" CHECK ("trimestre" BETWEEN 1 AND 4),
  CONSTRAINT "pg2030_reaperturas_motivo_check" CHECK (btrim("motivo") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_reaperturas_corte_idx"
  ON "pg2030_reaperturas" ("anio", "trimestre", "institucion_id");
--> statement-breakpoint
-- Who changed what after a cutoff had closed, and every reopening. The
-- quarterly report reads it to mark itself "modificado después del cierre".
CREATE TABLE IF NOT EXISTS "pg2030_bitacora" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "anio" integer NOT NULL,
  "trimestre" smallint NOT NULL,
  "institucion_id" uuid NOT NULL,
  -- SET NULL keeps the entry when the goal is later deleted.
  "meta_id" uuid,
  "accion" text NOT NULL,
  "detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "usuario_id" uuid,
  "usuario_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_bitacora_anio_pg2030_anios_anio_fk"
    FOREIGN KEY ("anio") REFERENCES "public"."pg2030_anios"("anio") ON DELETE cascade,
  CONSTRAINT "pg2030_bitacora_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_bitacora_meta_id_pg2030_metas_institucionales_id_fk"
    FOREIGN KEY ("meta_id") REFERENCES "public"."pg2030_metas_institucionales"("id") ON DELETE set null,
  CONSTRAINT "pg2030_bitacora_usuario_id_users_id_fk"
    FOREIGN KEY ("usuario_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_bitacora_trimestre_check" CHECK ("trimestre" BETWEEN 1 AND 4),
  CONSTRAINT "pg2030_bitacora_accion_check"
    CHECK ("accion" IN ('reapertura', 'mes_modificado', 'meta_modificada', 'meta_eliminada'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_bitacora_corte_idx"
  ON "pg2030_bitacora" ("anio", "trimestre", "institucion_id");
