-- PG2030 phase 1: the Plan Galápagos 2030 catalog, the institutions that plan
-- against it, and the link between a reporter and their institution.
--
-- Only structure here. The catalog rows (and CGREG, the only institution the
-- module starts with) arrive in 0032, generated from the plan's matrix.
DO $$ BEGIN
  CREATE TYPE "pg2030_proyecto_tipo" AS ENUM ('Acción', 'Proyecto');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The matrix states a referential budget either as an amount or as one of
-- four reasons there is none. Keeping the reason as its own state (instead of
-- a NULL amount) is what lets the summary say "60 SPI" rather than "65 empty".
DO $$ BEGIN
  CREATE TYPE "pg2030_presupuesto_estado" AS ENUM ('Monto', 'SPI', 'No disponible', 'A definirse en la LISS', 'Sin dato');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "pg2030_institucion_tipo" AS ENUM ('Ejecutivo', 'GAD', 'Otro');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Catalog hierarchy: eje → objetivo → política → estrategia → meta del plan →
-- proyecto. Every level is keyed by the plan's own code, which is unique
-- across the whole plan (not only within its parent), so the generated data
-- migration can resolve parents by code and stay idempotent.
--
-- Parents are RESTRICT, not CASCADE: nobody deletes catalog rows (the plan's
-- 139 projects are fixed), and a stray delete must fail rather than take a
-- branch of the plan with it.
CREATE TABLE IF NOT EXISTS "pg2030_ejes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "codigo" text NOT NULL,
  "nombre" text NOT NULL,
  -- The plan's own order (Gobernanza, Comunidad, Entorno, Hábitat, Economía),
  -- which the codes do not sort into.
  "orden" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_ejes_codigo_unique" UNIQUE ("codigo")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg2030_objetivos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "eje_id" uuid NOT NULL,
  "codigo" text NOT NULL,
  "texto" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_objetivos_codigo_unique" UNIQUE ("codigo"),
  CONSTRAINT "pg2030_objetivos_eje_id_pg2030_ejes_id_fk"
    FOREIGN KEY ("eje_id") REFERENCES "public"."pg2030_ejes"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_objetivos_eje_idx" ON "pg2030_objetivos" ("eje_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg2030_politicas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "objetivo_id" uuid NOT NULL,
  "codigo" text NOT NULL,
  "texto" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_politicas_codigo_unique" UNIQUE ("codigo"),
  CONSTRAINT "pg2030_politicas_objetivo_id_pg2030_objetivos_id_fk"
    FOREIGN KEY ("objetivo_id") REFERENCES "public"."pg2030_objetivos"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_politicas_objetivo_idx" ON "pg2030_politicas" ("objetivo_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg2030_estrategias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "politica_id" uuid NOT NULL,
  "codigo" text NOT NULL,
  "texto" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_estrategias_codigo_unique" UNIQUE ("codigo"),
  CONSTRAINT "pg2030_estrategias_politica_id_pg2030_politicas_id_fk"
    FOREIGN KEY ("politica_id") REFERENCES "public"."pg2030_politicas"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_estrategias_politica_idx" ON "pg2030_estrategias" ("politica_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg2030_metas_plan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "estrategia_id" uuid NOT NULL,
  "codigo" text NOT NULL,
  "texto" text NOT NULL,
  "cuantificable" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_metas_plan_codigo_unique" UNIQUE ("codigo"),
  CONSTRAINT "pg2030_metas_plan_estrategia_id_pg2030_estrategias_id_fk"
    FOREIGN KEY ("estrategia_id") REFERENCES "public"."pg2030_estrategias"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_metas_plan_estrategia_idx" ON "pg2030_metas_plan" ("estrategia_id");
--> statement-breakpoint
-- The unit everything in PG2030 hangs from: institutions plan and report
-- against a project, never against a meta.
CREATE TABLE IF NOT EXISTS "pg2030_proyectos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meta_plan_id" uuid NOT NULL,
  "codigo" text NOT NULL,
  "nombre" text NOT NULL,
  "tipo" "pg2030_proyecto_tipo" NOT NULL,
  -- Anexo 7's horizon ("Ahora (inmediato)", "Corto plazo (3 años)", …). Free
  -- text because the administrator may correct it.
  "plazo" text,
  "presupuesto_estado" "pg2030_presupuesto_estado" NOT NULL,
  "presupuesto_referencial" numeric(14, 2),
  "tipo_entidad_responsable" text,
  -- RESPONSABLE in the matrix: the plan's original (historical) list.
  "responsables_plan" text,
  -- ACTUALIZACIÓN_ENTIDAD_EJECUTORA: who executes the project today.
  "entidades_ejecutoras" text,
  -- Milestones live on the project, not the meta: four metas carry a different
  -- milestone on each of their projects.
  "hito_2023" text,
  "hito_2030" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_proyectos_codigo_unique" UNIQUE ("codigo"),
  CONSTRAINT "pg2030_proyectos_meta_plan_id_pg2030_metas_plan_id_fk"
    FOREIGN KEY ("meta_plan_id") REFERENCES "public"."pg2030_metas_plan"("id") ON DELETE restrict,
  -- An amount exists exactly when the state says so; anything else would make
  -- the summary's "N projects with a budget" disagree with its total.
  CONSTRAINT "pg2030_proyectos_presupuesto_estado_check"
    CHECK (("presupuesto_estado" = 'Monto') = ("presupuesto_referencial" IS NOT NULL)),
  CONSTRAINT "pg2030_proyectos_presupuesto_positivo_check"
    CHECK ("presupuesto_referencial" IS NULL OR "presupuesto_referencial" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_proyectos_meta_plan_idx" ON "pg2030_proyectos" ("meta_plan_id");
--> statement-breakpoint
-- A project field that differed between rows of the matrix. The import kept
-- the first row's value; the alternatives stay here until an administrator has
-- looked at them (and, if needed, corrected the project by hand).
CREATE TABLE IF NOT EXISTS "pg2030_conflictos_importacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proyecto_id" uuid NOT NULL,
  "campo" text NOT NULL,
  "valor_usado" text,
  "valores_alternativos" text[] NOT NULL,
  "revisado" boolean DEFAULT false NOT NULL,
  "revisado_por" uuid,
  -- Copied so the review survives the reviewer's account being deleted.
  "revisado_por_nombre" text,
  "revisado_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_conflictos_importacion_proyecto_id_pg2030_proyectos_id_fk"
    FOREIGN KEY ("proyecto_id") REFERENCES "public"."pg2030_proyectos"("id") ON DELETE cascade,
  CONSTRAINT "pg2030_conflictos_importacion_revisado_por_users_id_fk"
    FOREIGN KEY ("revisado_por") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pg2030_conflictos_importacion_revision_check"
    CHECK ("revisado" = ("revisado_at" IS NOT NULL))
);
--> statement-breakpoint
-- One conflict per project field; also the ON CONFLICT target of 0032.
CREATE UNIQUE INDEX IF NOT EXISTS "pg2030_conflictos_importacion_proyecto_campo_idx"
  ON "pg2030_conflictos_importacion" ("proyecto_id", "campo");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pg2030_instituciones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "sigla" text NOT NULL,
  "tipo" "pg2030_institucion_tipo" DEFAULT 'Ejecutivo' NOT NULL,
  -- Inactive institutions keep their history but cannot receive new reporters.
  "activa" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_instituciones_nombre_check" CHECK (btrim("nombre") <> ''),
  CONSTRAINT "pg2030_instituciones_sigla_check" CHECK (btrim("sigla") <> '')
);
--> statement-breakpoint
-- The catalog exists to stop siglas being spelled two ways, so "MAGP" and
-- "magp" are the same institution.
CREATE UNIQUE INDEX IF NOT EXISTS "pg2030_instituciones_sigla_lower_idx"
  ON "pg2030_instituciones" (lower("sigla"));
--> statement-breakpoint
-- A REPORTER's institution in PG2030. One per user, hence user_id as the key.
-- The institution side is RESTRICT: an institution with reporters cannot
-- disappear from under them.
CREATE TABLE IF NOT EXISTS "pg2030_usuario_institucion" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "institucion_id" uuid NOT NULL,
  "asignado_por" uuid,
  "asignado_por_nombre" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pg2030_usuario_institucion_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "pg2030_usuario_institucion_institucion_id_pg2030_instituciones_id_fk"
    FOREIGN KEY ("institucion_id") REFERENCES "public"."pg2030_instituciones"("id") ON DELETE restrict,
  CONSTRAINT "pg2030_usuario_institucion_asignado_por_users_id_fk"
    FOREIGN KEY ("asignado_por") REFERENCES "public"."users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pg2030_usuario_institucion_institucion_idx"
  ON "pg2030_usuario_institucion" ("institucion_id");
