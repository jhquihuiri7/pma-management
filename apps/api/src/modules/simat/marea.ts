// Monitoreo de marea: port de evaluar_marea() del equipo técnico (Python).
// Compara la marea prevista con la observada en el mismo datum y, solo si la
// observación está vigente y ambas son sincrónicas, informa la anomalía
// (observada − predicha). No emite alerta de inundación: no hay umbral
// validado. No interviene en la escala de riesgo.
//
// INOCAR publica solo pleamares y bajamares; la marea predicha a la hora de la
// observación sale de la curva coseno entre esos extremos (la misma que dibuja
// el panel), así que la hora de la predicción es la de la observación.

import type { SimatEstadoMarea, SimatMonitoreoMarea, SimatNivelMar } from "@pma/types";

/** Valores por defecto de evaluar_marea(). */
export const VIGENCIA_MAREA_MIN = 90;
export const DESFASE_MAREA_MIN = 30;

export interface EntradaMarea {
  predichaM: number | null;
  observadaM: number | null;
  /** ISO 8601 con zona horaria. */
  fechaObservacion: string | null;
  datumPredicho: string | null;
  datumObservado: string | null;
  vigenciaMin?: number;
  desfaseMin?: number;
  /** ISO 8601 con zona horaria. */
  fechaPrediccion?: string | null;
}

export interface ResultadoMarea {
  estado: SimatEstadoMarea;
  anomaliaMarM: number | null;
  mareaPredichaM?: number;
  mareaObservadaM?: number;
  datum?: string;
  alertaInundacion?: false;
  umbralInundacionValidado?: false;
}

/** ¿La marca de tiempo trae zona horaria (Z o ±hh:mm)? Equivale a tzinfo de Python. */
const conZona = (iso: string) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim());

/** Port literal de evaluar_marea(): mismo orden de comprobaciones y estados. */
export function evaluarMarea(e: EntradaMarea, ahora: Date = new Date()): ResultadoMarea {
  const vigenciaMin = e.vigenciaMin ?? VIGENCIA_MAREA_MIN;
  const desfaseMin = e.desfaseMin ?? DESFASE_MAREA_MIN;

  if (e.predichaM == null) return { estado: "SIN_PREDICCION", anomaliaMarM: null };

  if (e.observadaM == null || e.fechaObservacion == null) {
    return { estado: "SOLO_PREDICCION", mareaPredichaM: e.predichaM, anomaliaMarM: null };
  }

  if (e.datumPredicho !== e.datumObservado) return { estado: "DATUM_INCOMPATIBLE", anomaliaMarM: null };

  if (!conZona(e.fechaObservacion)) return { estado: "HORA_SIN_ZONA", anomaliaMarM: null };

  const observacion = Date.parse(e.fechaObservacion);
  const edadMin = (ahora.getTime() - observacion) / 60_000;
  if (edadMin < 0 || edadMin > vigenciaMin) return { estado: "DATO_NO_VIGENTE", anomaliaMarM: null };

  if (e.fechaPrediccion != null) {
    if (!conZona(e.fechaPrediccion)) return { estado: "HORA_SIN_ZONA", anomaliaMarM: null };
    const desfase = Math.abs(Date.parse(e.fechaPrediccion) - observacion) / 60_000;
    if (desfase > desfaseMin) return { estado: "DATOS_DESFASADOS", anomaliaMarM: null };
  } else {
    return { estado: "SIN_HORA_PREDICCION", anomaliaMarM: null };
  }

  const anomalia = e.observadaM - e.predichaM;
  return {
    estado: "MONITOREO_VALIDO",
    mareaPredichaM: e.predichaM,
    mareaObservadaM: e.observadaM,
    anomaliaMarM: Math.round(anomalia * 1000) / 1000,
    datum: e.datumPredicho ?? undefined,
    alertaInundacion: false,
    umbralInundacionValidado: false,
  };
}

interface Extremo {
  t: number;
  h: number;
  ref: string;
}

/** Las horas publicadas de INOCAR son hora de Galápagos (UTC−6). */
function instante(r: SimatNivelMar): number {
  return r.horaPublicada ? Date.parse(`${String(r.instante).replace(" ", "T")}:00-06:00`) : Date.parse(r.instante);
}

/** Pleamares y bajamares publicadas de un puerto, en orden. */
export function extremosPuerto(filas: SimatNivelMar[], puerto: string): Extremo[] {
  return filas
    .filter((r) => r.puerto === puerto && r.tipo === "Predicción astronómica" && r.unidad === "m" && Number.isFinite(r.valor) && (r.fase === "Pleamar" || r.fase === "Bajamar"))
    .map((r) => ({ t: instante(r), h: r.valor, ref: String(r.referencia ?? "").trim() }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
}

/** Marea prevista en `t` por la curva coseno entre extremos; null fuera de ellos. */
export function mareaPrevista(extremos: Extremo[], t: number): number | null {
  if (extremos.length < 2 || t < extremos[0].t || t > extremos[extremos.length - 1].t) return null;
  const i = extremos.findIndex((e) => e.t >= t);
  if (i <= 0) return extremos[0].h;
  const a = extremos[i - 1];
  const b = extremos[i];
  const f = (t - a.t) / (b.t - a.t);
  return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * f);
}

/**
 * Monitoreo de un puerto: la observación más reciente en el datum de la
 * predicción (si la hay) o, si no, la más reciente; y la marea prevista a su
 * hora. Sin observación, la predicción es la de ahora (SOLO_PREDICCION).
 */
export function monitoreoPuerto(filas: SimatNivelMar[], puerto: string, ahora: Date = new Date()): SimatMonitoreoMarea {
  const extremos = extremosPuerto(filas, puerto);
  const datum = extremos[0]?.ref || null;
  const observados = filas
    .filter((r) => r.puerto === puerto && r.tipo === "Nivel observado" && r.unidad === "m" && Number.isFinite(r.valor) && Number.isFinite(Date.parse(r.instante)))
    .sort((a, b) => Date.parse(b.instante) - Date.parse(a.instante));
  const mismoDatum = (r: SimatNivelMar) => datum != null && String(r.referencia ?? "").trim().toLowerCase() === datum.toLowerCase();
  const obs = observados.find(mismoDatum) ?? observados[0] ?? null;

  const tPrediccion = obs ? Date.parse(obs.instante) : ahora.getTime();
  const predicha = mareaPrevista(extremos, tPrediccion);
  const predichaM = predicha == null ? null : Math.round(predicha * 1000) / 1000;
  const fechaPrediccion = predicha == null ? null : new Date(tPrediccion).toISOString();
  // El datum observado se compara tal cual se publicó (como en la función original);
  // solo se normalizan espacios para no rechazar «MLWS » frente a «MLWS».
  const datumObservado = obs ? String(obs.referencia ?? "").trim() : null;

  const r = evaluarMarea(
    {
      predichaM,
      observadaM: obs?.valor ?? null,
      fechaObservacion: obs?.instante ?? null,
      datumPredicho: datum,
      datumObservado: datumObservado && datum && datumObservado.toLowerCase() === datum.toLowerCase() ? datum : datumObservado,
      fechaPrediccion,
    },
    ahora,
  );

  return {
    puerto,
    estado: r.estado,
    mareaPredichaM: predichaM,
    fechaPrediccion,
    mareaObservadaM: obs?.valor ?? null,
    fechaObservacion: obs?.instante ?? null,
    anomaliaMarM: r.anomaliaMarM,
    datum,
    datumObservado,
    fuenteObservada: obs?.fuente ?? null,
    vigenciaMin: VIGENCIA_MAREA_MIN,
    desfaseMin: DESFASE_MAREA_MIN,
    alertaInundacion: false,
    umbralInundacionValidado: false,
  };
}
