import type { RgdpWastePlanItemInput } from "@pma/types";
import type { RgdpPlanItemCreateInput } from "./planItemsModule.js";

export type PlanReportPeriod = "6 meses" | "1 año" | "2 años";

export function toCanonicalRgdpPlanItemInput(
  input: RgdpWastePlanItemInput,
  reportPer: PlanReportPeriod
): RgdpPlanItemCreateInput {
  const wasteCode = input.wasteCode.trim();
  const wasteName = input.wasteName.trim();
  const wasteDescription = (input.wasteDescription ?? "").trim();
  const crtib = input.crtib.trim();
  const generationOrigin = input.generationOrigin.trim();
  const description = wasteDescription || "-";

  return {
    item: `${wasteCode} - ${wasteName}`,
    subplan: "RGDT",
    direccion: generationOrigin,
    environmental_activity: wasteName,
    identified_environmental_impact: description,
    proposed_measure: description,
    indicator: crtib,
    verification_method: generationOrigin,
    periodicity: "Mensual",
    budget: 0,
    report_per: reportPer,
    observation: input.observation?.trim() || undefined,
    wasteCode,
    wasteName,
    wasteDescription,
    crtib,
    annualGenerationKg: input.annualGenerationKg,
    generationOrigin,
    selfManagement: input.selfManagement,
  };
}
