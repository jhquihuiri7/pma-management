"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Loader2, X } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  getActionPlan,
  type PmaActionPlanPayload,
  type SetActionPlanInput,
} from "@/app/pma/(dashboard)/plans/[id]/actions/action-plan";

interface ActionPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  /** The flag as the plan row last served it; the dialog only reads it to name
   *  the transition it is about to make. */
  active: boolean;
  /**
   * Runs the toggle through the detail page's single-flight mutation helper,
   * which also refreshes the plan. It resolves false when the call failed or
   * was dropped because another mutation was already in flight — in both cases
   * it has already told the operator, so this dialog stays put.
   */
  onConfirm: (input: SetActionPlanInput) => Promise<boolean>;
}

/** Mirrors the `reason` limit the API validates. */
const MAX_REASON = 1000;

export function ActionPlanDialog({
  open,
  onOpenChange,
  planId,
  active,
  onConfirm,
}: ActionPlanDialogProps) {
  const [payload, setPayload] = useState<PmaActionPlanPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Guards against a response for a dialog the operator has already closed. */
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const data = await getActionPlan(planId);
      if (requestRef.current !== requestId) return;
      setPayload(data);
      setLoadError(null);
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setLoadError(apiErrorMessage(error, "No se pudo cargar el historial del Plan de Acción"));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [planId]);

  // Every open starts from the server's current view: another administrator may
  // have toggled the plan since this dialog was last closed.
  useEffect(() => {
    if (!open) return;
    setMotivo("");
    load();
  }, [open, load]);

  // The history read is the fresher of the two sources, so a toggle made
  // elsewhere is reflected before the operator confirms the opposite one.
  const currentActive = payload?.active ?? active;
  const reason = motivo.trim();
  const canConfirm = reason.length > 0 && !submitting;

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      const confirmed = await onConfirm({ active: !currentActive, reason });
      if (!confirmed) return;
      // Clearing the motivo also re-disables the button, which is what keeps
      // the flipped transition from being fired again by a stray second click.
      setMotivo("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const activations = payload?.activations ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[820px] max-h-[calc(100%-3.5rem)] max-w-[calc(100%-3.5rem)] flex-col gap-0 overflow-hidden rounded-[18px] p-0 sm:max-w-[820px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-[18px]">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-teal-700">
              Plan de Acción
            </p>
            <p className="mt-1 text-[17px] font-semibold leading-[1.3] text-slate-900">
              {currentActive ? "Desactivar el Plan de Acción" : "Activar el Plan de Acción"}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-3 rounded-[10px] border border-dashed border-teal-200 bg-teal-50 px-3 py-2.5">
            <ClipboardList className="mt-px size-4 shrink-0 text-teal-700" />
            <p className="text-[12.5px] leading-[1.5] text-teal-700">
              {currentActive
                ? "El plan dejará de estar marcado con Plan de Acción activo. La desactivación queda registrada en el historial con tu nombre, la fecha y el motivo."
                : "El plan quedará marcado con Plan de Acción activo. La activación queda registrada en el historial con tu nombre, la fecha y el motivo."}
            </p>
          </div>

          <label
            htmlFor="action-plan-motivo"
            className="mt-5 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500"
          >
            Motivo (obligatorio)
          </label>
          <textarea
            id="action-plan-motivo"
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            maxLength={MAX_REASON}
            placeholder={
              currentActive
                ? "Explica por qué se desactiva el Plan de Acción…"
                : "Explica por qué se activa el Plan de Acción…"
            }
            className="mt-2 min-h-[96px] w-full resize-y rounded-[9px] border border-slate-200 bg-white px-[11px] py-2.5 text-[12.5px] leading-[1.5] text-slate-700 outline-none focus-visible:border-teal-600"
          />
          <p className="mt-1.5 text-[11px] leading-[1.5] text-slate-400">
            Queda en el historial de forma permanente · máximo {MAX_REASON} caracteres
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-9 rounded-[9px] border border-slate-200 bg-white px-3.5 text-[13.5px] font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-[9px] px-4 text-[13.5px] font-semibold transition-colors",
                canConfirm
                  ? "bg-teal-700 text-white hover:bg-teal-800"
                  : "cursor-not-allowed bg-slate-200 text-slate-400"
              )}
            >
              {submitting && <Loader2 className="size-[15px] animate-spin" />}
              {submitting
                ? "Guardando…"
                : currentActive
                  ? "Desactivar Plan de Acción"
                  : "Activar Plan de Acción"}
            </button>
          </div>

          <div className="mt-6 border-t border-slate-200 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
              Historial ({activations.length})
            </p>
            {loadError ? (
              <p className="py-6 text-center text-[12.5px] text-red-600">{loadError}</p>
            ) : loading && !payload ? (
              <p className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-slate-400">
                <Loader2 className="size-3.5 animate-spin" />
                Cargando historial…
              </p>
            ) : activations.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-slate-500">
                Sin activaciones registradas aún.
              </p>
            ) : (
              <div className="mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[116px]">Transición</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="w-[180px]">Usuario</TableHead>
                      <TableHead className="w-[160px]">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activations.map((activation) => (
                      <TableRow key={activation.id}>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              activation.active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-200 text-slate-600"
                            )}
                          >
                            {activation.active ? "Activado" : "Desactivado"}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[320px] whitespace-pre-wrap break-words">
                          {activation.reason}
                        </TableCell>
                        <TableCell>{activation.actorName}</TableCell>
                        <TableCell>
                          {new Date(activation.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
