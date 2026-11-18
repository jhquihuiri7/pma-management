-- Revierte 0045: vuelve los criterios a experimentales y desactivados (nivel
-- orientativo), solo si nadie los editó después.
UPDATE "simat_criterios"
SET "estado_validacion" = 'experimental',
    "activo" = false,
    "respaldo" = regexp_replace("respaldo", '^Oficiales desde el 18/11/2026\. ', ''),
    "version" = "version" - 1,
    "actualizado_por_nombre" = 'Umbrales experimentales · equipo técnico'
WHERE "actualizado_por_nombre" = 'Umbrales oficiales · equipo técnico';
