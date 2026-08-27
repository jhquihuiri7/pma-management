import { api } from "@/lib/api-client";
import type {
  PendingNotificationsPayload,
  PendingNotificationsResult,
  User,
} from "@/types";

/**
 * Data access for the "Notificar pendientes" dialog.
 *
 * The pending set and the emails are computed by the API
 * (`modules/pma/pendingNotificationsModule.ts`), not here: the browser must not
 * be the authority for who owes what, and this app has no database or mail
 * transport of its own — every mutation in `apps/web` goes through
 * `lib/api-client`. This module is the thin, typed seam between the dialog and
 * those endpoints.
 */

export type { PendingNotificationsPayload, PendingNotificationsResult };

/**
 * Pending activities of `periodKey`, grouped by the reporter who owes them,
 * plus the per-period counters the chips show. Omit `periodKey` to get the
 * reporting period in progress.
 */
export function getPendingByReporter(
  planId: string,
  periodKey?: string
): Promise<PendingNotificationsPayload> {
  const query = periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : "";
  return api.get<PendingNotificationsPayload>(
    `/pma/plans/${planId}/pending-notifications${query}`
  );
}

export interface SendPendingNotificationsInput {
  planId: string;
  periodKey: string;
  reporterIds: string[];
  ccUserIds: string[];
  subject: string;
  body: string;
}

/**
 * One email per reporter, sequentially, `cc` to the selected users. Resolves
 * with the per-recipient outcome even when some deliveries failed — the caller
 * reports "se enviaron X de Y" rather than treating a partial batch as an error.
 *
 * The default 30 s client timeout is not enough for a batch of SMTP round
 * trips, so this call gets its own budget.
 */
export function sendPendingNotifications(
  input: SendPendingNotificationsInput
): Promise<PendingNotificationsResult> {
  const { planId, ...body } = input;
  return api.post<PendingNotificationsResult>(
    `/pma/api/plans/${planId}/pending-notifications`,
    body,
    { timeoutMs: SEND_TIMEOUT_MS }
  );
}

/** ~4 s of SMTP budget per reporter, capped by the server's own limits. */
const SEND_TIMEOUT_MS = 180_000;

/** Everyone who can be put in copy: the plan-management user directory. */
export function getCcCandidates(): Promise<User[]> {
  return api.get<User[]>("/pma/users");
}
