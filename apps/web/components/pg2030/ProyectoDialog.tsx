"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Pencil, TriangleAlert } from "lucide-react";
import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { PG2030_CAMPO_LABELS, formatUsd } from "@/lib/pg2030";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  PG2030_PRESUPUESTO_ESTADO_VALUES,
  PG2030_PROYECTO_TIPO_VALUES,
  type Pg2030Conflicto,
  type Pg2030MetaPlan,
  type Pg2030PresupuestoEstado,
  type Pg2030Proyecto,
  type Pg2030ProyectoTipo,
} from "@/types";

const fieldClass = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type Form = {
  nombre: string;
  tipo: Pg2030ProyectoTipo;
  plazo: string;
  presupuestoEstado: Pg2030PresupuestoEstado;
  presupuestoReferencial: string;
  tipoEntidadResponsable: string;
  responsablesPlan: string;
  entidadesEjecutoras: string;
  hito2023: string;
  hito2030: string;
};

function toForm(p: Pg2030Proyecto): Form {
  return {
    nombre: p.nombre,
    tipo: p.tipo,
    plazo: p.plazo ?? "",
    presupuestoEstado: p.presupuestoEstado,
    presupuestoReferencial: p.presupuestoReferencial === null ? "" : String(p.presupuestoReferencial),
    tipoEntidadResponsable: p.tipoEntidadResponsable ?? "",
    responsablesPlan: p.responsablesPlan ?? "",
    entidadesEjecutoras: p.entidadesEjecutoras ?? "",
    hito2023: p.hito2023 ?? "",
    hito2030: p.hito2030 ?? "",
  };
}

const TEXT_FIELDS = [
  "nombre",
  "plazo",
  "tipoEntidadResponsable",
  "responsablesPlan",
  "entidadesEjecutoras",
  "hito2023",
  "hito2030",
] as const;

/** Only the fields that changed, so a correction never rewrites the rest. */
function diff(original: Pg2030Proyecto, form: Form): Record<string, unknown> | string {
  const before = toForm(original);
  const patch: Record<string, unknown> = {};
  for (const key of TEXT_FIELDS) {
    if (form[key].trim() !== before[key].trim()) patch[key] = form[key];
  }
  if (form.tipo !== before.tipo) patch.tipo = form.tipo;
  if (form.presupuestoEstado === "Monto") {
    const monto = Number(form.presupuestoReferencial.replace(",", "."));
    if (!form.presupuestoReferencial.trim() || !Number.isFinite(monto) || monto <= 0) {
      return "Indica un monto mayor que 0";
    }
    if (form.presupuestoEstado !== before.presupuestoEstado || monto !== original.presupuestoReferencial) {
      patch.presupuestoEstado = "Monto";
      patch.presupuestoReferencial = monto;
    }
  } else if (form.presupuestoEstado !== before.presupuestoEstado) {
    patch.presupuestoEstado = form.presupuestoEstado;
  }
  return patch;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

function ConflictoItem({
  conflicto,
  isAdmin,
  onReviewed,
}: {
  conflicto: Pg2030Conflicto;
  isAdmin: boolean;
  onReviewed: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function marcar() {
    setPending(true);
    try {
      requirePersistedEntity(
        await api.post<unknown>(`/pg2030/catalogo/conflictos/${conflicto.id}/revisado`),
        "El servidor no confirmó la revisión",
      );
      toast.success("Conflicto marcado como revisado");
      await onReviewed();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo marcar el conflicto"));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className={`rounded-lg border p-3 ${conflicto.revisado ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{PG2030_CAMPO_LABELS[conflicto.campo] ?? conflicto.campo}</p>
        {conflicto.revisado ? (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Revisado{conflicto.revisadoPorNombre ? ` por ${conflicto.revisadoPorNombre}` : ""}
            {conflicto.revisadoAt ? ` el ${new Date(conflicto.revisadoAt).toLocaleDateString("es-EC")}` : ""}
          </span>
        ) : isAdmin ? (
          <Button size="xs" variant="outline" disabled={pending} onClick={marcar}>
            {pending ? "Guardando..." : "Marcar como revisado"}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-slate-500">Valor usado (primera fila del Excel)</p>
      <p className="text-sm text-slate-800">{conflicto.valorUsado || "—"}</p>
      <p className="mt-2 text-xs text-slate-500">Otros valores en el Excel</p>
      <ul className="list-disc pl-5 text-sm text-slate-700">
        {conflicto.valoresAlternativos.map((valor, i) => (
          <li key={i}>{valor || "—"}</li>
        ))}
      </ul>
    </li>
  );
}

export default function ProyectoDialog({
  proyecto,
  meta,
  isAdmin,
  onClose,
  onChanged,
}: {
  proyecto: Pg2030Proyecto | null;
  meta: Pg2030MetaPlan | null;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    setEditing(false);
    setForm(proyecto ? toForm(proyecto) : null);
  }, [proyecto]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!proyecto || !form) return;
    const patch = diff(proyecto, form);
    if (typeof patch === "string") {
      toast.error(patch);
      return;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      requirePersistedEntity(
        await api.patch<unknown>(`/pg2030/catalogo/proyectos/${proyecto.id}`, patch),
        "El servidor no confirmó la corrección",
      );
      toast.success(`${proyecto.codigo} corregido`);
      setEditing(false);
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la corrección"));
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <Dialog open={proyecto !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {proyecto && form && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
                <span className="font-mono text-teal-700">{proyecto.codigo}</span>
                <Badge variant="outline">{proyecto.tipo}</Badge>
              </DialogTitle>
              {meta && (
                <p className="text-xs text-slate-500">
                  Meta del Plan <span className="font-mono">{meta.codigo}</span>: {meta.texto}
                </p>
              )}
            </DialogHeader>

            {!editing ? (
              <div className="space-y-4">
                <p className="text-sm font-medium text-slate-900">{proyecto.nombre}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Plazo (Anexo 7)" value={proyecto.plazo} />
                  <Field
                    label="Presupuesto referencial"
                    value={
                      proyecto.presupuestoEstado === "Monto" && proyecto.presupuestoReferencial !== null
                        ? formatUsd(proyecto.presupuestoReferencial)
                        : proyecto.presupuestoEstado
                    }
                  />
                  <Field label="Tipo de entidad responsable" value={proyecto.tipoEntidadResponsable} />
                  <Field label="Entidades ejecutoras (actualización)" value={proyecto.entidadesEjecutoras} />
                  <Field label="Responsables según el plan" value={proyecto.responsablesPlan} />
                  <div />
                  <Field label="Hito 2023" value={proyecto.hito2023} />
                  <Field label="Hito 2030" value={proyecto.hito2030} />
                </div>
                {isAdmin && (
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Corregir datos
                  </Button>
                )}
              </div>
            ) : (
              <form onSubmit={save} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="pg-nombre">Nombre</Label>
                  <textarea id="pg-nombre" className={`${fieldClass} min-h-20`} required value={form.nombre}
                    onChange={(e) => set("nombre", e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="pg-tipo">Tipo</Label>
                    <select id="pg-tipo" className={`${fieldClass} h-10`} value={form.tipo}
                      onChange={(e) => set("tipo", e.target.value as Pg2030ProyectoTipo)}>
                      {PG2030_PROYECTO_TIPO_VALUES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pg-plazo">Plazo (Anexo 7)</Label>
                    <Input id="pg-plazo" value={form.plazo} onChange={(e) => set("plazo", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pg-presupuesto-estado">Presupuesto referencial</Label>
                    <select id="pg-presupuesto-estado" className={`${fieldClass} h-10`} value={form.presupuestoEstado}
                      onChange={(e) => set("presupuestoEstado", e.target.value as Pg2030PresupuestoEstado)}>
                      {PG2030_PRESUPUESTO_ESTADO_VALUES.map((estado) => <option key={estado} value={estado}>{estado}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pg-monto">Monto (USD)</Label>
                    <Input id="pg-monto" inputMode="decimal" disabled={form.presupuestoEstado !== "Monto"}
                      value={form.presupuestoEstado === "Monto" ? form.presupuestoReferencial : ""}
                      onChange={(e) => set("presupuestoReferencial", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pg-tipo-entidad">Tipo de entidad responsable</Label>
                    <Input id="pg-tipo-entidad" value={form.tipoEntidadResponsable}
                      onChange={(e) => set("tipoEntidadResponsable", e.target.value)} />
                  </div>
                </div>
                {([
                  ["entidadesEjecutoras", "Entidades ejecutoras (actualización)"],
                  ["responsablesPlan", "Responsables según el plan"],
                  ["hito2023", "Hito 2023"],
                  ["hito2030", "Hito 2030"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label htmlFor={`pg-${key}`}>{label}</Label>
                    <textarea id={`pg-${key}`} className={`${fieldClass} min-h-16`} value={form[key]}
                      onChange={(e) => set(key, e.target.value)} />
                  </div>
                ))}
                {form.hito2030.trim() !== (proyecto.hito2030 ?? "").trim() && (
                  <p className="text-xs text-amber-700">
                    El número de hitos al 2030 se cuenta por texto: si este hito lo comparten otros proyectos,
                    corrígelo igual en todos o el conteo subirá.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={saving}
                    onClick={() => { setForm(toForm(proyecto)); setEditing(false); }}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar corrección"}</Button>
                </div>
              </form>
            )}

            {proyecto.conflictos.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <TriangleAlert className="h-4 w-4 text-amber-600" />
                  Diferencias encontradas al importar el Excel
                </p>
                <ul className="space-y-2">
                  {proyecto.conflictos.map((conflicto) => (
                    <ConflictoItem key={conflicto.id} conflicto={conflicto} isAdmin={isAdmin} onReviewed={onChanged} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
