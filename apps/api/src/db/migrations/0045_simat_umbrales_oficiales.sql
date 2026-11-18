-- SIMAT-GAL · los umbrales del equipo técnico (0044) pasan a ser oficiales
-- (2026-11-18, decisión del usuario: «por ahora ya son oficiales»): estado
-- validado y nivel oficial habilitado, así el panel deja de marcarlos como
-- orientativos. Las alertas públicas siguen deshabilitadas (el sistema no
-- envía alertas). Solo toca los 11 criterios de 0044 que nadie editó después.
UPDATE "simat_criterios"
SET "estado_validacion" = 'validado',
    "activo" = true,
    "respaldo" = 'Oficiales desde el 18/11/2026. ' || "respaldo",
    "version" = "version" + 1,
    "actualizado_por" = NULL,
    "actualizado_por_nombre" = 'Umbrales oficiales · equipo técnico',
    "actualizado_en" = now()
WHERE "actualizado_por_nombre" = 'Umbrales experimentales · equipo técnico'
  AND "estado_validacion" = 'experimental'
  AND "activo" = false;
