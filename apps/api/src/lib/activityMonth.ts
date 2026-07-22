import { BadRequest } from "./errors.js";

const ACTIVITY_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const BUSINESS_TIME_ZONE = "Pacific/Galapagos";

const PERIODICITY_INTERVAL: Record<string, number> = {
  "Al finalizar la etapa de operacion": 9999,
  "Al finalizar la etapa de operación": 9999,
  "En caso de suceder": 1,
  Diaria: 1,
  Semanal: 1,
  Mensual: 1,
  Bimensual: 2,
  Bianual: 24,
  Trimestral: 3,
  Cuatrimestral: 4,
  Trianual: 36,
  Semestral: 6,
  Anual: 12,
  Permanente: 1,
  "Unica vez": 9999,
  "Única vez": 9999,
};

type ActivityMonthInput = {
  activityMonth: string;
  startDate: string | null;
  createdAt: Date;
  periodicity: string;
  now?: Date;
};

export function isActivityMonth(value: string): boolean {
  return ACTIVITY_MONTH_PATTERN.test(value);
}

/** PMA accepts any month inside a reporting range, once that range has begun. */
export function assertPmaActivityMonth(input: ActivityMonthInput): void {
  const { targetIndex, originIndex, currentIndex } = getMonthIndexes(input);
  const diff = targetIndex - originIndex;
  if (diff < 0) throw BadRequest("activityMonth cannot be before the plan start month");

  const interval = getInterval(input.periodicity);
  const rangeStart = originIndex + Math.floor(diff / interval) * interval;
  if (rangeStart > currentIndex) {
    throw BadRequest("No se puede subir evidencia en un periodo que aún no ha iniciado");
  }
  if (targetIndex > currentIndex) throw BadRequest("activityMonth cannot be in the future");
}

/**
 * PMA ZIP downloads are keyed by the first month of an item's reporting
 * range. Requiring the exact boundary prevents callers from shifting the
 * window to an arbitrary slice that the application calendar never exposes.
 */
export function assertPmaPeriodStart(input: ActivityMonthInput): void {
  const { targetIndex, originIndex, currentIndex } = getMonthIndexes(input);
  const diff = targetIndex - originIndex;
  if (diff < 0) throw BadRequest("periodStart cannot be before the plan start month");

  const interval = getInterval(input.periodicity);
  if (diff % interval !== 0) {
    throw BadRequest("periodStart is not the beginning of a reporting period");
  }
  if (targetIndex > currentIndex) {
    throw BadRequest("periodStart is outside the available calendar range");
  }
}

/** RGDP schedules evidence on the exact month selected by each periodicity. */
export function assertRgdpActivityMonth(input: ActivityMonthInput): void {
  const { targetIndex, originIndex, currentIndex } = getMonthIndexes(input);
  const diff = targetIndex - originIndex;
  if (diff < 0) throw BadRequest("activityMonth cannot be before the plan start month");

  const interval = getInterval(input.periodicity);
  if (diff % interval !== 0) {
    throw BadRequest("activityMonth is not a scheduled month for this plan item");
  }
  if (targetIndex > currentIndex) {
    throw BadRequest("activityMonth is outside the available calendar range");
  }
}

function getMonthIndexes(input: ActivityMonthInput) {
  const match = ACTIVITY_MONTH_PATTERN.exec(input.activityMonth);
  if (!match) throw BadRequest("activityMonth must use YYYY-MM format");

  const targetIndex = Number(match[1]) * 12 + Number(match[2]) - 1;
  const start = parsePlanStart(input.startDate, input.createdAt);
  const originIndex = start.year * 12 + start.month - 1;
  const now = monthParts(input.now ?? new Date());
  const currentIndex = now.year * 12 + now.month - 1;
  return { targetIndex, originIndex, currentIndex };
}

function parsePlanStart(startDate: string | null, createdAt: Date): { year: number; month: number } {
  const match = startDate ? /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate) : null;
  if (match) return { year: Number(match[1]), month: Number(match[2]) };
  return monthParts(createdAt);
}

function getInterval(periodicity: string): number {
  const interval = PERIODICITY_INTERVAL[periodicity];
  if (interval === undefined) throw BadRequest(`Periodicidad no soportada: ${periodicity}`);
  return interval;
}

function monthParts(value: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error("Could not determine business month");
  return { year, month };
}
