-- SIMAT-GAL: borrador provisional de criterios de riesgo por sector.
--
-- Los valores calibrados nunca estuvieron en el código de la app original
-- (SIMAT-GAL-Web.zip) ni en su despliegue: `/api/state` devuelve 0 criterios y
-- el LEEME.md aclara que el almacén privado (donde vivían) no se incluye. Lo
-- único estandarizado es el MÉTODO (matriz 2×2 lluvia×mar, puertos, ventanas,
-- reglas), que el módulo ya replica, y el catálogo de sectores por isla.
--
-- Esta migración siembra criterios DESACTIVADOS (`activo=false`) con valores
-- TENTATIVOS, para que el equipo técnico los revise, reasigne estación/datum y
-- ajuste los umbrales por sector antes de activarlos en el panel. Mientras
-- `activo=false`, la evaluación nunca emite un nivel (motivo «criterio
-- desactivado»), así que no dispara ninguna alerta.
--
-- Solo Santa Cruz y San Cristóbal: Isabela, Floreana y Baltra aún no tienen
-- estación en el inventario, y un criterio exige una estación real en la isla
-- del puerto. La estación elegida (Charles Darwin / San Cristóbal-Galápagos,
-- paso 60 min) hace compatible la ventana de 60 min; sustitúyase por sector.
--
-- Umbrales tentativos: lluvia 20 mm/h en 60 min («lluvia muy fuerte»), mar
-- 1,5 m es un marcador de posición sin datum real. ON CONFLICT DO NOTHING hace
-- la siembra idempotente y respeta cualquier criterio que ya exista.
INSERT INTO "simat_criterios"
  ("estacion_id", "isla", "puerto", "datum", "sector", "respaldo",
   "ventana_min", "vigencia_min", "desfase_min", "lluvia_mm_h", "mar_m",
   "activo", "version", "actualizado_por_nombre", "actualizado_en")
SELECT
  v.estacion_id, v.isla, v.puerto,
  'Por calibrar (referencia vertical local)',
  v.sector,
  'Borrador provisional (método SIMAT-GAL). Valores SIN calibrar: ajustar estación, datum, umbral de lluvia (mm/h) y de mar (m) por sector antes de activar.',
  60, 180, 60, 20, 1.5,
  false, 1, 'Borrador del sistema', now()
FROM (VALUES
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'El Aguacatal'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'La Cascada'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'Guayabillos'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'Occidente'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'El Bosque'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'Bellavista'),
  ('INAMHI-64210', 'Santa Cruz', 'Puerto Ayora', 'Puerto Ayora'),
  ('INAMHI-63782', 'San Cristóbal', 'Puerto Baquerizo Moreno', 'San Cristóbal')
) AS v(estacion_id, isla, puerto, sector)
WHERE EXISTS (SELECT 1 FROM "simat_estaciones" e WHERE e.id = v.estacion_id)
ON CONFLICT ("estacion_id", "puerto", "sector") DO NOTHING;
