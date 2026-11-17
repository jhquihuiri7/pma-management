-- SIMAT-GAL: corrige el puerto y el datum del borrador provisional (0041).
--
-- 0041 sembró los siete sectores de Santa Cruz con el puerto «Puerto Ayora»,
-- que es el NOMBRE visible. Las mareas de INOCAR y el mareógrafo de IOC se
-- guardan con el CÓDIGO del puerto («Isla Santa Cruz», ver PUERTOS en
-- modules/simat/riesgo.ts) y su tabla de mareas usa el datum MLWS. Con el
-- nombre, la evaluación nunca encontraba el nivel del mar del sector y el
-- panel mostraba un puerto duplicado.
--
-- Solo toca filas que siguen siendo el borrador intacto (sembradas por el
-- sistema, desactivadas, version=1): un criterio ya calibrado no cambia. San
-- Cristóbal no tiene tabla de mareas importada, así que conserva su datum.
UPDATE "simat_criterios"
SET "puerto" = 'Isla Santa Cruz',
    "datum" = 'MLWS'
WHERE "actualizado_por_nombre" = 'Borrador del sistema'
  AND "activo" = false
  AND "version" = 1
  AND "isla" = 'Santa Cruz'
  AND "puerto" = 'Puerto Ayora';
