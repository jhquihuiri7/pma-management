import { Plan } from "@/types";

function getBlockSize(report_per: string): number {
  const s = (report_per ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
}

/**
 * Returns all available reporting periods for a plan, using the same
 * key format ("ene-jun 2025") as the cronograma compliance columns.
 * The last entry is always the current in-progress or most recently
 * completed period.
 */
export function getPlanPeriods(plan: Plan): { key: string; label: string }[] {
  const blockSize = getBlockSize(plan.report_per);
  const startYear = new Date(plan.start_date || plan.createdAt).getFullYear();
  const blockOrigin = new Date(startYear, 0, 1);

  const today = new Date();
  const planStart = new Date(plan.start_date || plan.createdAt);
  const rangeStart = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  const months: Date[] = [];
  const cur = new Date(rangeStart);
  while (cur < rangeEnd) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

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
    const diff = diffFromOrigin(
      new Date(blockEndMonth.getFullYear(), blockEndMonth.getMonth(), 1)
    );
    const blockIndex = Math.floor(diff / blockSize);
    const blockStart = new Date(
      blockOrigin.getFullYear(),
      blockOrigin.getMonth() + blockIndex * blockSize,
      1
    );
    const startLbl = blockStart.toLocaleString("es", { month: "short" });
    const endLbl = blockEndMonth.toLocaleString("es", { month: "short" });
    if (blockStart.getFullYear() !== blockEndMonth.getFullYear()) {
      return `${startLbl} ${blockStart.getFullYear()}-${endLbl} ${blockEndMonth.getFullYear()}`;
    }
    return `${startLbl}-${endLbl} ${blockEndMonth.getFullYear()}`;
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

  // If the last month is not a true block-end, add the in-progress period
  const lastMonth = months[months.length - 1];
  if (lastMonth && !isBlockEnd(lastMonth)) {
    const lbl = getPeriodLabel(lastMonth);
    if (!periods.some((p) => p.key === lbl)) {
      periods.push({ key: lbl, label: lbl });
    }
  }

  return periods;
}
