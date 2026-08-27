/**
 * Server-side mirror of the reporting calendar the web app draws in
 * `apps/web/lib/planPeriods.ts`. The dialog that notifies pending activities
 * cannot trust the browser for what is pending, so the counts and the emailed
 * tables are both derived here from the same primitives the Cronograma uses.
 *
 * Reporting periods ("mar-ago 2025") are `blockSize` months wide, measured from
 * the plan start month, with `blockSize` coming from the plan's `report_per`.
 */

const BUSINESS_TIME_ZONE = "Pacific/Galapagos";

// Month labels go through Intl, never a hand-rolled table: CLDR abbreviates
// September as "sept", and a table that spelled it "sep" would silently produce
// period keys that match neither the web UI nor `enabledPeriodKeys`.
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("es", { month: "short", timeZone: "UTC" });
function monthLabelEs(monthIndex: number): string {
  return MONTH_LABEL_FMT.format(Date.UTC(2000, monthIndex, 1));
}

export type PlanScheduleInput = {
  startDate: string | null;
  createdAt: Date;
  reportPer: string;
};

/** Reporting-period width in months. `report_per` is a 3-value pg enum. */
export function getBlockSize(reportPer: string): number {
  const value = reportPer.trim().toLowerCase();
  if (value === "2 años") return 24;
  if (value === "1 año") return 12;
  if (value === "6 meses") return 6;
  throw new RangeError(`Periodo de reporte no soportado: ${reportPer || "vacío"}`);
}

/**
 * Current month on the Galápagos business calendar, as a month index
 * (year * 12 + month - 1). The web calendar is built in this same zone, so a
 * request served from a UTC container must not shift the period boundaries.
 */
export function getBusinessMonthIndex(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("No se pudo determinar el mes operativo");
  }
  return year * 12 + month - 1;
}

function monthIndexOf(year: number, month: number): number {
  return year * 12 + month - 1;
}

export function monthKeyOf(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Short month label used across the UI and the emails, e.g. "ago 2025". */
export function monthLabelOf(index: number): string {
  return `${monthLabelEs(index % 12)} ${Math.floor(index / 12)}`;
}

/** Plan start month, explicit when set, otherwise the creation month. */
export function getPlanOriginIndex(plan: PlanScheduleInput): number {
  const match = plan.startDate ? /^(\d{4})-(\d{2})-\d{2}$/.exec(plan.startDate) : null;
  if (match) return monthIndexOf(Number(match[1]), Number(match[2]));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(plan.createdAt);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("No se pudo determinar el mes de inicio del plan");
  }
  return monthIndexOf(year, month);
}

export type PlanCalendar = {
  originIndex: number;
  currentIndex: number;
  blockSize: number;
  /** Index of the reporting period in progress. */
  currentBlockIndex: number;
};

export function getPlanCalendar(plan: PlanScheduleInput, now = new Date()): PlanCalendar {
  const originIndex = getPlanOriginIndex(plan);
  const currentIndex = getBusinessMonthIndex(now);
  const blockSize = getBlockSize(plan.reportPer);
  // A plan whose start month is still in the future has no period in progress;
  // clamping to 0 keeps the first period visible with a zero count instead of
  // producing a negative block index that matches nothing.
  const currentBlockIndex = Math.max(0, Math.floor((currentIndex - originIndex) / blockSize));
  return { originIndex, currentIndex, blockSize, currentBlockIndex };
}

/**
 * Label of a reporting period, byte-for-byte the form `enabledPeriodKeys` in
 * periodComplianceModule accepts — the whole block, never clipped at today, so
 * the period in progress reads "mar-ago 2026" while it is still August. Keeping
 * one spelling means a key from this dialog is the same key
 * `pma_period_compliance` stores for that period.
 */
export function getPeriodKey(calendar: PlanCalendar, blockIndex: number): string {
  const { originIndex, blockSize } = calendar;
  const startIndex = originIndex + blockIndex * blockSize;
  const endIndex = startIndex + blockSize - 1;
  const startLabel = monthLabelEs(startIndex % 12);
  const endLabel = monthLabelEs(endIndex % 12);
  const startYear = Math.floor(startIndex / 12);
  const endYear = Math.floor(endIndex / 12);
  if (startYear !== endYear) return `${startLabel} ${startYear}-${endLabel} ${endYear}`;
  return `${startLabel}-${endLabel} ${endYear}`;
}

/**
 * Every reporting period that has begun, oldest first. The block index travels
 * with the key so callers never have to infer one from array position.
 */
export function getPlanPeriods(calendar: PlanCalendar): { blockIndex: number; key: string }[] {
  const periods: { blockIndex: number; key: string }[] = [];
  for (let blockIndex = 0; blockIndex <= calendar.currentBlockIndex; blockIndex++) {
    periods.push({ blockIndex, key: getPeriodKey(calendar, blockIndex) });
  }
  return periods;
}

/** Month indexes covered by a reporting period, first to last. */
export function getPeriodBounds(
  calendar: PlanCalendar,
  blockIndex: number,
): { startIndex: number; endIndex: number } {
  const startIndex = calendar.originIndex + blockIndex * calendar.blockSize;
  return { startIndex, endIndex: startIndex + calendar.blockSize - 1 };
}

/** "YYYY-MM" of every month in a reporting period. */
export function getPeriodMonthKeys(calendar: PlanCalendar, blockIndex: number): string[] {
  const { startIndex, endIndex } = getPeriodBounds(calendar, blockIndex);
  const keys: string[] = [];
  for (let month = startIndex; month <= endIndex; month++) keys.push(monthKeyOf(month));
  return keys;
}
