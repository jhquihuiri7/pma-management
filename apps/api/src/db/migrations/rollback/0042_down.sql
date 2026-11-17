-- Revierte 0042: devuelve el borrador intacto de Santa Cruz al puerto y datum
-- que sembró 0041. No toca criterios calibrados (activo=true o version>1).
UPDATE "simat_criterios"
SET "puerto" = 'Puerto Ayora',
    "datum" = 'Por calibrar (referencia vertical local)'
WHERE "actualizado_por_nombre" = 'Borrador del sistema'
  AND "activo" = false
  AND "version" = 1
  AND "isla" = 'Santa Cruz'
  AND "puerto" = 'Isla Santa Cruz';
