"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import type { GeoAttributeFieldSchema, GeoLayerAttributeSchema } from "@pma/types/geo";
import { apiErrorMessage } from "@/lib/api-client";
import {
  fetchLayerCaptureSchema,
  updateLayerCaptureSchemaRemote,
  type LayerManifest,
} from "./persistence";
import type { GisLayer } from "./types";

export default function LayerSchemaDialog({ mapId, layer, onClose, onSaved }: {
  mapId: string;
  layer: GisLayer;
  onClose: () => void;
  onSaved: (manifest: LayerManifest) => void;
}) {
  const [schema, setSchema] = useState<GeoLayerAttributeSchema | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [inferred, setInferred] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLayerCaptureSchema(mapId, layer.id).then((result) => {
      if (cancelled) return;
      setSchema(result.schema);
      setEnabled(result.manualEntryEnabled);
      setInferred(result.inferred);
    }).catch((error) => toast.error(apiErrorMessage(error, "No se pudo cargar el esquema de captura")));
    return () => { cancelled = true; };
  }, [mapId, layer.id]);

  const updateField = (index: number, patch: Partial<GeoAttributeFieldSchema>) => {
    setSchema((current) => current ? {
      ...current,
      fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field),
    } : current);
  };

  async function save() {
    if (!schema) return;
    setSaving(true);
    try {
      const manifest = await updateLayerCaptureSchemaRemote(mapId, layer.id, schema, enabled);
      onSaved(manifest);
      toast.success("Esquema de captura guardado");
      onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar el esquema"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1500] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><ShieldCheck className="h-4 w-4 text-teal-600" />Configurar captura de observaciones</h2>
            <p className="mt-1 text-xs text-slate-500">{layer.name} · define tipos y reglas antes de habilitar nuevos registros.</p>
          </div>
          <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose} disabled={saving}><X className="h-4 w-4" /></button>
        </div>

        {!schema ? <div className="grid min-h-64 place-items-center text-sm text-slate-500">Analizando columnas de la capa…</div> : <>
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">Ingreso manual</p>
              <p className="text-xs text-slate-500">Solo administradores configuran las reglas; usuarios GEO autorizados podrán agregar observaciones.</p>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 accent-teal-600" />Habilitado</label>
          </div>
          {inferred && <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">Este esquema fue inferido de los datos existentes. Revísalo antes de habilitar la captura.</div>}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-700">Máximo de vértices<input type="number" min={1} max={100000} value={schema.geometry.maxVertices} onChange={(event) => setSchema({ ...schema, geometry: { ...schema.geometry, maxVertices: Number(event.target.value) } })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
              <label className="text-xs font-medium text-slate-700">Extensión permitida (opcional)<input value={schema.geometry.extent?.join(", ") ?? ""} placeholder="minLng, minLat, maxLng, maxLat" onChange={(event) => {
                const parts = event.target.value.split(",").map((part) => Number(part.trim()));
                setSchema({ ...schema, geometry: { ...schema.geometry, extent: parts.length === 4 && parts.every(Number.isFinite) ? parts as [number, number, number, number] : null } });
              }} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" /></label>
            </div>
            <div className="space-y-3">
              {schema.fields.map((field, index) => <FieldEditor key={field.key} field={field} fields={schema.fields} onChange={(patch) => updateField(index, patch)} />)}
              {schema.fields.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">La capa no tiene columnas de atributos. Se capturará únicamente la geometría.</div>}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
            <button className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="h-9 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white disabled:opacity-50" onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar configuración"}</button>
          </div>
        </>}
      </div>
    </div>
  );
}

function FieldEditor({ field, fields, onChange }: {
  field: GeoAttributeFieldSchema;
  fields: GeoAttributeFieldSchema[];
  onChange: (patch: Partial<GeoAttributeFieldSchema>) => void;
}) {
  const derivedValue = field.derived?.kind ?? "";
  const allowedText = field.allowedValues?.join("\n") ?? "";
  return <div className="rounded-xl border border-slate-200 p-4">
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1.1fr_0.8fr]">
      <label className="text-xs font-medium text-slate-700">Columna<input value={field.key} disabled className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 font-mono text-xs" /></label>
      <label className="text-xs font-medium text-slate-700">Etiqueta<input value={field.label} onChange={(event) => onChange({ label: event.target.value })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
      <label className="text-xs font-medium text-slate-700">Tipo<select value={field.type} onChange={(event) => onChange({ type: event.target.value as GeoAttributeFieldSchema["type"] })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="string">Texto</option><option value="integer">Entero</option><option value="number">Decimal</option><option value="date">Fecha</option><option value="datetime">Fecha y hora</option><option value="boolean">Sí / No</option></select></label>
    </div>
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700">
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.required} onChange={(event) => onChange({ required: event.target.checked })} className="accent-teal-600" />Obligatorio</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.unique ?? false} onChange={(event) => onChange({ unique: event.target.checked })} className="accent-teal-600" />Único</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={field.readOnly ?? false} onChange={(event) => onChange({ readOnly: event.target.checked })} className="accent-teal-600" />Solo lectura</label>
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {field.type === "string" && <label className="text-xs font-medium text-slate-700">Longitud máxima<input type="number" value={field.maxLength ?? 5000} onChange={(event) => onChange({ maxLength: Number(event.target.value) })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>}
      {(field.type === "integer" || field.type === "number") && <><label className="text-xs font-medium text-slate-700">Mínimo<input type="number" value={field.min ?? ""} onChange={(event) => onChange({ min: event.target.value === "" ? undefined : Number(event.target.value) })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label><label className="text-xs font-medium text-slate-700">Máximo<input type="number" value={field.max ?? ""} onChange={(event) => onChange({ max: event.target.value === "" ? undefined : Number(event.target.value) })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label></>}
      <label className="text-xs font-medium text-slate-700">Campo calculado<select value={derivedValue} onChange={(event) => {
        const kind = event.target.value;
        if (!kind) onChange({ derived: undefined, readOnly: false });
        else if (kind === "yearFromDate") onChange({ derived: { kind, sourceField: fields.find((candidate) => candidate.type === "date" || candidate.type === "datetime")?.key ?? "" }, readOnly: true });
        else onChange({ derived: { kind } as GeoAttributeFieldSchema["derived"], readOnly: true });
      }} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">No calculado</option><option value="latitude">Latitud del punto</option><option value="longitude">Longitud del punto</option><option value="yearFromDate">Año desde fecha</option></select></label>
      {field.derived?.kind === "yearFromDate" && <label className="text-xs font-medium text-slate-700">Fecha fuente<select value={field.derived.sourceField} onChange={(event) => onChange({ derived: { kind: "yearFromDate", sourceField: event.target.value } })} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">{fields.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}</select></label>}
      <label className="text-xs font-medium text-slate-700 sm:col-span-2">Valores permitidos, uno por línea<textarea rows={2} value={allowedText} onChange={(event) => {
        const lines = event.target.value.split("\n").map((line) => line.trim()).filter(Boolean);
        const values = lines.map((line) => field.type === "integer" || field.type === "number" ? Number(line) : field.type === "boolean" ? line === "true" : line);
        onChange({ allowedValues: values.length ? values : undefined });
      }} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
    </div>
  </div>;
}
