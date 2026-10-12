"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PlanGrid, { planDesdeGrid, type PlanCelda } from "@/components/pg2030/PlanGrid";
import type { Pg2030MetaInstitucional } from "@/types";

/** Replan a goal's months. Closed months show their value but stay as they are. */
export default function PlanificacionDialog({
  meta,
  onClose,
  onSaved,
}: {
  meta: Pg2030MetaInstitucional | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [celdas, setCeldas] = useState<PlanCelda[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!meta) return;
    setCeldas(meta.meses.map((m) => ({ fisico: String(m.fisicoPlanificado), presupuesto: String(m.presupuestoPlanificado) })));
  }, [meta]);

  async function save() {
    if (!meta) return;
    const planificacion = planDesdeGrid(celdas);
    if (typeof planificacion === "string") {
      toast.error(planificacion);
      return;
    }
    setSaving(true);
    try {
      requirePersistedEntity(
        await api.put<unknown>(`/pg2030/metas/${meta.id}/planificacion`, { planificacion }),
        "El servidor no confirmó la planificación",
      );
      toast.success("Planificación guardada");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la planificación"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={meta !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        {meta && celdas.length === 12 && (
          <>
            <DialogHeader>
              <DialogTitle>Planificación mensual</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {meta.proyecto.codigo} · {meta.nombre}. Valores del mes, no acumulados; los meses con candado ya cerraron.
              </p>
            </DialogHeader>
            <PlanGrid celdas={celdas} bloqueados={meta.meses.map((m) => !m.puedePlanificar)} unidad={meta.unidadMedida}
              onChange={(i, campo, value) => setCeldas((c) => c.map((x, j) => (j === i ? { ...x, [campo]: value } : x)))} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
              <Button disabled={saving} onClick={save}>{saving ? "Guardando..." : "Guardar planificación"}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
