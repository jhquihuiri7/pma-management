/**
 * PG2030 cutoffs (docs/pg2030-plan.md §7), as pure functions of the calendar.
 *
 * Nothing here is stored: every write recomputes whether its month is locked
 * from the year's configuration, the date and any reopening, so locking holds
 * even when no background process runs at the deadline.
 *
 * Dates are `YYYY-MM-DD` strings, which compare correctly as text. A deadline
 * date means "until the end of that day in Galápagos": the day stops being
 * editable at 00:00 of the next one.
 */

export type Trimestre = 1 | 2 | 3 | 4;
export const TRIMESTRES: readonly Trimestre[] = [1, 2, 3, 4];

export interface AnioCortes {
  anio: number;
  primerCorte: Trimestre;
  /** Initial-load deadline, or null when the year opened with nothing expired. */
  fechaLimiteCarga: string | null;
}

export type EstadoCorte = "no_habilitado" | "abierto" | "en_carga" | "cerrado";

/**
 * Pacific/Galapagos is UTC−6 all year round (no daylight saving), the same
 * zone PMA and RGDP use for their business dates. A fixed offset keeps these
 * functions free of Intl; a test cross-checks it against the IANA database.
 */
const GALAPAGOS_UTC_OFFSET_HOURS = 6;

export function trimestreDeMes(mes: number): Trimestre {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new RangeError(`Mes inválido: ${mes}`);
  return Math.ceil(mes / 3) as Trimestre;
}

export function mesesDeTrimestre(t: Trimestre): number[] {
  return [3 * t - 2, 3 * t - 1, 3 * t];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last day of `month` (1–12) of `year`. */
function ultimoDia(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Base deadline of a cutoff: the last day of the month after the quarter.
 * T4's falls on 31 January of the following year.
 */
export function plazoBase(anio: number, t: Trimestre): string {
  const month = 3 * t + 1; // 4, 7, 10, 13
  const year = month === 13 ? anio + 1 : anio;
  const m = month === 13 ? 1 : month;
  return `${year}-${pad(m)}-${pad(ultimoDia(year, m))}`;
}

/** The instant a deadline day stops being editable: 00:00 of the next day, Galápagos time. */
export function finDelDia(fecha: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!match) throw new RangeError(`Fecha inválida: ${fecha}`);
  const [, y, m, d] = match.map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, GALAPAGOS_UTC_OFFSET_HOURS));
}

/** The latest of the given dates, ignoring nulls. */
export function maxFecha(...fechas: Array<string | null | undefined>): string {
  const present = fechas.filter((f): f is string => typeof f === "string");
  if (present.length === 0) throw new RangeError("Se requiere al menos una fecha");
  return present.reduce((a, b) => (b > a ? b : a));
}

export function corteHabilitado(cfg: AnioCortes, t: Trimestre): boolean {
  return t >= cfg.primerCorte;
}

/**
 * The cutoff a month answers to for locking and reopening: its own, or — for a
 * month of a cutoff that is not habilitated — the first habilitated one. In
 * 2026, opened from T2, January to March travel with T2.
 */
export function corteDeMes(cfg: AnioCortes, mes: number): Trimestre {
  return Math.max(trimestreDeMes(mes), cfg.primerCorte) as Trimestre;
}

/** Whether a habilitated cutoff is part of the initial load. */
export function corteEnCarga(cfg: AnioCortes, t: Trimestre): boolean {
  return cfg.fechaLimiteCarga !== null && corteHabilitado(cfg, t) && plazoBase(cfg.anio, t) <= cfg.fechaLimiteCarga;
}

/** Deadline that closes a cutoff for everyone: the base one, pushed to the load deadline when in the load. */
export function plazoCierre(cfg: AnioCortes, t: Trimestre): string {
  const base = plazoBase(cfg.anio, t);
  return corteEnCarga(cfg, t) ? maxFecha(base, cfg.fechaLimiteCarga) : base;
}

/** Deadline for one institution: the closing one, pushed by its latest reopening. */
export function plazoEfectivo(cfg: AnioCortes, t: Trimestre, reaperturaHasta: string | null): string {
  return maxFecha(plazoCierre(cfg, t), reaperturaHasta);
}

/** Whether a cutoff has closed at least once, regardless of any reopening. */
export function corteCerrado(cfg: AnioCortes, t: Trimestre, now: Date): boolean {
  return now >= finDelDia(plazoCierre(cfg, t));
}

/** Whether a month's plan and execution are locked for an institution. */
export function mesBloqueado(cfg: AnioCortes, mes: number, reaperturaHasta: string | null, now: Date): boolean {
  return now >= finDelDia(plazoEfectivo(cfg, corteDeMes(cfg, mes), reaperturaHasta));
}

/**
 * An administrator reports for an institution only inside the initial load
 * (§7, "Quién reporta"); outside it, only the institution reports.
 */
export function adminPuedeReportar(cfg: AnioCortes, mes: number, now: Date): boolean {
  return (
    cfg.fechaLimiteCarga !== null &&
    corteEnCarga(cfg, corteDeMes(cfg, mes)) &&
    now < finDelDia(cfg.fechaLimiteCarga)
  );
}

export function estadoCorte(cfg: AnioCortes, t: Trimestre, now: Date): EstadoCorte {
  if (!corteHabilitado(cfg, t)) return "no_habilitado";
  if (corteCerrado(cfg, t, now)) return "cerrado";
  if (corteEnCarga(cfg, t)) return "en_carga";
  return "abierto";
}

/** Habilitated cutoffs whose base deadline has already passed: they force an initial load. */
export function cortesVencidos(anio: number, primerCorte: Trimestre, now: Date): Trimestre[] {
  return TRIMESTRES.filter((t) => t >= primerCorte && now >= finDelDia(plazoBase(anio, t)));
}

/**
 * The warning against reporting cumulative values (§6): a month executes
 * something with nothing planned, or at least twice what was planned. It only
 * warns; saving goes ahead.
 */
export function avisoAcumulado(planificado: number, ejecutado: number): boolean {
  if (ejecutado <= 0) return false;
  if (planificado <= 0) return true;
  return ejecutado >= 2 * planificado;
}
