// ---------------------------------------------------------------------------
// SIMAT-GAL — Sistema Provincial de Monitoreo Hidrometeorológico y Alerta
// Temprana de Galápagos (migration 0040).
//
// Ported from the standalone Flask app (SIMAT-GAL-Web-rediseno.zip). The data
// flows from public sources into Postgres through connectors the worker runs on
// a schedule (see apps/api/src/modules/simat/conectores). The web reads it
// through GET /simat/*. See docs/plan-integracion-simat.md.
// ---------------------------------------------------------------------------

export const SIMAT_ISLAS = ["Santa Cruz", "San Cristóbal", "Isabela", "Floreana"] as const;
export type SimatIsla = (typeof SIMAT_ISLAS)[number];

/**
 * A measured variable. `precipitacion` is the only one the risk matrix needs;
 * the rest are shown as context. Units are fixed per variable (mm, °C, %, …).
 */
export const SIMAT_VARIABLES = [
  "precipitacion",
  "temperatura",
  "humedad",
  "presion",
  "viento_vel",
  "viento_dir",
  "radiacion",
  "uv",
] as const;
export type SimatVariable = (typeof SIMAT_VARIABLES)[number];

/** Where a station or reading comes from. Drives attribution and trust. */
export const SIMAT_FUENTES = ["IERSE", "INAMHI", "FCD", "METAR", "MANUAL"] as const;
export type SimatFuente = (typeof SIMAT_FUENTES)[number];

/** Quality flag carried with each observation, as the zip used it. */
export const SIMAT_CALIDADES = ["válido", "sospechoso", "inválido"] as const;
export type SimatCalidad = (typeof SIMAT_CALIDADES)[number];

/** Last reading the inventory knows for one variable of a station. */
export interface SimatUltimoDato {
  variable: SimatVariable;
  instante: string | null;
  valor: number | null;
  unidad: string;
}

export interface SimatEstacion {
  /** e.g. "IERSE-n_glps06", "INAMHI-64210", "FCD-PA". */
  id: string;
  fuente: SimatFuente;
  codigo: string;
  nombre: string;
  isla: SimatIsla;
  lat: number;
  lon: number;
  altitud: number | null;
  /** Nominal cadence in minutes (5 for IERSE, 60 INAMHI, 1440 FCD daily). */
  pasoMin: number;
  propietario: string;
  /** What the source reports about transmission, e.g. "Operativo". */
  estado: string;
  activa: boolean;
  variables: SimatVariable[];
  ultimoDato: SimatUltimoDato[];
  actualizadoEn: string;
}

/** One rolling accumulation window of rainfall. Mirrors the zip's `series()`. */
export interface SimatVentana {
  minutes: number;
  /** Total mm over the window, or null when incomplete / mixed provenance. */
  total: number | null;
  /** Average intensity in mm/h, or null when `total` is null. */
  intensity: number | null;
  valid: number;
  expected: number;
  reason: string;
}

export interface SimatMuestraLluvia {
  time: string;
  value: number;
  quality: SimatCalidad;
  source: string;
}

/** Payload of GET /simat/estaciones/:id/lluvia. */
export interface SimatSerieLluvia {
  estacion: string;
  paso: number;
  windows: SimatVentana[];
  recent: SimatMuestraLluvia[];
  latest: SimatMuestraLluvia | null;
}

// ── Sea level ──────────────────────────────────────────────────────────────

export const SIMAT_NIVEL_TIPOS = ["Predicción astronómica", "Nivel observado"] as const;
export type SimatNivelTipo = (typeof SIMAT_NIVEL_TIPOS)[number];

export interface SimatNivelMar {
  id: string;
  puerto: string;
  tipo: SimatNivelTipo;
  /** ISO instant for observed levels; for predictions it is the published local time. */
  instante: string;
  /** True when `instante` is a published local wall-clock time, not a true UTC instant. */
  horaPublicada: boolean;
  valor: number;
  unidad: string;
  referencia: string;
  fase: string | null;
  calidad: string;
  fuente: string;
}

export interface SimatMareografoPunto {
  fecha: string;
  valor: number;
}

/** Payload of GET /simat/mareografos/:codigo. */
export interface SimatMareografo {
  codigo: string;
  puerto: string;
  estacion: string;
  valor: number;
  unidad: string;
  fecha: string;
  sensor: string;
  referencia: string;
  calidad: string;
  fuente: string;
  enlace: string;
  serie: SimatMareografoPunto[];
}

// ── Rain forecast (Open-Meteo) ───────────────────────────────────────────────

export interface SimatPronosticoHora {
  inicio: string;
  fin: string;
  mm: number | null;
  probabilidad: number | null;
}

export interface SimatPronostico {
  estacion: string;
  consultado: string;
  estimacion: {
    inicio: string;
    fin: string;
    mm: number;
    minutos: number;
    intensidad: number;
  } | null;
  pronostico: SimatPronosticoHora[];
  /** Las últimas 24 h según el mismo modelo, para compararlas con la lluvia medida. */
  pasado: SimatPronosticoHora[];
}

// ── Risk scale ───────────────────────────────────────────────────────────────

/**
 * Escala de riesgo por lluvia (umbrales del equipo técnico, migración 0044):
 * la lluvia promedio en la ventana del criterio frente a tres umbrales da el
 * nivel; si el sector tiene umbral de mar y el mar observado lo alcanza, el
 * nivel sube uno (hasta Respuesta).
 */
export const SIMAT_NIVELES_RIESGO = ["Normal", "Vigilancia", "Preparación", "Respuesta"] as const;
export type SimatNivelRiesgo = (typeof SIMAT_NIVELES_RIESGO)[number];

export const SIMAT_ESTADOS_VALIDACION = ["experimental", "validado"] as const;
export type SimatEstadoValidacion = (typeof SIMAT_ESTADOS_VALIDACION)[number];

/** Umbrales de lluvia en mm/h (vigilancia ≤ preparación ≤ respuesta). */
export interface SimatUmbralesLluvia {
  vigilancia: number;
  preparacion: number;
  respuesta: number;
}

export interface SimatCriterio {
  id: string;
  /** null: el sector aún no tiene estación de lluvia y no se evalúa. */
  estacion: string | null;
  /** Da la lluvia cuando la estación principal no tiene una ventana válida y vigente. */
  estacionRespaldo: string | null;
  isla: SimatIsla;
  puerto: string;
  datum: string;
  sector: string;
  respaldo: string;
  ventanaMin: number;
  vigenciaMin: number;
  desfaseMin: number;
  lluvia: SimatUmbralesLluvia;
  /** Umbral de mar alto en `datum`; null = el mar no modifica el nivel. */
  marM: number | null;
  estadoValidacion: SimatEstadoValidacion;
  alertasPublicas: boolean;
  /** Habilita el nivel oficial; desactivado, el nivel es solo orientativo. */
  activo: boolean;
  actualizadoPor: string;
  actualizadoEn: string;
}

/** Body of PUT /simat/criterios. */
export interface SimatCriterioEntrada {
  id?: string;
  estacion: string | null;
  /** Sin el campo, una edición conserva el respaldo que tenía el criterio. */
  estacionRespaldo?: string | null;
  puerto: string;
  datum: string;
  sector: string;
  respaldo: string;
  ventanaMin: number;
  vigenciaMin: number;
  desfaseMin: number;
  lluvia: SimatUmbralesLluvia;
  marM: number | null;
  estadoValidacion: SimatEstadoValidacion;
  alertasPublicas: boolean;
  activo: boolean;
}

/** One evaluated sector. */
export interface SimatEvaluacion {
  criterio: SimatCriterio;
  /** Nivel oficial: solo con el criterio activo y sin `motivos` que lo impidan. */
  nivel: SimatNivelRiesgo | null;
  /** El mismo cálculo aunque el criterio no esté activo (experimental, orientativo). */
  nivelOrientativo: SimatNivelRiesgo | null;
  /** Nivel que da solo la lluvia, antes de considerar el mar. */
  nivelLluvia: SimatNivelRiesgo | null;
  /** true/false si el mar se comparó con su umbral; null si no hay umbral o dato. */
  marAlto: boolean | null;
  /** Por qué no hay nivel oficial (o tampoco orientativo). */
  motivos: string[];
  /** Notas que no impiden el nivel (p. ej. falta el dato de mar). */
  avisos: string[];
  /** Estación cuya lluvia se evaluó (la principal o, si esta no sirve, la de respaldo). */
  estacionUsada: string | null;
  /** true si el nivel sale de la estación de respaldo. */
  enRespaldo: boolean;
  lluvia: {
    valor: number | null;
    fecha: string | null;
    fuente: string | null;
    intervalos: number | null;
    esperados: number | null;
  };
  mar: SimatNivelMar | null;
}

// ── Tide monitoring (evaluar_marea) ─────────────────────────────────────────

/**
 * Estados de evaluar_marea() (función del equipo técnico): solo con predicción
 * y observación compatibles, vigentes y sincrónicas hay anomalía.
 */
export type SimatEstadoMarea =
  | "SIN_PREDICCION"
  | "SOLO_PREDICCION"
  | "DATUM_INCOMPATIBLE"
  | "HORA_SIN_ZONA"
  | "DATO_NO_VIGENTE"
  | "SIN_HORA_PREDICCION"
  | "DATOS_DESFASADOS"
  | "MONITOREO_VALIDO";

/** Monitoreo de marea de un puerto: marea prevista frente a la observada. */
export interface SimatMonitoreoMarea {
  puerto: string;
  estado: SimatEstadoMarea;
  /** Marea prevista (curva entre las pleamares y bajamares publicadas) a la hora de la observación. */
  mareaPredichaM: number | null;
  fechaPrediccion: string | null;
  mareaObservadaM: number | null;
  fechaObservacion: string | null;
  /** Observada − predicha (m, 3 decimales); solo con estado MONITOREO_VALIDO. */
  anomaliaMarM: number | null;
  datum: string | null;
  datumObservado: string | null;
  fuenteObservada: string | null;
  vigenciaMin: number;
  desfaseMin: number;
  /** Siempre false: no hay umbral de inundación validado. */
  alertaInundacion: boolean;
  umbralInundacionValidado: boolean;
}

/**
 * Percentiles de marea alta de un puerto (equipo técnico, migración 0046):
 * referencia de monitoreo experimental; no son umbrales de inundación.
 */
export interface SimatUmbralMarea {
  /** Clave del puerto en el sistema. */
  puerto: string;
  /** Nombre del puerto tal como se recibió. */
  nombre: string;
  p90: number;
  p95: number;
  p99: number;
  /** Tal como se recibió (p. ej. «MLWS_NO_CONFIRMADO», «MLLW»). */
  datum: string;
  periodo: string;
  metodo: string;
  validado: boolean;
  uso: string;
  alertasOficiales: boolean;
}

/** Body of POST /simat/nivel-observado. */
export interface SimatNivelObservadoEntrada {
  puerto: string;
  instante: string;
  valor: number;
  unidad: string;
  referencia: string;
  calidad: string;
  /** Gauge or observer that took the reading; the server appends who registered it. */
  fuente?: string;
}

// ── Connector health ─────────────────────────────────────────────────────────

export const SIMAT_CONECTORES = [
  "ierse",
  "ioc",
  "inocar",
  "inamhi-inventario",
  "inamhi-series",
  "fcd",
  "metar",
] as const;
export type SimatConector = (typeof SIMAT_CONECTORES)[number];

export interface SimatConectorEstado {
  conector: SimatConector;
  nombre: string;
  descripcion: string;
  /** Null until it has ever run. */
  ultimoIntento: string | null;
  ultimoExito: string | null;
  resultado: string | null;
  registros: number;
  error: string | null;
  fallosSeguidos: number;
  /** False when the connector is deliberately turned off (INAMHI series). */
  habilitado: boolean;
  intervaloMin: number;
}

/** An entry of the source inventory shown on the Estaciones y fuentes page. */
export interface SimatFuenteInventario {
  nombre: string;
  cobertura: string;
  descripcion: string;
  pendiente: string;
  licencia: string;
  url: string;
}

// ── /simat/estado ────────────────────────────────────────────────────────────

/** Ports per island for the risk page (riesgo.py PORTS). */
export type SimatPuertos = Record<string, Record<string, string>>;

export interface SimatEstado {
  generadoEn: string;
  islas: readonly SimatIsla[];
  estaciones: SimatEstacion[];
  puertos: SimatPuertos;
  riesgo: SimatEvaluacion[];
  /** Monitoreo de marea por puerto (evaluar_marea). */
  monitoreoMarea: SimatMonitoreoMarea[];
  /** Percentiles de marea alta por puerto (monitoreo experimental). */
  umbralesMarea: SimatUmbralMarea[];
  conectores: SimatConectorEstado[];
  fuentes: SimatFuenteInventario[];
  /** Whether the viewer may configure criteria / register observed levels. */
  puedeEditar: boolean;
}
