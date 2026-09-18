-- Give a PMA plan a declared vigencia and an audited "Plan de Acción" switch.
--
-- Both come from the same observación of the Administrador del SIGTAR: the
-- system had no way to say whether the instrument behind a plan was still in
-- force, and no way to record that a Plan de Acción had been put into effect.
--
-- `estado` is stated by hand. Nothing here derives it — a PMA carries no
-- expiry date in this database — and nothing downstream branches on it: it is
-- a label. The default backfills every existing row as 'Vigente', which is
-- what the absence of the field has meant until now, and NOT NULL keeps a
-- third, unset state from existing at all.
DO $$ BEGIN
  CREATE TYPE "pma_plan_estado" AS ENUM ('Vigente', 'Vencida');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "pma_plans"
  ADD COLUMN IF NOT EXISTS "estado" "pma_plan_estado" DEFAULT 'Vigente' NOT NULL;--> statement-breakpoint
-- The switch itself. It is the denormalized head of
-- `pma_action_plan_activations` below: the flag answers "is it active?" in one
-- read, the log answers "who turned it on, when and why?". Existing plans
-- start inactive, since none of them has a Plan de Acción on record.
ALTER TABLE "pma_plans"
  ADD COLUMN IF NOT EXISTS "action_plan_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One row per transition, activations and deactivations alike, so the history
-- shows the full cycle rather than only the state it ended in. `reason` is NOT
-- NULL with a non-empty CHECK because a transition with no motive is exactly
-- the record the observación asked to prevent. `actor_name`/`actor_email` are
-- denormalized for the same reason `pma_pending_notification_log` denormalizes
-- its reporter: deleting the user must not blank out the audit trail.
CREATE TABLE IF NOT EXISTS "pma_action_plan_activations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL,
  "active" boolean NOT NULL,
  "reason" text NOT NULL,
  "actor_id" uuid,
  "actor_name" text NOT NULL,
  "actor_email" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pma_action_plan_activations_plan_id_pma_plans_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."pma_plans"("id") ON DELETE cascade,
  CONSTRAINT "pma_action_plan_activations_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "pma_action_plan_activations_reason_check" CHECK (btrim("reason") <> '')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pma_action_plan_activations_plan_created_at_idx"
  ON "pma_action_plan_activations" ("plan_id", "created_at");
