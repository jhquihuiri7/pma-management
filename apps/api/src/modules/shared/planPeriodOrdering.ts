export type PlanPeriodEntry = {
  planItemId: string;
  periodKey: string;
};

/**
 * Canonical database mutation order for batches that can lock/upsert more than
 * one plan-period row. Every caller must use the same order so two overlapping
 * batches cannot acquire the same row locks in opposite directions.
 */
export function comparePlanPeriodEntries(a: PlanPeriodEntry, b: PlanPeriodEntry): number {
  if (a.planItemId < b.planItemId) return -1;
  if (a.planItemId > b.planItemId) return 1;
  if (a.periodKey < b.periodKey) return -1;
  if (a.periodKey > b.periodKey) return 1;
  return 0;
}
