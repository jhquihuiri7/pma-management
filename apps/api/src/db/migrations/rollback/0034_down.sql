-- Rollback of 0034_pg2030_clasificacion.sql — AI classification requests.
--
-- NOT run by the migration runner. Every classification and its history is
-- destroyed; the goals themselves are untouched. Run it inside a single
-- transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where created_at = 1788000000000; -- 0034_pg2030_clasificacion
DROP TABLE IF EXISTS "pg2030_clasificaciones";
