-- Rollback of 0032_pg2030_catalog_data.sql — the imported PG2030 catalog and
-- the initial CGREG institution.
--
-- NOT run by the migration runner. Leaves the 0031 tables in place, empty.
-- Catalog corrections made from the admin screens since the import are lost.
--
-- CGREG is removed only while no reporter is linked to it; otherwise the
-- statement deletes nothing and the institution stays.
--
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0032_pg2030_catalog_data%';
DELETE FROM "pg2030_conflictos_importacion";--> statement-breakpoint
DELETE FROM "pg2030_proyectos";--> statement-breakpoint
DELETE FROM "pg2030_metas_plan";--> statement-breakpoint
DELETE FROM "pg2030_estrategias";--> statement-breakpoint
DELETE FROM "pg2030_politicas";--> statement-breakpoint
DELETE FROM "pg2030_objetivos";--> statement-breakpoint
DELETE FROM "pg2030_ejes";--> statement-breakpoint
DELETE FROM "pg2030_instituciones" i
WHERE lower(i."sigla") = 'cgreg'
  AND NOT EXISTS (
    SELECT 1 FROM "pg2030_usuario_institucion" ui WHERE ui."institucion_id" = i."id"
  );
