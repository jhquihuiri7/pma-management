-- The Geoportal no longer stores an external ArcGIS/StoryMap URL per map; the
-- GIS editor (NAS-backed layers) is the only viewer. Drop the dead column.

ALTER TABLE "geo_maps" DROP COLUMN IF EXISTS "arcgis_url";
