-- PG2030: seguimiento al Plan Galápagos 2030.
--
-- Only registers the module as an app key so it can be granted to users. Its
-- own tables arrive with its features in later migrations.

-- Postgres 12+ allows ADD VALUE inside a transaction block as long as the new
-- value is not *used* in the same transaction. This migration only declares it;
-- the first user_apps row referencing 'pg2030' is written later by the app.
ALTER TYPE "public"."app_key" ADD VALUE IF NOT EXISTS 'pg2030';
