"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { MESES_LARGOS, formatNumero, formatUsd, pareceAcumulado, parseDecimal } from "@/lib/pg2030";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Pg2030MetaInstitucional, Pg2030ReporteResultado } from "@/types";

const fieldClass = "flex min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * Report one month (plan §6), or read it when the caller cannot change it.
 * Values are the month's own; saving marks the month reported even with 0.
 */
export default function EjecucionDialog({
  meta,
  mes,
  onClose,
  onSaved,
}: {
  meta: Pg2030MetaInstitucional | null;
  mes: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [fisico, setFisico] = useState("");
  const [devengado, setDevengado] = useState("");
  const [hitos, setHitos] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);

  const datos = meta && mes ? meta.meses[mes - 1] : null;

  useEffect(() => {
    if (!datos) return;
    setFisico(datos.fisicoEjecutado === null ? "" : String(datos.fisicoEjecutado));
    setDevengado(datos.presupuestoDevengado === null ? "" : String(datos.presupuestoDevengado));
    setHitos(datos.hitosAlcanzados ?? "");
    setObservaciones(datos.observaciones ?? "");
  }, [datos]);

  const fisicoNum = parseDecimal(fisico);
  const aviso = datos && fisicoNum !== null && pareceAcumulado(datos.fisicoPlanificado, fisicoNum);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!meta || !mes) return;
    const devengadoNum = parseDecimal(devengado);
    if (fisicoNum === null || devengadoNum === null) {
      toast.error("Escribe números mayores o iguales a 0");
      return;
    }
    setSaving(true);
    try {
      const result = await api.put<Pg2030ReporteResultado>(`/pg2030/metas/${meta.id}/meses/${mes}/ejecucion`, {
        fisicoEjecutado: fisicoNum,
        presupuestoDevengado: devengadoNum,
        hitosAlcanzados: hitos,
        observaciones,
      });
      if (!result?.meta?.id) throw new Error("El servidor no confirmó el reporte");
      toast.success(`Reporte de ${MESES_LARGOS[mes - 1]} guardado`);
      if (result.avisoAcumulado) {
        toast.warning("El valor parece acumulado: revisa que sea solo lo ejecutado en el mes");
      }
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar el reporte"));
    } finally {
      setSaving(false);
    }
  }

  const editable = Boolean(datos?.puedeReportar);

  return (
    <Dialog open={meta !== null && mes !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {meta && mes && datos && (
          <>
            <DialogHeader>
              <DialogTitle>Reporte de {MESES_LARGOS[mes - 1]} de {meta.anio}</DialogTitle>
              <p className="text-xs text-muted-foreground">{meta.proyecto.codigo} · {meta.nombre}</p>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p>Físico planificado: <span className="font-semibold">{formatNumero(datos.fisicoPlanificado)} {meta.unidadMedida}</span></p>
              <p>Presupuesto planificado: <span className="font-semibold">{formatUsd(datos.presupuestoPlanificado)}</span></p>
            </div>
            {!editable && (
              <p className="text-xs text-slate-500">
                {datos.bloqueado
                  ? "Este mes ya cerró. Para corregirlo, el administrador tiene que reabrir el corte."
                  : "No puedes reportar este mes."}
              </p>
            )}
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="ej-fisico">Físico ejecutado ({meta.unidadMedida})</Label>
                  <Input id="ej-fisico" inputMode="decimal" disabled={!editable} value={fisico} placeholder="0"
                    onChange={(e) => setFisico(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ej-devengado">Presupuesto devengado (USD)</Label>
                  <Input id="ej-devengado" inputMode="decimal" disabled={!editable} value={devengado} placeholder="0"
                    onChange={(e) => setDevengado(e.target.value)} />
                </div>
              </div>
              {aviso && editable && (
                <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ¿Estás reportando acumulado? Reporta solo lo ejecutado en el mes. Puedes guardar igual si es correcto.
                </p>
              )}
              <div className="space-y-1">
                <Label htmlFor="ej-hitos">Hitos alcanzados</Label>
                <textarea id="ej-hitos" className={fieldClass} disabled={!editable} value={hitos}
                  onChange={(e) => setHitos(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ej-observaciones">Observaciones</Label>
                <textarea id="ej-observaciones" className={fieldClass} disabled={!editable} value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)} />
              </div>
              {datos.reportadoAt && (
                <p className="text-xs text-slate-500">
                  Reportado por {datos.reportadoPorNombre ?? "—"} el {new Date(datos.reportadoAt).toLocaleString("es-EC")}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
                  {editable ? "Cancelar" : "Cerrar"}
                </Button>
                {editable && <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar reporte"}</Button>}
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
