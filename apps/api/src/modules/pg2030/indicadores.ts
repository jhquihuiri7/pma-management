/**
 * PG2030 calculation rules (docs/pg2030-plan.md §9), as pure functions.
 *
 * They are the single implementation behind the dashboard and, later, the
 * quarterly report. Fractions run 0–1 (0.8022 = 80,22 %); formatting happens
 * at the edges.
 */
import type { Pg2030Coherencia, Pg2030EstadoReporte, Pg2030Semaforo } from "@pma/types";

/** §9.5 — on the capped, unrounded value; intervals without gaps. */
export function semaforo(valor: number): Pg2030Semaforo {
  if (valor >= 0.85) return "verde";
  if (valor >= 0.7) return "amarillo";
  if (valor > 0) return "rojo";
  return "sin_avance";
}

export function promedio(valores: number[]): number | null {
  return valores.length === 0 ? null : valores.reduce((a, b) => a + b, 0) / valores.length;
}

export interface MesDatos {
  mes: number;
  fisicoPlanificado: number;
  presupuestoPlanificado: number;
  fisicoEjecutado: number | null;
  presupuestoDevengado: number | null;
  reportado: boolean;
}

export type EstadoFisico = "calculable" | "sin_programacion" | "ejecutado_sin_programacion";
export type EstadoPresupuesto = "calculable" | "no_aplica" | "devengado_sin_programacion";

export interface MetaAlCorte {
  /** Σ physical plan + Σ budget plan, January → cutoff, above zero (§9.7). */
  aReportar: boolean;
  /** Every required month of the quarter saved (§9.7). */
  reportada: boolean;
  fisico: { planificado: number; ejecutado: number; avance: number | null; estado: EstadoFisico };
  presupuesto: {
    planificado: number;
    /** What was actually accrued, uncapped: informative only (§9.2). */
    devengado: number;
    /** min(accrued, planned): what every total and average uses (decision D3). */
    computable: number;
    avance: number | null;
    estado: EstadoPresupuesto;
  };
}

/**
 * One goal at a cutoff (§9.1, §9.2, §9.7). `hasta` is the last month counted
 * (the quarter's end, or the last finished month while the cutoff is still
 * open); `exigidos` are the quarter's months that must be saved to count as
 * reported. A month never saved counts as 0.
 */
export function metaAlCorte(meses: MesDatos[], hasta: number, exigidos: number[]): MetaAlCorte {
  const dentro = meses.filter((m) => m.mes <= hasta);
  const sum = (pick: (m: MesDatos) => number | null) => dentro.reduce((s, m) => s + (pick(m) ?? 0), 0);
  const fisPlan = sum((m) => m.fisicoPlanificado);
  const fisEj = sum((m) => m.fisicoEjecutado);
  const presPlan = sum((m) => m.presupuestoPlanificado);
  const dev = sum((m) => m.presupuestoDevengado);

  const fisico: MetaAlCorte["fisico"] = fisPlan > 0
    ? { planificado: fisPlan, ejecutado: fisEj, avance: Math.min(fisEj / fisPlan, 1), estado: "calculable" }
    : { planificado: 0, ejecutado: fisEj, avance: null, estado: fisEj > 0 ? "ejecutado_sin_programacion" : "sin_programacion" };

  const computable = Math.min(dev, presPlan);
  const presupuesto: MetaAlCorte["presupuesto"] = presPlan > 0
    ? { planificado: presPlan, devengado: dev, computable, avance: computable / presPlan, estado: "calculable" }
    : { planificado: 0, devengado: dev, computable: 0, avance: null, estado: dev > 0 ? "devengado_sin_programacion" : "no_aplica" };

  const porMes = new Map(meses.map((m) => [m.mes, m]));
  return {
    aReportar: fisPlan + presPlan > 0,
    reportada: exigidos.length > 0 && exigidos.every((mes) => porMes.get(mes)?.reportado === true),
    fisico,
    presupuesto,
  };
}

export interface InstitucionAlCorte {
  fisico: number | null;
  presupuesto: number | null;
  /** No goal of the institution has a planned budget at the cutoff. */
  sinPresupuesto: boolean;
  computable: number;
  coherencia: Pg2030Coherencia;
}

/** §9.4 and §9.6 over the goals that count (reported at the cutoff). */
export function institucionAlCorte(metas: MetaAlCorte[]): InstitucionAlCorte {
  const fisico = promedio(metas.flatMap((m) => (m.fisico.avance === null ? [] : [m.fisico.avance])));
  const conPresupuesto = metas.filter((m) => m.presupuesto.avance !== null);
  const presupuesto = promedio(conPresupuesto.map((m) => m.presupuesto.avance!));
  const sinPresupuesto = conPresupuesto.length === 0;
  const computable = metas.reduce((s, m) => s + m.presupuesto.computable, 0);
  return { fisico, presupuesto, sinPresupuesto, computable, coherencia: coherencia(fisico, presupuesto, sinPresupuesto, computable) };
}

/** §9.6, in order; the first rule that holds wins. Compared in percentage points. */
export function coherencia(
  fisico: number | null,
  presupuesto: number | null,
  sinPresupuesto: boolean,
  computable: number,
): Pg2030Coherencia {
  if (fisico === null) return "no_aplica";
  if (fisico === 0 && sinPresupuesto) return "no_aplica";
  if (fisico > 0 && (sinPresupuesto || computable === 0)) return "sin_financiamiento";
  if (presupuesto !== null && Math.abs(fisico - presupuesto) * 100 <= 5) return "coherente";
  return "incoherencia_brecha";
}

/** §9.7 by institution and cutoff. */
export function estadoReporte(aReportar: number, reportadas: number): Pg2030EstadoReporte {
  if (aReportar === 0) return "no_obligada";
  if (reportadas >= aReportar) return "cumplio";
  if (reportadas > 0) return "parcial";
  return "no_cumplio";
}

export interface Dinero {
  planificado: number;
  computable: number;
  devengado: number;
  avance: number | null;
  semaforo: Pg2030Semaforo | null;
  metas: number;
}

/** Dollar totals (§9.4): Σ computable ÷ Σ planned over the goals with a budget. */
export function dinero(metas: MetaAlCorte[]): Dinero {
  const conPresupuesto = metas.filter((m) => m.presupuesto.planificado > 0);
  const planificado = conPresupuesto.reduce((s, m) => s + m.presupuesto.planificado, 0);
  const computable = conPresupuesto.reduce((s, m) => s + m.presupuesto.computable, 0);
  const devengado = metas.reduce((s, m) => s + m.presupuesto.devengado, 0);
  const avance = planificado > 0 ? computable / planificado : null;
  return {
    planificado,
    computable,
    devengado,
    avance,
    semaforo: avance === null ? null : semaforo(avance),
    metas: conPresupuesto.length,
  };
}
