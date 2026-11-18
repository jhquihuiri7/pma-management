-- Revierte 0044: borra los tres sectores sin estación que sembró y devuelve
-- los ocho criterios al borrador provisional de 0041/0042 (umbral único de 20
-- mm/h, mar 1,5 m), solo si nadie los editó después (mismo autor y versión 2).
DELETE FROM "simat_criterios"
WHERE "estacion_id" IS NULL
  AND "actualizado_por_nombre" = 'Umbrales experimentales · equipo técnico'
  AND "version" = 1;
--> statement-breakpoint
UPDATE "simat_criterios"
SET "datum" = CASE WHEN "puerto" = 'Puerto Baquerizo Moreno' THEN 'Por calibrar (referencia vertical local)' ELSE 'MLWS' END,
    "ventana_min" = 60,
    "vigencia_min" = 180,
    "desfase_min" = 60,
    "lluvia_vigilancia_mm_h" = 20,
    "lluvia_preparacion_mm_h" = 20,
    "lluvia_respuesta_mm_h" = 20,
    "mar_m" = 1.5,
    "estado_validacion" = 'experimental',
    "alertas_publicas" = false,
    "activo" = false,
    "respaldo" = 'Borrador provisional (método SIMAT-GAL). Valores SIN calibrar: ajustar estación, datum, umbral de lluvia (mm/h) y de mar (m) por sector antes de activar.',
    "version" = 1,
    "actualizado_por_nombre" = 'Borrador del sistema'
WHERE "actualizado_por_nombre" = 'Umbrales experimentales · equipo técnico'
  AND "version" = 2
  AND "estacion_id" IN ('INAMHI-64210', 'INAMHI-63782');
