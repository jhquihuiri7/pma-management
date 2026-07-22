import type { ItemAssignment, MonthlyGeneration, Plan, PlanItem } from "@pma/types";
import type { rgdpMonthlyGenerations, rgdpPlanItems, rgdpPlans } from "../../db/schema/rgdp.js";

type PlanRow = typeof rgdpPlans.$inferSelect;
type PlanItemRow = typeof rgdpPlanItems.$inferSelect;
type MonthlyGenerationRow = typeof rgdpMonthlyGenerations.$inferSelect;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : value;
}

function numeric(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric database value: ${value}`);
  return parsed;
}

/** The sole public JSON representation for an RGDP plan. */
export function toRgdpPlanApi(row: PlanRow): Plan {
  return {
    id: row.id,
    createdBy: row.createdBy,
    adminId: row.createdBy ?? "",
    title: row.title,
    description: row.description,
    tipo: row.tipo ?? undefined,
    fase: row.fase ?? undefined,
    enfoque: row.enfoque ?? undefined,
    report_per: row.reportPer,
    start_date: toDateOnly(row.startDate),
    visualization_url: row.visualizationUrl,
    storagePath: row.storagePath,
    location: row.location as Plan["location"],
    ciiu: row.ciiu as Plan["ciiu"],
    zoneType: row.zoneType ?? undefined,
    coordinateFormat: row.coordinateFormat ?? undefined,
    geographicArea: row.geographicArea as Plan["geographicArea"],
    implantationArea: row.implantationArea as Plan["implantationArea"],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Normalizes Drizzle camelCase and PostgreSQL numeric strings for the web DTO. */
export function toRgdpPlanItemApi(
  row: PlanItemRow,
  assignedUsers: ItemAssignment[] = []
): PlanItem {
  return {
    id: row.id,
    planId: row.planId,
    item: row.item,
    subplan: row.subplan,
    direccion: row.direccion ?? undefined,
    environmental_activity: row.environmentalActivity,
    identified_environmental_impact: row.identifiedEnvironmentalImpact,
    proposed_measure: row.proposedMeasure,
    indicator: row.indicator,
    verification_method: row.verificationMethod,
    periodicity: row.periodicity,
    budget: numeric(row.budget),
    report_per: row.reportPer,
    observation: row.observation ?? undefined,
    wasteCode: row.wasteCode ?? undefined,
    wasteName: row.wasteName ?? undefined,
    wasteDescription: row.wasteDescription ?? undefined,
    crtib: row.crtib ?? undefined,
    annualGenerationKg:
      row.annualGenerationKg == null ? undefined : numeric(row.annualGenerationKg),
    generationOrigin: row.generationOrigin ?? undefined,
    selfManagement: row.selfManagement,
    assignedUsers,
    createdAt: toIso(row.createdAt),
  };
}

export function toMonthlyGenerationApi(
  row: Pick<MonthlyGenerationRow, "planItemId" | "periodKey" | "generationKg" | "updatedAt">,
  planId: string
): MonthlyGeneration {
  return {
    id: `${row.planItemId}:${row.periodKey}`,
    planId,
    planItemId: row.planItemId,
    periodKey: row.periodKey,
    generationKg: numeric(row.generationKg),
    updatedAt: toIso(row.updatedAt),
  };
}
