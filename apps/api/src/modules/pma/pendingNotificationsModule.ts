import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPendingNotificationLog,
  pmaPeriodCompliance,
  pmaPlanItems,
  pmaPlans,
} from "../../db/schema/pma.js";
import { users } from "../../db/schema/shared.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { getMail } from "../../mail/index.js";
import { pendingActivitiesEmail } from "../../mail/templates.js";
import { canUserAccessPlan } from "./plansModule.js";
import {
  getPeriodBounds,
  getPeriodKey,
  getPeriodMonthKeys,
  getPlanCalendar,
  getPlanPeriods,
  monthKeyOf,
  monthLabelOf,
  type PlanCalendar,
} from "./planSchedule.js";
import type {
  PendingActivity,
  PendingActivityStatus,
  PendingNotificationsPayload,
  PendingNotificationsResult,
  PendingPeriodCount,
  PendingReporter,
} from "@pma/types";

type Actor = { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER"; email: string };

/**
 * A plan item's evidence state for one occurrence, strongest first. Only
 * `valid` clears an occurrence, so the other three are exactly the pending
 * statuses the dialog and the email show.
 */
const STATUS_PRIORITY = { valid: 3, invalid: 2, pending: 1 } as const;

const PENDING_LABEL: Record<"none" | "invalid" | "pending", PendingActivityStatus> = {
  none: "Sin entregar",
  invalid: "Rechazado",
  pending: "Pendiente de revisión",
};

/** Body/subject length caps. Long enough for a real message, short enough
 *  that a single email cannot be used to ship an arbitrary payload. */
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;

/**
 * Strip control characters that have no place in a header or a message body.
 * CR/LF in a subject is header injection; the body keeps its newlines because
 * the template renders them with `white-space:pre-wrap`.
 */
export function sanitizeSubject(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT_LENGTH);
}

export function sanitizeBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // Every control/format character except the newlines the template renders
    // with `white-space:pre-wrap`.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_BODY_LENGTH);
}

type PlanRow = typeof pmaPlans.$inferSelect;

async function loadPlanForActor(planId: string, actor: Actor): Promise<PlanRow> {
  const db = getDb();
  const [plan] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, planId)).limit(1);
  if (!plan) throw NotFound("El plan no existe");
  if (!(await canUserAccessPlan(planId, actor))) throw Forbidden();
  return plan;
}

type PendingOccurrence = {
  blockIndex: number;
  activity: PendingActivity;
  /** Users assigned to the item, who each owe this period's report. */
  assignees: string[];
};

/**
 * Every (item, reporting period) pair that has no row in
 * `pma_period_compliance` — the periods nobody has graded yet — restricted to
 * items that actually have a reporter to chase.
 *
 * The evidence attached to the period is still read, but only to fill the
 * status column of the email: it tells the reporter whether the gap is a
 * missing upload, a rejected one, or one still awaiting review. It no longer
 * decides who gets an email.
 *
 * Note on what this criterion means in practice: a period is normally ungraded
 * because it has not been evaluated yet, and the period in progress is included
 * deliberately, so a reporter can be notified about a period that has not
 * closed. That is the intended behaviour, not an oversight.
 */
async function collectPendingOccurrences(plan: PlanRow, calendar: PlanCalendar) {
  const db = getDb();
  const items = await db
    .select()
    .from(pmaPlanItems)
    .where(eq(pmaPlanItems.planId, plan.id));
  if (items.length === 0) {
    return {
      occurrences: [] as PendingOccurrence[],
      reporters: new Map<string, { name: string; email: string }>(),
    };
  }

  const itemIds = items.map((item) => item.id);
  const [assignmentRows, evidenceRows, complianceRows] = await Promise.all([
    db
      .select({
        planItemId: pmaItemAssignments.planItemId,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(pmaItemAssignments)
      .innerJoin(users, eq(users.id, pmaItemAssignments.userId))
      .where(inArray(pmaItemAssignments.planItemId, itemIds)),
    db
      .select({
        planItemId: pmaEvidences.planItemId,
        activityMonth: pmaEvidences.activityMonth,
        validationStatus: pmaEvidences.validationStatus,
      })
      .from(pmaEvidences)
      .where(eq(pmaEvidences.planId, plan.id)),
    db
      .select({
        planItemId: pmaPeriodCompliance.planItemId,
        periodKey: pmaPeriodCompliance.periodKey,
      })
      .from(pmaPeriodCompliance)
      .where(inArray(pmaPeriodCompliance.planItemId, itemIds)),
  ]);

  const reporters = new Map<string, { name: string; email: string }>();
  const assigneesByItem = new Map<string, string[]>();
  for (const row of assignmentRows) {
    reporters.set(row.userId, { name: row.name, email: row.email });
    const current = assigneesByItem.get(row.planItemId) ?? [];
    current.push(row.userId);
    assigneesByItem.set(row.planItemId, current);
  }

  // "itemId::periodKey" for every pair a técnico has already graded, whatever
  // the grade. Only the absence of a row matters here, not C/NC+/NC-/N/A.
  const graded = new Set(complianceRows.map((row) => `${row.planItemId}::${row.periodKey}`));

  // "itemId-YYYY-MM" -> strongest validation status attached to that month.
  const monthStatus = new Map<string, "valid" | "invalid" | "pending">();
  for (const row of evidenceRows) {
    if (!row.planItemId || !row.activityMonth) continue;
    const key = `${row.planItemId}-${row.activityMonth}`;
    const incoming = row.validationStatus ?? "pending";
    const current = monthStatus.get(key);
    if (!current || STATUS_PRIORITY[incoming] > STATUS_PRIORITY[current]) {
      monthStatus.set(key, incoming);
    }
  }

  const periods = getPlanPeriods(calendar);
  const occurrences: PendingOccurrence[] = [];
  for (const item of items) {
    const assignees = assigneesByItem.get(item.id) ?? [];
    // An item nobody reports on cannot be notified to anyone. It still shows as
    // ungraded in the Cronograma; this dialog only chases people.
    if (assignees.length === 0) continue;

    for (const { blockIndex, key } of periods) {
      if (graded.has(`${item.id}::${key}`)) continue;

      // Best evidence anywhere inside the period, for the status column only.
      let best: "none" | "valid" | "invalid" | "pending" = "none";
      for (const monthKey of getPeriodMonthKeys(calendar, blockIndex)) {
        const status = monthStatus.get(`${item.id}-${monthKey}`);
        if (status && (best === "none" || STATUS_PRIORITY[status] > STATUS_PRIORITY[best])) {
          best = status;
        }
      }

      const { endIndex } = getPeriodBounds(calendar, blockIndex);
      occurrences.push({
        blockIndex,
        assignees,
        activity: {
          planItemId: item.id,
          itemCode: item.item,
          medida: item.proposedMeasure,
          direccion: item.direccion ?? "—",
          periodicidad: item.periodicity,
          limitMonthKey: monthKeyOf(endIndex),
          limitMonth: monthLabelOf(endIndex),
          status: best === "valid" ? "Entregado, sin calificar" : PENDING_LABEL[best],
        },
      });
    }
  }

  return { occurrences, reporters };
}

function buildPeriodCounts(
  calendar: PlanCalendar,
  occurrences: PendingOccurrence[],
): (PendingPeriodCount & { blockIndex: number })[] {
  const counts = new Map<number, number>();
  for (const occurrence of occurrences) {
    counts.set(occurrence.blockIndex, (counts.get(occurrence.blockIndex) ?? 0) + 1);
  }
  return getPlanPeriods(calendar).map(({ blockIndex, key }) => ({
    blockIndex,
    key,
    label: key,
    pending: counts.get(blockIndex) ?? 0,
  }));
}

const ITEM_COLLATOR = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function groupByReporter(
  occurrences: PendingOccurrence[],
  blockIndex: number,
  reporters: Map<string, { name: string; email: string }>,
): PendingReporter[] {
  const byReporter = new Map<string, PendingActivity[]>();
  for (const occurrence of occurrences) {
    if (occurrence.blockIndex !== blockIndex) continue;
    for (const reporterId of occurrence.assignees) {
      const current = byReporter.get(reporterId) ?? [];
      current.push(occurrence.activity);
      byReporter.set(reporterId, current);
    }
  }

  const groups: PendingReporter[] = [];
  for (const [reporterId, activities] of byReporter) {
    const reporter = reporters.get(reporterId);
    if (!reporter) continue;
    activities.sort(
      (a, b) =>
        ITEM_COLLATOR.compare(a.itemCode, b.itemCode) ||
        a.limitMonthKey.localeCompare(b.limitMonthKey),
    );
    // A reporter can cover items from more than one direccion; the badge shows
    // all of them rather than picking one arbitrarily.
    const direcciones = [...new Set(activities.map((a) => a.direccion).filter((d) => d !== "—"))];
    groups.push({
      reporterId,
      name: reporter.name,
      email: reporter.email,
      direccion: direcciones.join(" / "),
      activities,
    });
  }
  groups.sort((a, b) => b.activities.length - a.activities.length || a.name.localeCompare(b.name, "es"));
  return groups;
}

/**
 * Pending activities of one reporting period, grouped by the reporter who owes
 * them, plus the per-period counters the dialog's chips show.
 *
 * `periodKey` may be omitted, in which case the period in progress is used.
 * An unknown key is rejected rather than silently answered with zero, so a
 * stale client cannot make a plan look compliant.
 */
export async function getPendingByReporter(
  planId: string,
  periodKey: string | undefined,
  actor: Actor,
): Promise<PendingNotificationsPayload> {
  const plan = await loadPlanForActor(planId, actor);
  const calendar = getPlanCalendar({
    startDate: plan.startDate,
    createdAt: plan.createdAt,
    reportPer: plan.reportPer,
  });
  const { occurrences, reporters } = await collectPendingOccurrences(plan, calendar);
  const periods = buildPeriodCounts(calendar, occurrences);

  const resolvedKey = periodKey ?? periods[periods.length - 1]?.key ?? getPeriodKey(calendar, 0);
  const period = periods.find((candidate) => candidate.key === resolvedKey);
  if (!period) throw BadRequest(`El periodo "${resolvedKey}" no existe en este plan`);

  return {
    planId: plan.id,
    planTitle: plan.title,
    periodKey: resolvedKey,
    periods: periods.map(({ key, label, pending }) => ({ key, label, pending })),
    reporters: groupByReporter(occurrences, period.blockIndex, reporters),
  };
}

export type SendPendingNotificationsInput = {
  planId: string;
  periodKey: string;
  reporterIds: string[];
  ccUserIds: string[];
  subject: string;
  body: string;
};

function planLink(planId: string): string {
  return `${env.FRONTEND_ORIGIN.replace(/\/+$/, "")}/pma/plans/${planId}`;
}

/**
 * Sends one email per selected reporter — `to` is that reporter alone, `cc` the
 * selected users. Never one message addressed to everybody: the recipients are
 * being chased about their own overdue work, and each table is theirs only.
 *
 * Delivery is sequential and a failure is contained to its recipient, so the
 * caller can report "se enviaron X de Y" instead of losing the whole batch to
 * one bad address. Every attempt is audited, delivered or not.
 *
 * This bypasses the `mail_outbox_jobs` queue on purpose. That outbox exists so
 * a business commit (creating a user, resetting a password) never waits on SMTP
 * or claims a delivery it cannot guarantee. Here the delivery *is* the
 * operation — there is no commit to protect, and the operator is waiting on the
 * per-recipient outcome the dialog reports back.
 */
export async function sendPendingNotifications(
  input: SendPendingNotificationsInput,
  actor: Actor,
): Promise<PendingNotificationsResult> {
  const subject = sanitizeSubject(input.subject);
  const body = sanitizeBody(input.body);
  if (!subject) throw BadRequest("El asunto no puede estar vacío");
  if (input.reporterIds.length === 0) throw BadRequest("Selecciona al menos un reportero");

  // Recompute from the database: the browser's idea of who is pending is a
  // rendering, never the authority for what gets emailed.
  const pending = await getPendingByReporter(input.planId, input.periodKey, actor);
  const requested = new Set(input.reporterIds);
  const targets = pending.reporters.filter((reporter) => requested.has(reporter.reporterId));
  const unknown = [...requested].filter(
    (id) => !pending.reporters.some((reporter) => reporter.reporterId === id),
  );
  if (unknown.length > 0) {
    throw BadRequest("Alguno de los reporteros seleccionados ya no tiene actividades pendientes en este periodo");
  }

  const db = getDb();
  const uniqueCcIds = [...new Set(input.ccUserIds)];
  const ccUsers = uniqueCcIds.length
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, uniqueCcIds))
    : [];
  if (ccUsers.length !== uniqueCcIds.length) {
    throw BadRequest("Alguno de los usuarios en copia no existe");
  }
  const ccEmails = ccUsers.map((user) => user.email);

  const link = planLink(pending.planId);
  const mail = getMail();
  const failures: PendingNotificationsResult["failures"] = [];
  let sent = 0;

  for (const reporter of targets) {
    const content = pendingActivitiesEmail({
      name: reporter.name,
      planTitle: pending.planTitle,
      periodKey: pending.periodKey,
      message: body,
      activities: reporter.activities,
      link,
    });

    let errorMessage: string | null = null;
    try {
      await mail.send({
        to: reporter.email,
        cc: ccEmails,
        // The operator's subject wins; the template's is only the default the
        // dialog pre-filled.
        subject,
        html: content.html,
        text: content.text,
      });
      sent += 1;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
      failures.push({
        reporterId: reporter.reporterId,
        name: reporter.name,
        email: reporter.email,
        message: errorMessage,
      });
    }

    // Audited outside any transaction and after the attempt: the row records
    // what SMTP actually did, so it must not be rolled back by a later failure.
    await db.insert(pmaPendingNotificationLog).values({
      planId: pending.planId,
      periodKey: pending.periodKey,
      reporterId: reporter.reporterId,
      reporterName: reporter.name,
      reporterEmail: reporter.email,
      ccEmails,
      subject,
      activityCount: reporter.activities.length,
      delivered: errorMessage === null,
      errorMessage,
      sentBy: actor.sub,
      sentByEmail: actor.email,
    });
  }

  return {
    ok: true,
    sent,
    total: targets.length,
    activities: targets.reduce((total, reporter) => total + reporter.activities.length, 0),
    ccCount: ccEmails.length,
    periodKey: pending.periodKey,
    failures,
  };
}
