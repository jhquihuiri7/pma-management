-- Rollback of 0031_pg2030_catalog_schema.sql — PG2030 catalog, institutions
-- and reporter links.
--
-- NOT run by the migration runner. Roll back 0032 first (or let the DROPs
-- below take its rows with them). Every reporter's institution link and every
-- catalog correction made from the admin screens is destroyed; dump the
-- pg2030_* tables first if they still matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'pg2030_*' > pg2030.sql
--
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0031_pg2030_catalog_schema%';
DROP TABLE IF EXISTS "pg2030_usuario_institucion";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_instituciones";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_conflictos_importacion";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_proyectos";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_metas_plan";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_estrategias";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_politicas";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_objetivos";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_ejes";--> statement-breakpoint
DROP TYPE IF EXISTS "pg2030_institucion_tipo";--> statement-breakpoint
DROP TYPE IF EXISTS "pg2030_presupuesto_estado";--> statement-breakpoint
DROP TYPE IF EXISTS "pg2030_proyecto_tipo";
