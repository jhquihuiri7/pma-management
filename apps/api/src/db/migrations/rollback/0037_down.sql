-- Rollback of 0037_geo_workspace.sql — removes the RustGIS Workspace tables.
--
-- NOT run by the migration runner. Saved Workspace projects and the access
-- lists of restricted maps are lost (dump geo_workspace_projects and
-- geo_map_access first if they matter). The FlatGeobuf files stay on the NAS
-- under GEO/maps/{mapId}/layers/{layerId}/artifacts/ and can be deleted by hand.
-- Run it inside a single transaction, and afterwards:
--
--   delete from drizzle.__drizzle_migrations where hash like '%0037_geo_workspace%';
DROP TABLE IF EXISTS "geo_workspace_projects";
DROP TABLE IF EXISTS "geo_layer_artifacts";
DROP TABLE IF EXISTS "geo_map_access";
ALTER TABLE "geo_maps" DROP CONSTRAINT IF EXISTS "geo_maps_visibility_chk";
ALTER TABLE "geo_maps" DROP COLUMN IF EXISTS "visibility";
-- The unaccent extension is left in place: other code may use it.
