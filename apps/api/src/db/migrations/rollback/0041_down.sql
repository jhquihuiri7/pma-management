-- Revierte el borrador provisional de criterios (0041). Borra solo las filas
-- que siguen siendo el borrador intacto: sembradas por el sistema, aún
-- desactivadas y sin editar (version=1). Un criterio que el equipo ya calibró
-- (activo=true o version>1) NO se toca.
DELETE FROM "simat_criterios"
WHERE "actualizado_por_nombre" = 'Borrador del sistema'
  AND "activo" = false
  AND "version" = 1;
