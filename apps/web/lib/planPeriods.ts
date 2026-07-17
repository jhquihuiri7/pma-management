import { parseDateOnly } from "@/lib/dateOnly";

interface PlanLike {
  start_date?: string | null;
  createdAt: string;
  report_per?: string;
}

export type PeriodMode = "block" | "monthly";

export function getBlockSize(report_per: string | undefined): number {
  const s = (report_per ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Number of months an item's evidence range spans, derived from the item's
 * periodicity. Values >= 1200 represent "once / at the end" (a single open
 * range for the whole plan).
 */
export const PERIODICITY_INTERVAL: Record<string, number> = {
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

export function getPeriodicityInterval(periodicity?: string): number {
  return PERIODICITY_INTERVAL[periodicity ?? ""] ?? 1;
}

export interface ItemRange {
  /** 0-based range index from the plan start. */
  index: number;
  /** "YYYY-MM" of the first month of the range. */
  key: string;
  /** Human label, e.g. "ene–jun 2025". */
  label: string;
  /** First month of the range (day 1). */
  startMonth: Date;
  /** Last month of the range = the calculated deadline (day 1). */
  realEndMonth: Date;
  /** Visible months of the range, used to lay out the calendar grid. */
  monthKeys: string[];
  /** Months the user may attach an evidence to (start .. deadline). */
  selectableMonthKeys: string[];
  /** True once the range has begun (startMonth <= current month). */
  started: boolean;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rangeLabel(start: Date, realEnd: Date, single: boolean): string {
  const startLbl = start.toLocaleString("es", { month: "short" });
  if (single) return `${startLbl} ${start.getFullYear()} → fin`;
  const endLbl = realEnd.toLocaleString("es", { month: "short" });
  if (start.getFullYear() === realEnd.getFullYear()) {
    if (start.getMonth() === realEnd.getMonth()) return `${startLbl} ${start.getFullYear()}`;
    return `${startLbl}–${endLbl} ${realEnd.getFullYear()}`;
  }
  return `${startLbl} ${start.getFullYear()}–${endLbl} ${realEnd.getFullYear()}`;
}

/**
 * Builds the evidence upload ranges for a single plan item, based on the item's
 * periodicity. Each range spans `interval` months from the plan start; one
 * evidence covers the whole range (from its first month to its deadline).
 * The visible span matches the calendar (plan start .. today + 1 month).
 */
export function getItemRanges(plan: PlanLike, periodicity?: string): ItemRange[] {
  const interval = getPeriodicityInterval(periodicity);
  const planStartDate = parseDateOnly(plan.start_date ?? "") ?? new Date(plan.createdAt);
  const origin = new Date(planStartDate.getFullYear(), planStartDate.getMonth(), 1);
  const today = new Date();
  const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  // Calendar shows up to today + 1 month (its range end is today + 2, exclusive).
  const lastVisible = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const single = interval >= 1200;

  const ranges: ItemRange[] = [];
  for (let idx = 0; idx < 1000; idx++) {
    const startMonth = new Date(origin.getFullYear(), origin.getMonth() + idx * interval, 1);
    if (startMonth > lastVisible) break;
    const realEndMonth = new Date(origin.getFullYear(), origin.getMonth() + (idx + 1) * interval - 1, 1);

    const visibleEnd = realEndMonth > lastVisible ? lastVisible : realEndMonth;
    const monthKeys: string[] = [];
    for (let c = new Date(startMonth); c <= visibleEnd; c.setMonth(c.getMonth() + 1)) {
      monthKeys.push(monthKeyOf(c));
    }

    // For an open ("once / at the end") range, only let the user pick up to today.
    const selectEnd = single ? (todayMonth < startMonth ? startMonth : todayMonth) : realEndMonth;
    const selectableMonthKeys: string[] = [];
    for (let c = new Date(startMonth); c <= selectEnd; c.setMonth(c.getMonth() + 1)) {
      selectableMonthKeys.push(monthKeyOf(c));
    }

    ranges.push({
      index: idx,
      key: monthKeyOf(startMonth),
      label: rangeLabel(startMonth, realEndMonth, single),
      startMonth,
      realEndMonth,
      monthKeys,
      selectableMonthKeys,
      started: startMonth <= todayMonth,
    });

    if (single) break;
  }
  return ranges;
}

export function createPeriodHelpers(plan: PlanLike) {
  const blockSize = getBlockSize(plan.report_per);
  const planStartDate = parseDateOnly(plan.start_date ?? "") ?? new Date(plan.createdAt);
  const blockOrigin = new Date(planStartDate.getFullYear(), planStartDate.getMonth(), 1);

  function diffFromOrigin(month: Date): number {
    return (
      (month.getFullYear() - blockOrigin.getFullYear()) * 12 +
      (month.getMonth() - blockOrigin.getMonth())
    );
  }

  function isBlockEnd(month: Date): boolean {
    const mm = new Date(month.getFullYear(), month.getMonth(), 1);
    if (mm < blockOrigin) return false;
    return (diffFromOrigin(mm) + 1) % blockSize === 0;
  }

  function getPeriodLabel(blockEndMonth: Date): string {
    const diff = diffFromOrigin(new Date(blockEndMonth.getFullYear(), blockEndMonth.getMonth(), 1));
    const blockIndex = Math.floor(diff / blockSize);
    const blockStart = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + blockIndex * blockSize, 1);
    const startLbl = blockStart.toLocaleString("es", { month: "short" });
    const endLbl = blockEndMonth.toLocaleString("es", { month: "short" });
    if (blockStart.getFullYear() !== blockEndMonth.getFullYear()) {
      return `${startLbl} ${blockStart.getFullYear()}-${endLbl} ${blockEndMonth.getFullYear()}`;
    }
    return `${startLbl}-${endLbl} ${blockEndMonth.getFullYear()}`;
  }

  // Returns the period label (e.g. "mar-ago 2025") for a given "YYYY-MM" month
  function getActivityPeriodLabel(activityMonth: string): string {
    const [year, month] = activityMonth.split("-").map(Number);
    const targetDate = new Date(year, month - 1, 1);
    const diff = diffFromOrigin(targetDate);
    if (diff < 0) return activityMonth;
    const blockIndex = Math.floor(diff / blockSize);
    const blockEnd = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + (blockIndex + 1) * blockSize - 1, 1);
    return getPeriodLabel(blockEnd);
  }

  // Returns the Drive folder name (e.g. "mar2025-ago2025") for a given "YYYY-MM" month
  function getActivityPeriodFolder(activityMonth: string): string {
    const [year, month] = activityMonth.split("-").map(Number);
    const targetDate = new Date(year, month - 1, 1);
    const diff = diffFromOrigin(targetDate);
    if (diff < 0) return activityMonth;
    const blockIndex = Math.floor(diff / blockSize);
    const blockStart = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + blockIndex * blockSize, 1);
    const blockEnd = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + (blockIndex + 1) * blockSize - 1, 1);
    return `${MONTHS_ES[blockStart.getMonth()]}${blockStart.getFullYear()}-${MONTHS_ES[blockEnd.getMonth()]}${blockEnd.getFullYear()}`;
  }

  return { blockSize, blockOrigin, isBlockEnd, getPeriodLabel, getActivityPeriodLabel, getActivityPeriodFolder };
}

/**
 * Returns all reporting periods for a plan from its start date up to today+1 month.
 * Period keys use the format "mar-ago 2025".
 */
export function getPlanPeriods(plan: PlanLike): { key: string; label: string }[] {
  return getPlanPeriodsByMode(plan, "block");
}

export function getPlanPeriodsByMode(
  plan: PlanLike,
  mode: PeriodMode
): { key: string; label: string }[] {
  if (mode === "monthly") {
    return getMonthlyPlanPeriods(plan);
  }

  const { isBlockEnd, getPeriodLabel } = createPeriodHelpers(plan);
  const planStartDate = parseDateOnly(plan.start_date ?? "") ?? new Date(plan.createdAt);

  const today = new Date();
  const rangeStart = new Date(planStartDate.getFullYear(), planStartDate.getMonth(), 1);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  const months: Date[] = [];
  const cur = new Date(rangeStart);
  while (cur < rangeEnd) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  const periods: { key: string; label: string }[] = [];
  for (const m of months) {
    if (isBlockEnd(m)) {
      const lbl = getPeriodLabel(m);
      if (!periods.some((p) => p.key === lbl)) {
        periods.push({ key: lbl, label: lbl });
      }
    }
  }

  const lastMonth = months[months.length - 1];
  if (lastMonth && !isBlockEnd(lastMonth)) {
    const lbl = getPeriodLabel(lastMonth);
    if (!periods.some((p) => p.key === lbl)) {
      periods.push({ key: lbl, label: lbl });
    }
  }

  return periods;
}

function getMonthlyPlanPeriods(plan: PlanLike): { key: string; label: string }[] {
  const planStartDate = parseDateOnly(plan.start_date ?? "") ?? new Date(plan.createdAt);
  const today = new Date();
  const rangeStart = new Date(planStartDate.getFullYear(), planStartDate.getMonth(), 1);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  const periods: { key: string; label: string }[] = [];
  const cur = new Date(rangeStart);
  while (cur < rangeEnd) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
    const label = cur.toLocaleString("es", { month: "short", year: "numeric" });
    periods.push({ key, label });
    cur.setMonth(cur.getMonth() + 1);
  }

  return periods;
}
