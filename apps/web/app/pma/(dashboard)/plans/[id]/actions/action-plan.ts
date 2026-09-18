import { api } from "@/lib/api-client";
import type { PmaActionPlanPayload, PmaActionPlanResult } from "@/types";

/**
 * Data access for the "Plan de Acción" dialog.
 *
 * The flag and its history belong to the API (`modules/pma/actionPlanModule.ts`):
 * the toggle and the audit row it appends happen in one transaction over a
 * locked plan row, so the browser can neither skip the motivo nor decide who
 * the actor was. This module is the thin, typed seam between the dialog and
 * those endpoints.
 */

export type { PmaActionPlanPayload, PmaActionPlanResult };

/** Current flag plus every recorded transition, newest first. */
export function getActionPlan(planId: string): Promise<PmaActionPlanPayload> {
  return api.get<PmaActionPlanPayload>(`/pma/api/plans/${planId}/action-plan`);
}

export interface SetActionPlanInput {
  /** The state being requested; asking for the one the plan is in is a 409. */
  active: boolean;
  /** Required: the API rejects a blank motive, this is not a courtesy field. */
  reason: string;
}

/**
 * Flips the flag and appends the transition. A deactivation appends its own
 * row, so turning the Plan de Acción off never erases why it was turned on.
 */
export function setActionPlan(
  planId: string,
  input: SetActionPlanInput
): Promise<PmaActionPlanResult> {
  return api.post<PmaActionPlanResult>(
    `/pma/api/plans/${planId}/action-plan`,
    input
  );
}
