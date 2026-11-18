// Nivel del mar: predicciones, observaciones, extremos de marea y el aviso
// costero de la vista previa (risk-ui.js), sobre las filas de GET /simat/mareas.

import type { SimatEvaluacion, SimatNivelMar } from "@pma/types";
import type { TideExtreme } from "./graficos";
import { fechaHora } from "./formato";

const fmtDiaPuerto = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Galapagos", year: "numeric", month: "2-digit", day: "2-digit" });

/** Las horas publicadas se interpretan como hora de Galápagos (UTC−6). */
export function instanteMarino(row: SimatNivelMar): number {
  return row.horaPublicada ? Date.parse(`${String(row.instante).replace(" ", "T")}:00-06:00`) : Date.parse(row.instante);
}

export function horaMarina(row: SimatNivelMar): string {
  return row.horaPublicada ? `${row.instante} · hora publicada` : `${fechaHora(row.instante)} · Galápagos`;
}

export function prediccionesPuerto(rows: SimatNivelMar[], puerto: string): SimatNivelMar[] {
  return rows
    .filter((r) => r.puerto === puerto && r.tipo === "Predicción astronómica")
    .sort((a, b) => instanteMarino(b) - instanteMarino(a));
}

export function observacionPuerto(rows: SimatNivelMar[], puerto: string): SimatNivelMar | undefined {
  return rows
    .filter((r) => r.puerto === puerto && r.tipo === "Nivel observado")
    .sort((a, b) => instanteMarino(b) - instanteMarino(a))[0];
}

export function diaPuerto(clock = Date.now()): string {
  return fmtDiaPuerto.format(new Date(clock));
}

export function extremosMarea(rows: SimatNivelMar[], puerto: string, clock = Date.now()): TideExtreme[] {
  const all = prediccionesPuerto(rows, puerto)
    .filter((r) => r.unidad === "m" && Number.isFinite(r.valor) && (r.fase === "Pleamar" || r.fase === "Bajamar"))
    .map((r) => ({ t: instanteMarino(r), h: r.valor, fase: r.fase as string, ref: String(r.referencia || "").trim() }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  const near = all.filter((e) => e.t >= clock - 36 * 3600e3 && e.t <= clock + 48 * 3600e3);
  return near.length >= 2 ? near : all.slice(-8);
}

/**
 * Altura de la marea astronómica en el instante `t`: la misma curva coseno entre
 * pleamares y bajamares publicadas que dibuja la gráfica de mareas. Fuera de los
 * extremos disponibles no se extrapola (null).
 */
export function nivelMarea(extremos: TideExtreme[], t: number): number | null {
  if (extremos.length < 2 || t < extremos[0].t || t > extremos[extremos.length - 1].t) return null;
  const i = extremos.findIndex((e) => e.t >= t);
  if (i <= 0) return extremos[0].h;
  const a = extremos[i - 1];
  const b = extremos[i];
  const f = (t - a.t) / (b.t - a.t);
  return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * f);
}

export interface AvisoMarino {
  title: string;
  tone: "caution" | "unavailable";
  detail: string;
  row?: SimatNivelMar;
}

const CALIDADES = ["válido", "validado", "validada"];

export function avisoMarino(result: SimatEvaluacion | undefined, forecasts: SimatNivelMar[], day = diaPuerto(), clock = Date.now()): AvisoMarino {
  const criteria = result?.criterio;
  const observed = result?.mar ?? undefined;
  const compatible = (row?: SimatNivelMar | null) =>
    !!criteria?.activo &&
    row?.unidad === "m" &&
    String(row.referencia).trim().toLowerCase() === criteria.datum.toLowerCase() &&
    Number.isFinite(row.valor);
  if (criteria && observed && compatible(observed)) {
    const age = clock - Date.parse(observed.instante);
    if (age >= 0 && age <= criteria.vigenciaMin * 60000 && CALIDADES.includes(String(observed.calidad).trim().toLowerCase())) {
      const high = observed.valor >= criteria.marM;
      return {
        title: high ? "Precaución costera · mar alto observado" : "Umbral marino no alcanzado",
        tone: high ? "caution" : "unavailable",
        row: observed,
        detail: `Medición de referencia del sector ${criteria.sector}.`,
      };
    }
  }
  const today = forecasts.filter(
    (row) =>
      row.fase === "Pleamar" &&
      row.unidad === "m" &&
      Number.isFinite(row.valor) &&
      (row.horaPublicada ? row.instante.slice(0, 10) : fmtDiaPuerto.format(new Date(row.instante))) === day,
  );
  const comparable = today.filter(compatible);
  const highest = (rows: SimatNivelMar[]) => rows.reduce<SimatNivelMar | null>((max, row) => (!max || row.valor > max.valor ? row : max), null);
  const row = highest(comparable) || highest(today);
  if (!row) return { title: "Pronóstico de pleamar no disponible para hoy", tone: "unavailable", detail: "Consulta la fecha de los registros en la tabla de mareas." };
  if (criteria && compatible(row)) {
    const high = row.valor >= criteria.marM;
    return {
      row,
      title: high ? "Precaución costera · mar alto previsto" : "Pleamar prevista bajo el umbral del sector",
      tone: high ? "caution" : "unavailable",
      detail: `Máxima pleamar publicada hoy en el datum configurado para ${criteria.sector}.`,
    };
  }
  return {
    row,
    title: "Vigilancia costera · pleamar prevista",
    tone: "caution",
    detail: "Máxima pleamar publicada para hoy. Hace falta un umbral local compatible para determinar si representa un riesgo costero.",
  };
}

/** Puertos del ámbito: los publicados para la isla y los de sus criterios. */
export function puertosIsla(puertos: Record<string, Record<string, string>>, riesgo: SimatEvaluacion[], isla: string | undefined): Map<string, string> {
  const ports = new Map(Object.entries(puertos?.[isla ?? ""] || {}));
  for (const { criterio } of riesgo) {
    if (criterio.isla === isla && !ports.has(criterio.puerto)) ports.set(criterio.puerto, criterio.puerto);
  }
  return ports;
}

/** Código de mareógrafo IOC por puerto (los de modules/simat/conectores/ioc). */
export const MAREOGRAFO_POR_PUERTO: Record<string, string> = { "Isla Santa Cruz": "sant", "Isla Baltra": "balt" };
