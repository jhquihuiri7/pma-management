-- SIMAT-GAL · umbrales experimentales entregados por el equipo técnico
-- (2026-11-18): lluvia promedio en 60 min con vigilancia ≥ 5, preparación ≥ 15
-- y respuesta ≥ 25 mm/h; sin umbral de mar; datum MLWS; estado experimental y
-- alertas públicas deshabilitadas (los criterios quedan desactivados: el panel
-- los muestra como orientativos).
-- Decisiones del usuario al cargarlos: en las estaciones horarias de INAMHI la
-- vigencia (15 min) y el desfase (10 min) originales se amplían a 180 y 60 min,
-- porque INAMHI publica cada hora con 1,5–2,5 h de atraso y con 15 min nunca
-- estarían vigentes; Isabela, Floreana y Baltra vienen sin estación de lluvia y
-- se registran sin evaluación hasta que se asigne una. Los puertos se guardan
-- con su clave del sistema («Puerto Ayora» = «Isla Santa Cruz», Baltra =
-- «Isla Baltra», puerto de Santa Cruz).
UPDATE "simat_criterios" AS c
SET "datum" = 'MLWS',
    "ventana_min" = 60,
    "vigencia_min" = 180,
    "desfase_min" = 60,
    "lluvia_vigilancia_mm_h" = 5,
    "lluvia_preparacion_mm_h" = 15,
    "lluvia_respuesta_mm_h" = 25,
    "mar_m" = NULL,
    "estado_validacion" = 'experimental',
    "alertas_publicas" = false,
    "activo" = false,
    "respaldo" = 'Umbrales experimentales del equipo técnico (18/11/2026): lluvia promedio en 60 min, vigilancia ≥ 5, preparación ≥ 15 y respuesta ≥ 25 mm/h; sin umbral de mar; alertas públicas deshabilitadas. Vigencia y desfase originales 15 y 10 min, ampliados a 180 y 60 min porque la estación es horaria (INAMHI publica con 1,5–2,5 h de atraso).',
    "version" = c."version" + 1,
    "actualizado_por" = NULL,
    "actualizado_por_nombre" = 'Umbrales experimentales · equipo técnico',
    "actualizado_en" = now()
FROM (VALUES
  ('INAMHI-64210', 'Isla Santa Cruz', 'Bellavista'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'El Aguacatal'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'El Bosque'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'Guayabillos'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'La Cascada'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'Occidente'),
  ('INAMHI-64210', 'Isla Santa Cruz', 'Puerto Ayora'),
  ('INAMHI-63782', 'Puerto Baquerizo Moreno', 'San Cristóbal')
) AS v("estacion_id", "puerto", "sector")
WHERE c."estacion_id" = v."estacion_id" AND c."puerto" = v."puerto" AND c."sector" = v."sector";
--> statement-breakpoint
INSERT INTO "simat_criterios" (
  "estacion_id", "isla", "puerto", "datum", "sector", "respaldo",
  "ventana_min", "vigencia_min", "desfase_min",
  "lluvia_vigilancia_mm_h", "lluvia_preparacion_mm_h", "lluvia_respuesta_mm_h", "mar_m",
  "estado_validacion", "alertas_publicas", "activo", "version", "actualizado_por_nombre"
)
SELECT NULL, v."isla", v."puerto", 'MLWS', v."sector",
  'Umbrales experimentales del equipo técnico (18/11/2026): lluvia promedio en 60 min, vigilancia ≥ 5, preparación ≥ 15 y respuesta ≥ 25 mm/h; sin umbral de mar; alertas públicas deshabilitadas. Sin estación de lluvia asignada: no se evalúa hasta asignar una.',
  60, 15, 10, 5, 15, 25, NULL, 'experimental', false, false, 1, 'Umbrales experimentales · equipo técnico'
FROM (VALUES
  ('Isabela', 'Puerto Villamil', 'Isabela'),
  ('Floreana', 'Puerto Velasco Ibarra', 'Floreana'),
  ('Santa Cruz', 'Isla Baltra', 'Baltra')
) AS v("isla", "puerto", "sector")
WHERE NOT EXISTS (
  SELECT 1 FROM "simat_criterios" c WHERE c."estacion_id" IS NULL AND c."puerto" = v."puerto" AND c."sector" = v."sector"
);
