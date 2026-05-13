CREATE TYPE "public"."app_key" AS ENUM('pma', 'rgdp', 'pglp', 'geo');--> statement-breakpoint
CREATE TYPE "public"."evidence_validation_status" AS ENUM('pending', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."finding_component" AS ENUM('LEGAL', 'OPERACIONAL', 'AMBIENTAL');--> statement-breakpoint
CREATE TYPE "public"."format_functionality" AS ENUM('descargar_anexos');--> statement-breakpoint
CREATE TYPE "public"."item_assignment_category" AS ENUM('Responsable', 'Colaborador');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('evidence_submitted', 'evidence_approved', 'evidence_rejected', 'generation_threshold_reached');--> statement-breakpoint
CREATE TYPE "public"."period_compliance_status" AS ENUM('C', 'NC+', 'NC-', 'N/A');--> statement-breakpoint
CREATE TYPE "public"."plan_enfoque" AS ENUM('Prevenir impactos', 'Controlar impactos', 'Monitorear y optimizar', 'Restaurar el ambiente');--> statement-breakpoint
CREATE TYPE "public"."plan_fase" AS ENUM('Planificación', 'Construcción', 'Operación', 'Cierre');--> statement-breakpoint
CREATE TYPE "public"."plan_reporte" AS ENUM('6 meses', '1 año', '2 años');--> statement-breakpoint
CREATE TYPE "public"."plan_tipo" AS ENUM('Licencia', 'Registro Ambiental', 'N/A');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'REPORTER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."zone_type" AS ENUM('Urbana', 'Rural', 'Maritima', 'Fluvial');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_apps" (
	"user_id" uuid NOT NULL,
	"app_key" "app_key" NOT NULL,
	CONSTRAINT "user_apps_user_id_app_key_pk" PRIMARY KEY("user_id","app_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"password_set" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'VIEWER' NOT NULL,
	"unit" text,
	"position" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"uploader_name" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"description" text DEFAULT '' NOT NULL,
	"validation_status" "evidence_validation_status" DEFAULT 'pending' NOT NULL,
	"validation_comment" text,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"activity_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"component" "finding_component" NOT NULL,
	"nudos_criticos" text DEFAULT '' NOT NULL,
	"alarmas" text DEFAULT '' NOT NULL,
	"riesgos" text DEFAULT '' NOT NULL,
	"propuestas_solucion" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"functionality" "format_functionality" NOT NULL,
	"functionality_label" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_item_assignments" (
	"plan_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "item_assignment_category" NOT NULL,
	CONSTRAINT "pma_item_assignments_plan_item_id_user_id_pk" PRIMARY KEY("plan_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"plan_id" uuid,
	"plan_item_id" uuid,
	"evidence_id" uuid,
	"metadata" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_period_compliance" (
	"plan_item_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" "period_compliance_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pma_period_compliance_plan_item_id_period_key_pk" PRIMARY KEY("plan_item_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_plan_assignments" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pma_plan_assignments_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item" text NOT NULL,
	"subplan" text NOT NULL,
	"direccion" text,
	"environmental_activity" text DEFAULT '' NOT NULL,
	"identified_environmental_impact" text DEFAULT '' NOT NULL,
	"proposed_measure" text DEFAULT '' NOT NULL,
	"indicator" text DEFAULT '' NOT NULL,
	"verification_method" text DEFAULT '' NOT NULL,
	"periodicity" text DEFAULT '' NOT NULL,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"report_per" "plan_reporte" NOT NULL,
	"observation" text,
	"storage_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pma_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tipo" "plan_tipo",
	"fase" "plan_fase",
	"enfoque" "plan_enfoque",
	"report_per" "plan_reporte" NOT NULL,
	"start_date" date,
	"visualization_url" text,
	"storage_path" text,
	"location" jsonb,
	"ciiu" jsonb,
	"zone_type" "zone_type",
	"coordinate_format" text,
	"geographic_area" jsonb,
	"implantation_area" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"uploader_name" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"description" text DEFAULT '' NOT NULL,
	"validation_status" "evidence_validation_status" DEFAULT 'pending' NOT NULL,
	"validation_comment" text,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"activity_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"component" "finding_component" NOT NULL,
	"nudos_criticos" text DEFAULT '' NOT NULL,
	"alarmas" text DEFAULT '' NOT NULL,
	"riesgos" text DEFAULT '' NOT NULL,
	"propuestas_solucion" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"functionality" "format_functionality" NOT NULL,
	"functionality_label" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_item_assignments" (
	"plan_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "item_assignment_category" NOT NULL,
	CONSTRAINT "rgdp_item_assignments_plan_item_id_user_id_pk" PRIMARY KEY("plan_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_monthly_generations" (
	"plan_item_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"generation_kg" numeric(14, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rgdp_monthly_generations_plan_item_id_period_key_pk" PRIMARY KEY("plan_item_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"plan_id" uuid,
	"plan_item_id" uuid,
	"evidence_id" uuid,
	"metadata" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_period_compliance" (
	"plan_item_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" "period_compliance_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rgdp_period_compliance_plan_item_id_period_key_pk" PRIMARY KEY("plan_item_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_plan_assignments" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rgdp_plan_assignments_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item" text NOT NULL,
	"subplan" text NOT NULL,
	"direccion" text,
	"environmental_activity" text DEFAULT '' NOT NULL,
	"identified_environmental_impact" text DEFAULT '' NOT NULL,
	"proposed_measure" text DEFAULT '' NOT NULL,
	"indicator" text DEFAULT '' NOT NULL,
	"verification_method" text DEFAULT '' NOT NULL,
	"periodicity" text DEFAULT '' NOT NULL,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"report_per" "plan_reporte" NOT NULL,
	"observation" text,
	"storage_path" text,
	"waste_code" text,
	"waste_name" text,
	"waste_description" text,
	"crtib" text,
	"annual_generation_kg" numeric(14, 3),
	"generation_origin" text,
	"self_management" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rgdp_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tipo" "plan_tipo",
	"fase" "plan_fase",
	"enfoque" "plan_enfoque",
	"report_per" "plan_reporte" NOT NULL,
	"start_date" date,
	"visualization_url" text,
	"storage_path" text,
	"location" jsonb,
	"ciiu" jsonb,
	"zone_type" "zone_type",
	"coordinate_format" text,
	"geographic_area" jsonb,
	"implantation_area" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_item_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"uploader_name" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"description" text DEFAULT '' NOT NULL,
	"validation_status" "evidence_validation_status" DEFAULT 'pending' NOT NULL,
	"validation_comment" text,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"activity_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"component" "finding_component" NOT NULL,
	"nudos_criticos" text DEFAULT '' NOT NULL,
	"alarmas" text DEFAULT '' NOT NULL,
	"riesgos" text DEFAULT '' NOT NULL,
	"propuestas_solucion" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"functionality" "format_functionality" NOT NULL,
	"functionality_label" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_item_assignments" (
	"plan_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "item_assignment_category" NOT NULL,
	CONSTRAINT "pglp_item_assignments_plan_item_id_user_id_pk" PRIMARY KEY("plan_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_monthly_generations" (
	"plan_item_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"generation_kg" numeric(14, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pglp_monthly_generations_plan_item_id_period_key_pk" PRIMARY KEY("plan_item_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"plan_id" uuid,
	"plan_item_id" uuid,
	"evidence_id" uuid,
	"metadata" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_period_compliance" (
	"plan_item_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" "period_compliance_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pglp_period_compliance_plan_item_id_period_key_pk" PRIMARY KEY("plan_item_id","period_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_plan_assignments" (
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pglp_plan_assignments_plan_id_user_id_pk" PRIMARY KEY("plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"item" text NOT NULL,
	"subplan" text NOT NULL,
	"direccion" text,
	"environmental_activity" text DEFAULT '' NOT NULL,
	"identified_environmental_impact" text DEFAULT '' NOT NULL,
	"proposed_measure" text DEFAULT '' NOT NULL,
	"indicator" text DEFAULT '' NOT NULL,
	"verification_method" text DEFAULT '' NOT NULL,
	"periodicity" text DEFAULT '' NOT NULL,
	"budget" numeric(14, 2) DEFAULT '0' NOT NULL,
	"report_per" "plan_reporte" NOT NULL,
	"observation" text,
	"storage_path" text,
	"waste_code" text,
	"waste_name" text,
	"waste_description" text,
	"crtib" text,
	"annual_generation_kg" numeric(14, 3),
	"generation_origin" text,
	"self_management" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pglp_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tipo" "plan_tipo",
	"fase" "plan_fase",
	"enfoque" "plan_enfoque",
	"report_per" "plan_reporte" NOT NULL,
	"start_date" date,
	"visualization_url" text,
	"storage_path" text,
	"location" jsonb,
	"ciiu" jsonb,
	"zone_type" "zone_type",
	"coordinate_format" text,
	"geographic_area" jsonb,
	"implantation_area" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" text NOT NULL,
	"arcgis_url" text,
	"layers" jsonb NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"zoom" integer DEFAULT 13 NOT NULL,
	"tags" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_apps" ADD CONSTRAINT "user_apps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_evidences" ADD CONSTRAINT "pma_evidences_plan_id_pma_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_evidences" ADD CONSTRAINT "pma_evidences_plan_item_id_pma_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pma_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_evidences" ADD CONSTRAINT "pma_evidences_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_evidences" ADD CONSTRAINT "pma_evidences_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_findings" ADD CONSTRAINT "pma_findings_plan_id_pma_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_findings" ADD CONSTRAINT "pma_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_formats" ADD CONSTRAINT "pma_formats_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_item_assignments" ADD CONSTRAINT "pma_item_assignments_plan_item_id_pma_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pma_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_item_assignments" ADD CONSTRAINT "pma_item_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_notifications" ADD CONSTRAINT "pma_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_notifications" ADD CONSTRAINT "pma_notifications_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_notifications" ADD CONSTRAINT "pma_notifications_plan_id_pma_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_notifications" ADD CONSTRAINT "pma_notifications_plan_item_id_pma_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pma_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_notifications" ADD CONSTRAINT "pma_notifications_evidence_id_pma_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."pma_evidences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_period_compliance" ADD CONSTRAINT "pma_period_compliance_plan_item_id_pma_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pma_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_plan_assignments" ADD CONSTRAINT "pma_plan_assignments_plan_id_pma_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_plan_assignments" ADD CONSTRAINT "pma_plan_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_plan_items" ADD CONSTRAINT "pma_plan_items_plan_id_pma_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pma_plans" ADD CONSTRAINT "pma_plans_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_evidences" ADD CONSTRAINT "rgdp_evidences_plan_id_rgdp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rgdp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_evidences" ADD CONSTRAINT "rgdp_evidences_plan_item_id_rgdp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."rgdp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_evidences" ADD CONSTRAINT "rgdp_evidences_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_evidences" ADD CONSTRAINT "rgdp_evidences_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_findings" ADD CONSTRAINT "rgdp_findings_plan_id_rgdp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rgdp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_findings" ADD CONSTRAINT "rgdp_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_formats" ADD CONSTRAINT "rgdp_formats_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_item_assignments" ADD CONSTRAINT "rgdp_item_assignments_plan_item_id_rgdp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."rgdp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_item_assignments" ADD CONSTRAINT "rgdp_item_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_monthly_generations" ADD CONSTRAINT "rgdp_monthly_generations_plan_item_id_rgdp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."rgdp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_notifications" ADD CONSTRAINT "rgdp_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_notifications" ADD CONSTRAINT "rgdp_notifications_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_notifications" ADD CONSTRAINT "rgdp_notifications_plan_id_rgdp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rgdp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_notifications" ADD CONSTRAINT "rgdp_notifications_plan_item_id_rgdp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."rgdp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_notifications" ADD CONSTRAINT "rgdp_notifications_evidence_id_rgdp_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."rgdp_evidences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_period_compliance" ADD CONSTRAINT "rgdp_period_compliance_plan_item_id_rgdp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."rgdp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_plan_assignments" ADD CONSTRAINT "rgdp_plan_assignments_plan_id_rgdp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rgdp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_plan_assignments" ADD CONSTRAINT "rgdp_plan_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_plan_items" ADD CONSTRAINT "rgdp_plan_items_plan_id_rgdp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rgdp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rgdp_plans" ADD CONSTRAINT "rgdp_plans_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_evidences" ADD CONSTRAINT "pglp_evidences_plan_id_pglp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pglp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_evidences" ADD CONSTRAINT "pglp_evidences_plan_item_id_pglp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pglp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_evidences" ADD CONSTRAINT "pglp_evidences_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_evidences" ADD CONSTRAINT "pglp_evidences_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_findings" ADD CONSTRAINT "pglp_findings_plan_id_pglp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pglp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_findings" ADD CONSTRAINT "pglp_findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_formats" ADD CONSTRAINT "pglp_formats_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_item_assignments" ADD CONSTRAINT "pglp_item_assignments_plan_item_id_pglp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pglp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_item_assignments" ADD CONSTRAINT "pglp_item_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_monthly_generations" ADD CONSTRAINT "pglp_monthly_generations_plan_item_id_pglp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pglp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_notifications" ADD CONSTRAINT "pglp_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_notifications" ADD CONSTRAINT "pglp_notifications_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_notifications" ADD CONSTRAINT "pglp_notifications_plan_id_pglp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pglp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_notifications" ADD CONSTRAINT "pglp_notifications_plan_item_id_pglp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pglp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_notifications" ADD CONSTRAINT "pglp_notifications_evidence_id_pglp_evidences_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."pglp_evidences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_period_compliance" ADD CONSTRAINT "pglp_period_compliance_plan_item_id_pglp_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."pglp_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_plan_assignments" ADD CONSTRAINT "pglp_plan_assignments_plan_id_pglp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pglp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_plan_assignments" ADD CONSTRAINT "pglp_plan_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_plan_items" ADD CONSTRAINT "pglp_plan_items_plan_id_pglp_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."pglp_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pglp_plans" ADD CONSTRAINT "pglp_plans_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_maps" ADD CONSTRAINT "geo_maps_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geo_maps" ADD CONSTRAINT "geo_maps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_resets_token_idx" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_token_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_admin_idx" ON "users" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_evidences_plan_idx" ON "pma_evidences" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_evidences_item_idx" ON "pma_evidences" USING btree ("plan_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_findings_plan_idx" ON "pma_findings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_notifications_user_idx" ON "pma_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_plan_items_plan_idx" ON "pma_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_plans_admin_idx" ON "pma_plans" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_evidences_plan_idx" ON "rgdp_evidences" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_evidences_item_idx" ON "rgdp_evidences" USING btree ("plan_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_findings_plan_idx" ON "rgdp_findings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_notifications_user_idx" ON "rgdp_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_plan_items_plan_idx" ON "rgdp_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rgdp_plans_admin_idx" ON "rgdp_plans" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_evidences_plan_idx" ON "pglp_evidences" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_evidences_item_idx" ON "pglp_evidences" USING btree ("plan_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_findings_plan_idx" ON "pglp_findings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_notifications_user_idx" ON "pglp_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_plan_items_plan_idx" ON "pglp_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pglp_plans_admin_idx" ON "pglp_plans" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_maps_admin_idx" ON "geo_maps" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_maps_category_idx" ON "geo_maps" USING btree ("category_id");