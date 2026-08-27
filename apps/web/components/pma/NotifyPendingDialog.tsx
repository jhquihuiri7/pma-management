"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Send,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  getCcCandidates,
  getPendingByReporter,
  sendPendingNotifications,
  type PendingNotificationsPayload,
  type PendingNotificationsResult,
} from "@/app/pma/(dashboard)/plans/[id]/actions/notify-pending";
import type { PendingActivityStatus, PendingReporter, User } from "@/types";

interface NotifyPendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
}

/** The dialog's numbered section headers share one label style. */
function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
      {children}
    </p>
  );
}

const CHECK_ON = "bg-teal-700 text-white";
const CHECK_OFF = "border border-slate-300 bg-white text-transparent";
const CHECK_BASE =
  "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors";

function statusClasses(status: PendingActivityStatus): string {
  // Green means the reporter already did their part and only the grade is
  // missing — worth distinguishing, since chasing them would be unfair.
  if (status === "Entregado, sin calificar") return "text-emerald-700 bg-emerald-100";
  if (status === "Rechazado") return "text-red-700 bg-red-100";
  if (status === "Pendiente de revisión") return "text-amber-700 bg-amber-100";
  return "text-slate-600 bg-slate-200";
}

function defaultSubject(planTitle: string, periodKey: string): string {
  return `Actividades pendientes ${planTitle} — ${periodKey}`;
}

export function NotifyPendingDialog({
  open,
  onOpenChange,
  planId,
}: NotifyPendingDialogProps) {
  const [pending, setPending] = useState<PendingNotificationsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  /** Reporters the operator turned OFF; everyone pending is selected by default. */
  const [deselected, setDeselected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ccUsers, setCcUsers] = useState<User[]>([]);
  const [ccIds, setCcIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PendingNotificationsResult | null>(null);
  /** Guards against a slow response for a period the operator already left. */
  const requestRef = useRef(0);

  const load = useCallback(
    async (nextPeriodKey?: string) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        const data = await getPendingByReporter(planId, nextPeriodKey);
        if (requestRef.current !== requestId) return;
        setPending(data);
        setPeriodKey(data.periodKey);
        setDeselected({});
        setExpanded({});
        setSubject(defaultSubject(data.planTitle, data.periodKey));
        setLoadError(null);
      } catch (error) {
        if (requestRef.current !== requestId) return;
        setLoadError(apiErrorMessage(error, "No se pudieron cargar los pendientes"));
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    },
    [planId]
  );

  // Every open starts from the server's current view, never from stale state:
  // an evidence may have been approved since the dialog was last closed.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setBody("");
    setCcIds([]);
    load();
    getCcCandidates()
      .then((users) => setCcUsers(Array.isArray(users) ? users : []))
      .catch((error) =>
        toast.error(apiErrorMessage(error, "No se pudieron cargar los usuarios para copia"))
      );
  }, [open, load]);

  const reporters: PendingReporter[] = useMemo(
    () => pending?.reporters ?? [],
    [pending]
  );
  const selected = useMemo(
    () => reporters.filter((reporter) => !deselected[reporter.reporterId]),
    [reporters, deselected]
  );
  const activityCount = selected.reduce(
    (total, reporter) => total + reporter.activities.length,
    0
  );
  const allSelected = selected.length === reporters.length && reporters.length > 0;

  function toggleAll() {
    if (!allSelected) {
      setDeselected({});
      return;
    }
    setDeselected(
      Object.fromEntries(reporters.map((reporter) => [reporter.reporterId, true]))
    );
  }

  async function handleSend() {
    if (!pending || !periodKey || selected.length === 0) return;
    setSending(true);
    try {
      const sendResult = await sendPendingNotifications({
        planId,
        periodKey,
        reporterIds: selected.map((reporter) => reporter.reporterId),
        ccUserIds: ccIds,
        subject,
        body,
      });
      setResult(sendResult);
      if (sendResult.sent === sendResult.total) {
        toast.success(`Se enviaron ${sendResult.sent} correo(s)`);
      } else if (sendResult.sent > 0) {
        toast.warning(`Se enviaron ${sendResult.sent} de ${sendResult.total} correos`);
      } else {
        toast.error("No se pudo enviar ningún correo");
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron enviar los correos"));
    } finally {
      setSending(false);
    }
  }

  const summary =
    selected.length === 0
      ? "Selecciona al menos un reportero para enviar."
      : `${selected.length} reportero(s) · ${activityCount} actividades pendientes · ${ccIds.length} en copia`;

  const canSend = selected.length > 0 && !sending && subject.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[1000px] max-h-[calc(100%-3.5rem)] max-w-[calc(100%-3.5rem)] flex-col gap-0 overflow-hidden rounded-[18px] p-0 sm:max-w-[1000px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-[18px]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-teal-700">
              Notificar pendientes
            </p>
            <p className="mt-1 text-[17px] font-semibold leading-[1.3] text-slate-900">
              Enviar resumen de actividades pendientes a los reporteros
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        {result ? (
          <SentState
            result={result}
            periodKey={periodKey ?? ""}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_360px] md:overflow-hidden">
              <div className="min-w-0 border-b border-slate-100 px-6 py-5 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
                <StepLabel>1 · Periodo del cronograma</StepLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(pending?.periods ?? []).map((period) => {
                    const active = period.key === periodKey;
                    return (
                      <button
                        key={period.key}
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          if (period.key === periodKey) return;
                          setPeriodKey(period.key);
                          load(period.key);
                        }}
                        className={cn(
                          "inline-flex min-h-8 items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-3 pr-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-60",
                          active
                            ? "border border-teal-700 bg-teal-700 text-white"
                            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        {period.label}
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                            active
                              ? "bg-white/25 text-white"
                              : period.pending
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-400"
                          )}
                        >
                          {period.pending}
                        </span>
                      </button>
                    );
                  })}
                  {!pending && loading && (
                    <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="size-3.5 animate-spin" />
                      Cargando periodos…
                    </span>
                  )}
                </div>
                <p className="mt-2.5 text-xs text-slate-400">
                  El número indica las actividades sin calificación de cumplimiento en ese
                  periodo de reporte.
                </p>

                <div className="my-5 h-px bg-slate-100" />

                <div className="mb-3 flex items-center justify-between gap-4">
                  <StepLabel>2 · Pendientes por reportero</StepLabel>
                  <button
                    type="button"
                    onClick={toggleAll}
                    disabled={reporters.length === 0}
                    className="h-7 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:opacity-50"
                  >
                    {allSelected ? "Quitar todos" : "Seleccionar todos"}
                  </button>
                </div>

                {loadError ? (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
                    <AlertTriangle className="mt-px size-4 shrink-0 text-red-600" />
                    <p className="text-[12.5px] text-red-700">{loadError}</p>
                  </div>
                ) : loading ? (
                  <div className="flex items-center gap-2 py-8 text-[12.5px] text-slate-400">
                    <Loader2 className="size-4 animate-spin" />
                    Calculando pendientes…
                  </div>
                ) : reporters.length === 0 ? (
                  <p className="py-8 text-center text-[12.5px] text-slate-400">
                    No hay actividades sin calificar con reportero asignado en este periodo.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {reporters.map((reporter) => {
                      const on = !deselected[reporter.reporterId];
                      const isExpanded = !!expanded[reporter.reporterId];
                      return (
                        <div
                          key={reporter.reporterId}
                          className={cn(
                            "overflow-hidden rounded-xl border",
                            on ? "border-teal-200 bg-white" : "border-slate-200 bg-slate-50"
                          )}
                        >
                          <div className="flex items-center gap-3 px-3.5 py-3">
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-label={
                                on
                                  ? `Quitar a ${reporter.name}`
                                  : `Incluir a ${reporter.name}`
                              }
                              onClick={() =>
                                setDeselected((prev) => ({
                                  ...prev,
                                  [reporter.reporterId]: !prev[reporter.reporterId],
                                }))
                              }
                              className={cn(CHECK_BASE, on ? CHECK_ON : CHECK_OFF)}
                            >
                              <Check className="size-3 stroke-[3]" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-[13.5px] font-semibold text-slate-900">
                                  {reporter.name}
                                </p>
                                {reporter.direccion && (
                                  <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] text-teal-700">
                                    {reporter.direccion}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-400">
                                {reporter.email}
                              </p>
                            </div>
                            <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-[3px] text-xs font-semibold text-amber-700">
                              {reporter.activities.length} pendientes
                            </span>
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={`Ver actividades de ${reporter.name}`}
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [reporter.reporterId]: !prev[reporter.reporterId],
                                }))
                              }
                              className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100"
                            >
                              <ChevronDown
                                className={cn(
                                  "size-3.5 transition-transform",
                                  isExpanded && "rotate-180"
                                )}
                              />
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-slate-50 px-3.5 pb-2.5 pt-1.5">
                              {reporter.activities.map((activity, index) => (
                                <div
                                  key={`${activity.planItemId}-${activity.limitMonthKey}`}
                                  className={cn(
                                    "flex items-start gap-2.5 py-[9px]",
                                    index < reporter.activities.length - 1 &&
                                      "border-b border-slate-200/70"
                                  )}
                                >
                                  <span className="min-w-[52px] pt-px text-[11.5px] font-bold text-teal-700">
                                    {activity.itemCode}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[12.5px] leading-[1.4] text-slate-700 text-pretty">
                                      {activity.medida}
                                    </p>
                                    <p className="mt-[3px] text-[11.5px] text-slate-400">
                                      {activity.periodicidad} · límite {activity.limitMonth}
                                    </p>
                                  </div>
                                  <span
                                    className={cn(
                                      "shrink-0 whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.5px] font-semibold",
                                      statusClasses(activity.status)
                                    )}
                                  >
                                    {activity.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-[18px] bg-[#fbfdfd] px-6 py-5 md:min-h-0 md:overflow-y-auto">
                <div>
                  <StepLabel>3 · Copia (CC)</StepLabel>
                  {ccIds.length > 0 && (
                    <div className="mb-2 mt-2 flex flex-wrap gap-1.5">
                      {ccIds.map((ccId) => {
                        const user = ccUsers.find((candidate) => candidate.id === ccId);
                        if (!user) return null;
                        return (
                          <span
                            key={ccId}
                            className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 py-1 pl-2.5 pr-1.5 text-xs font-medium text-teal-700"
                          >
                            {user.name}
                            <button
                              type="button"
                              aria-label={`Quitar ${user.name} de la copia`}
                              onClick={() =>
                                setCcIds((prev) => prev.filter((id) => id !== ccId))
                              }
                              className="flex size-4 items-center justify-center rounded-full bg-teal-700/15 text-teal-700"
                            >
                              <X className="size-2.5 stroke-[3]" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-h-[168px] overflow-y-auto overflow-x-hidden rounded-[10px] border border-slate-200 bg-white",
                      ccIds.length === 0 && "mt-2"
                    )}
                  >
                    {ccUsers.length === 0 ? (
                      <p className="px-[11px] py-3 text-[11.5px] text-slate-400">
                        No hay usuarios disponibles para copia.
                      </p>
                    ) : (
                      ccUsers.map((user, index) => {
                        const on = ccIds.includes(user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setCcIds((prev) =>
                                on ? prev.filter((id) => id !== user.id) : [...prev, user.id]
                              )
                            }
                            className={cn(
                              "flex w-full items-center gap-2.5 px-[11px] py-[9px] text-left transition-colors",
                              index < ccUsers.length - 1 && "border-b border-slate-100",
                              on ? "bg-teal-50" : "bg-white hover:bg-slate-50"
                            )}
                          >
                            <span className={cn(CHECK_BASE, on ? CHECK_ON : CHECK_OFF)}>
                              <Check className="size-[11px] stroke-[3]" />
                            </span>
                            <span className="min-w-0 flex-1 overflow-hidden">
                              <span className="block truncate text-[12.5px] font-medium text-slate-900">
                                {user.name}
                              </span>
                              <span className="block truncate text-[11.5px] text-slate-400">
                                {user.email}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  <StepLabel>4 · Mensaje del correo</StepLabel>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    maxLength={200}
                    aria-label="Asunto del correo"
                    className="mb-2 mt-2 h-[34px] w-full rounded-[9px] border border-slate-200 bg-white px-[11px] text-[12.5px] text-slate-700 outline-none focus-visible:border-teal-600"
                  />
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={5000}
                    aria-label="Mensaje del correo"
                    placeholder="Escribe el mensaje que acompañará el resumen…"
                    className="min-h-[120px] w-full flex-1 resize-y rounded-[9px] border border-slate-200 bg-white px-[11px] py-2.5 text-[12.5px] leading-[1.5] text-slate-700 outline-none focus-visible:border-teal-600"
                  />
                  <div className="mt-2.5 rounded-[10px] border border-dashed border-teal-200 bg-teal-50 px-3 py-2.5">
                    <p className="text-[11.5px] font-semibold text-teal-700">
                      Se adjunta automáticamente
                    </p>
                    <p className="mt-[3px] text-[11.5px] leading-[1.5] text-teal-700">
                      Tabla con ítem, medida propuesta, dirección, periodicidad y mes límite
                      de cada actividad sin calificar del reportero, más el enlace al plan.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <p className="text-[12.5px] text-slate-500">{summary}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={sending}
                  className="h-9 rounded-[9px] border border-slate-200 bg-white px-3.5 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-[9px] px-4 text-[13.5px] font-semibold transition-colors",
                    canSend
                      ? "bg-teal-700 text-white hover:bg-teal-800"
                      : "cursor-not-allowed bg-slate-200 text-slate-400"
                  )}
                >
                  {sending ? (
                    <Loader2 className="size-[15px] animate-spin" />
                  ) : (
                    <Send className="size-[15px]" />
                  )}
                  {sending
                    ? "Enviando…"
                    : selected.length
                      ? `Enviar ${selected.length} correos`
                      : "Enviar correos"}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmation state. The happy path reads exactly as the design specifies;
 * a partial batch says how many landed and names who did not, because the
 * operator has to follow those up by hand.
 */
function SentState({
  result,
  periodKey,
  onClose,
}: {
  result: PendingNotificationsResult;
  periodKey: string;
  onClose: () => void;
}) {
  const allSent = result.sent === result.total;
  const noneSent = result.sent === 0;
  const title = allSent
    ? "Correos enviados"
    : noneSent
      ? "No se pudo enviar ningún correo"
      : `Se enviaron ${result.sent} de ${result.total} correos`;
  const detail = allSent
    ? `Se notificó a ${result.sent} reportero(s) con ${result.activities} actividades pendientes del periodo ${periodKey}. ${result.ccCount} persona(s) recibieron copia.`
    : `Del periodo ${periodKey} se notificó a ${result.sent} de ${result.total} reportero(s). Revisa los destinatarios fallidos y vuelve a intentarlo con ellos.`;

  return (
    <div className="flex flex-col items-center gap-3 px-6 pb-14 pt-[52px]">
      <div
        className={cn(
          "flex size-[54px] items-center justify-center rounded-full",
          noneSent ? "bg-red-100 text-red-700" : "bg-teal-100 text-teal-700"
        )}
      >
        {noneSent ? (
          <AlertTriangle className="size-[26px] stroke-[2.2]" />
        ) : (
          <Check className="size-[26px] stroke-[2.2]" />
        )}
      </div>
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="max-w-[460px] text-center text-[13px] leading-[1.6] text-slate-500">
        {detail}
      </p>
      {result.failures.length > 0 && (
        <div className="mt-1 w-full max-w-[560px] rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-red-700">
            No entregados
          </p>
          <ul className="mt-1.5 space-y-1">
            {result.failures.map((failure) => (
              <li key={failure.reporterId} className="text-[12px] leading-[1.5] text-red-700">
                <span className="font-medium">{failure.name}</span> ({failure.email}) —{" "}
                {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-2 h-9 rounded-[9px] bg-teal-700 px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-teal-800"
      >
        Cerrar
      </button>
    </div>
  );
}
