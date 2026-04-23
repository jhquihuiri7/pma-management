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
