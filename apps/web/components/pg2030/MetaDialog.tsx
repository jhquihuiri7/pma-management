"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PlanGrid, { planDesdeGrid, planVacio, type PlanCelda } from "@/components/pg2030/PlanGrid";
import {
  PG2030_FUENTE_FINANCIAMIENTO_VALUES,
  type Pg2030FuenteFinanciamiento,
  type Pg2030MetaInstitucional,
} from "@/types";

export type ProyectoOpcion = { id: string; codigo: string; nombre: string; metaPlanCodigo: string };

export type MetaDialogModo =
  | { tipo: "crear"; anio: number; institucionId: string; bloqueados: boolean[] }
  | { tipo: "editar"; meta: Pg2030MetaInstitucional };

type Campos = {
  proyectoId: string;
  nombre: string;
  indicador: string;
  descripcion: string;
  unidadMedida: string;
  metaAnual: string;
  presupuestoAnual: string;
  fuenteFinanciamiento: "" | Pg2030FuenteFinanciamiento;
  beneficiariosDirectos: string;
  personalTecnico: string;
  responsablesInternos: string;
  entidadesCoordinacion: string;
  observaciones: string;
};

const vacio: Campos = {
  proyectoId: "",
  nombre: "",
  indicador: "",
  descripcion: "",
  unidadMedida: "",
  metaAnual: "0",
  presupuestoAnual: "0",
  fuenteFinanciamiento: "",
  beneficiariosDirectos: "",
  personalTecnico: "",
  responsablesInternos: "",
  entidadesCoordinacion: "",
  observaciones: "",
};

function desdeMeta(meta: Pg2030MetaInstitucional): Campos {
  return {
    proyectoId: meta.proyecto.id,
    nombre: meta.nombre,
    indicador: meta.indicador,
    descripcion: meta.descripcion ?? "",
    unidadMedida: meta.unidadMedida,
    metaAnual: String(meta.metaAnual),
    presupuestoAnual: String(meta.presupuestoAnual),
    fuenteFinanciamiento: meta.fuenteFinanciamiento ?? "",
    beneficiariosDirectos: meta.beneficiariosDirectos ?? "",
    personalTecnico: meta.personalTecnico ?? "",
    responsablesInternos: meta.responsablesInternos ?? "",
    entidadesCoordinacion: meta.entidadesCoordinacion ?? "",
    observaciones: meta.observaciones ?? "",
  };
}

const fieldClass = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function MetaDialog({
  modo,
  proyectos,
  onClose,
  onSaved,
}: {
  modo: MetaDialogModo | null;
  proyectos: ProyectoOpcion[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [campos, setCampos] = useState<Campos>(vacio);
  const [plan, setPlan] = useState<PlanCelda[]>(planVacio());
  const [filtro, setFiltro] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!modo) return;
    setCampos(modo.tipo === "editar" ? desdeMeta(modo.meta) : vacio);
    setPlan(planVacio());
    setFiltro("");
  }, [modo]);

  const opciones = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const list = q
      ? proyectos.filter((p) => `${p.codigo} ${p.nombre} ${p.metaPlanCodigo}`.toLowerCase().includes(q))
      : proyectos;
    // Keep the selected project visible even when the filter hides it.
    const selected = proyectos.find((p) => p.id === campos.proyectoId);
    return selected && !list.includes(selected) ? [selected, ...list] : list;
  }, [proyectos, filtro, campos.proyectoId]);

  const set = <K extends keyof Campos>(key: K, value: Campos[K]) => setCampos((c) => ({ ...c, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!modo) return;
    if (!campos.proyectoId) {
      toast.error("Elige el proyecto o acción del Plan");
      return;
    }
    const body: Record<string, unknown> = {
      nombre: campos.nombre,
      indicador: campos.indicador,
      descripcion: campos.descripcion,
      unidadMedida: campos.unidadMedida,
      metaAnual: Number(campos.metaAnual.replace(",", ".")),
      presupuestoAnual: Number(campos.presupuestoAnual.replace(",", ".")),
      fuenteFinanciamiento: campos.fuenteFinanciamiento || null,
      beneficiariosDirectos: campos.beneficiariosDirectos,
      personalTecnico: campos.personalTecnico,
      responsablesInternos: campos.responsablesInternos,
      entidadesCoordinacion: campos.entidadesCoordinacion,
      observaciones: campos.observaciones,
    };
    setSaving(true);
    try {
      if (modo.tipo === "crear") {
        const planificacion = planDesdeGrid(plan);
        if (typeof planificacion === "string") {
          toast.error(planificacion);
          return;
        }
        requirePersistedEntity(
          await api.post<unknown>("/pg2030/metas", {
            ...body,
            anio: modo.anio,
            institucionId: modo.institucionId,
            proyectoId: campos.proyectoId,
            planificacion,
          }),
          "El servidor no confirmó la creación de la meta",
        );
        toast.success("Meta creada");
      } else {
        // Send only what changed: moving a goal to another project has its own rules.
        const antes = desdeMeta(modo.meta);
        const patch = Object.fromEntries(
          Object.entries({ ...body, proyectoId: campos.proyectoId }).filter(
            ([k, v]) => (v ?? "") !== (antes[k as keyof Campos] ?? ""),
          ),
        );
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        requirePersistedEntity(
          await api.patch<unknown>(`/pg2030/metas/${modo.meta.id}`, patch),
          "El servidor no confirmó los cambios",
        );
        toast.success("Meta actualizada");
      }
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la meta"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={modo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100%-1rem)] max-h-[92vh] gap-0 overflow-hidden p-5 sm:w-[calc(100%-2rem)] sm:max-w-4xl sm:p-6">
        {modo && (
          <>
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>{modo.tipo === "crear" ? "Nueva meta institucional" : "Editar meta institucional"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="mt-4 min-h-0 max-h-[calc(92vh-7rem)] space-y-4 overflow-y-auto overflow-x-hidden pr-2">
              <div className="space-y-2">
                <Label htmlFor="meta-proyecto">Proyecto o acción del Plan</Label>
                <Input placeholder="Filtrar por código, nombre o meta del Plan…" value={filtro}
                  onChange={(e) => setFiltro(e.target.value)} />
                <select id="meta-proyecto" size={6} required className={`${fieldClass} h-36 cursor-pointer overflow-y-auto`}
                  value={campos.proyectoId}
                  onChange={(e) => {
                    const proyectoId = e.currentTarget.value;
                    setCampos((actual) => ({ ...actual, proyectoId }));
                  }}
                  onInput={(e) => {
                    const proyectoId = e.currentTarget.value;
                    setCampos((actual) => ({ ...actual, proyectoId }));
                  }}>
                  {opciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.metaPlanCodigo} — {p.nombre}
                    </option>
                  ))}
                </select>
                <p className="min-h-5 text-xs text-teal-700" aria-live="polite">
                  {campos.proyectoId
                    ? `Seleccionado: ${proyectos.find((p) => p.id === campos.proyectoId)?.codigo ?? "proyecto"}`
                    : "Haz clic en un proyecto o acción para seleccionarlo."}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="meta-nombre">Programa / proyecto / acción</Label>
                  <Input id="meta-nombre" required value={campos.nombre} onChange={(e) => set("nombre", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-indicador">Indicador</Label>
                  <Input id="meta-indicador" required value={campos.indicador} onChange={(e) => set("indicador", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-unidad">Unidad de medida</Label>
                  <Input id="meta-unidad" required placeholder="personas, talleres, %" value={campos.unidadMedida}
                    onChange={(e) => set("unidadMedida", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-descripcion">Descripción de la meta</Label>
                <textarea id="meta-descripcion" className={`${fieldClass} min-h-16`} value={campos.descripcion}
                  onChange={(e) => set("descripcion", e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="meta-anual">Meta anual</Label>
                  <Input id="meta-anual" required inputMode="decimal" value={campos.metaAnual} onChange={(e) => set("metaAnual", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-presupuesto-anual">Presupuesto anual</Label>
                  <Input id="meta-presupuesto-anual" required inputMode="decimal" value={campos.presupuestoAnual} onChange={(e) => set("presupuestoAnual", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-fuente">Fuente de financiamiento</Label>
                  <select id="meta-fuente" className={`${fieldClass} h-10`} value={campos.fuenteFinanciamiento}
                    onChange={(e) => set("fuenteFinanciamiento", e.target.value as Campos["fuenteFinanciamiento"])}>
                    <option value="">Sin presupuesto</option>
                    {PG2030_FUENTE_FINANCIAMIENTO_VALUES.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-beneficiarios">Beneficiarios directos</Label>
                  <Input id="meta-beneficiarios" value={campos.beneficiariosDirectos}
                    onChange={(e) => set("beneficiariosDirectos", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-personal">Personal técnico involucrado</Label>
                  <Input id="meta-personal" value={campos.personalTecnico}
                    onChange={(e) => set("personalTecnico", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-responsables">Responsables internos</Label>
                  <Input id="meta-responsables" value={campos.responsablesInternos}
                    onChange={(e) => set("responsablesInternos", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-coordinacion">Entidades en coordinación</Label>
                <Input id="meta-coordinacion" value={campos.entidadesCoordinacion}
                  onChange={(e) => set("entidadesCoordinacion", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="meta-observaciones">Observaciones</Label>
                <textarea id="meta-observaciones" className={`${fieldClass} min-h-16`} value={campos.observaciones}
                  onChange={(e) => set("observaciones", e.target.value)} />
              </div>

              {modo.tipo === "crear" && (
                <div className="space-y-2">
                  <Label>Planificación mensual</Label>
                  <p className="text-xs text-muted-foreground">
                    Valores del mes, no acumulados. La meta anual es la suma de los 12 meses.
                  </p>
                  <PlanGrid celdas={plan} bloqueados={modo.bloqueados} unidad={campos.unidadMedida}
                    onChange={(i, campo, value) => setPlan((p) => p.map((c, j) => (j === i ? { ...c, [campo]: value } : c)))} />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
