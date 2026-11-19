-- SIMAT-GAL · percentiles de marea alta por puerto entregados por el equipo
-- técnico (2026-11-19): p90, p95 y p99 de las pleamares, con su datum,
-- periodo y método. Uso: monitoreo experimental, sin alertas oficiales. No son
-- umbrales de inundación («mar_m_critico» viene nulo), así que no cambian la
-- escala de riesgo de los sectores. Los puertos se guardan con su clave del
-- sistema y el nombre recibido en `nombre`.
CREATE TABLE IF NOT EXISTS "simat_umbrales_marea" (
  "puerto" text PRIMARY KEY,
  "nombre" text NOT NULL,
  "p90" double precision NOT NULL,
  "p95" double precision NOT NULL,
  "p99" double precision NOT NULL,
  "datum" text NOT NULL,
  "periodo" text NOT NULL,
  "metodo" text NOT NULL,
  "validado" boolean NOT NULL DEFAULT false,
  "uso" text NOT NULL DEFAULT 'monitoreo_experimental',
  "alertas_oficiales" boolean NOT NULL DEFAULT false,
  "actualizado_en" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "simat_umbrales_marea_orden_chk" CHECK ("p90" <= "p95" AND "p95" <= "p99")
);
--> statement-breakpoint
INSERT INTO "simat_umbrales_marea" ("puerto", "nombre", "p90", "p95", "p99", "datum", "periodo", "metodo", "validado", "uso", "alertas_oficiales")
VALUES
  ('Isla Santa Cruz', 'Puerto Ayora', 1.98, 2.03, 2.13, 'MLWS_NO_CONFIRMADO', '2026', 'pleamares_horarias', false, 'monitoreo_experimental', false),
  ('Puerto Baquerizo Moreno', 'Puerto Baquerizo Moreno', 1.89, 1.92, 1.92, 'MLLW', '2026-11', 'maximas_diarias', false, 'monitoreo_experimental', false),
  ('Puerto Villamil', 'Puerto Villamil', 1.5, 1.52, 1.55, 'MLLW', '2026-11', 'maximas_diarias', false, 'monitoreo_experimental', false),
  ('Puerto Velasco Ibarra', 'Puerto Velasco Ibarra', 1.56, 1.58, 1.58, 'MLLW', '2026-11', 'maximas_diarias', false, 'monitoreo_experimental', false),
  ('Isla Baltra', 'Baltra', 2.15, 2.19, 2.24, 'MLWS_NO_CONFIRMADO', '2026', 'pleamares_horarias', false, 'monitoreo_experimental', false)
ON CONFLICT ("puerto") DO NOTHING;
