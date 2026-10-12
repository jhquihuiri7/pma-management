-- Rollback of 0033_pg2030_planificacion_reporte.sql — PG2030 years, goals,
-- monthly plan and execution, reopenings and audit log.
--
-- NOT run by the migration runner. Every institutional goal, every planned
-- and reported month, every reopening and the whole audit log are destroyed;
-- dump them first if they still matter:
--
--   docker exec pma-postgres pg_dump -U postgres -d pma_db -t 'pg2030_*' > pg2030.sql
--
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0033_pg2030_planificacion_reporte%';
DROP TABLE IF EXISTS "pg2030_bitacora";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_reaperturas";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_meta_meses";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_metas_institucionales";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_sin_acciones";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_convocatorias";--> statement-breakpoint
DROP TABLE IF EXISTS "pg2030_anios";--> statement-breakpoint
DROP TYPE IF EXISTS "pg2030_fuente_financiamiento";
