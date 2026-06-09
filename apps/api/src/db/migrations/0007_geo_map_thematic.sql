ALTER TABLE "geo_maps" ADD COLUMN IF NOT EXISTS "thematic" text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "geo_maps"
SET
  "category_id" = 'fisico-ambiental',
  "thematic" = CASE
    WHEN "category_id" = 'clima' THEN 'Clima'
    WHEN "category_id" = 'calidad-agua' THEN 'Calidad ambiental'
    WHEN "category_id" = 'suelo' THEN 'Recursos naturales renovables'
    WHEN "category_id" = 'riesgo' THEN 'Amenazas naturales'
    WHEN "category_id" = 'protegidas' THEN 'Zonas de protección, regeneración y recuperación ambiental'
    WHEN "category_id" = 'biodiversidad' THEN 'Ecosistemas'
    ELSE "thematic"
  END
WHERE "category_id" IN (
  'biodiversidad',
  'calidad-agua',
  'clima',
  'suelo',
  'riesgo',
  'protegidas'
);
--> statement-breakpoint
UPDATE "geo_maps"
SET
  "category_id" = 'politico-institucional',
  "thematic" = 'Capacidades institucionales locales'
WHERE "category_id" = 'gobernanza';
