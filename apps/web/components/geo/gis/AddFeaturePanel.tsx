"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, PencilLine, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Geometry, Position } from "geojson";
import type { GeoAttributeFieldSchema, GeoFeatureCreateResult } from "@pma/types/geo";
import { apiErrorMessage } from "@/lib/api-client";
import { createFeatureRemote } from "./persistence";
import type { GisLayer } from "./types";

export default function AddFeaturePanel({ mapId, layer, geometry, drawing, onStartDraw, onGeometryChange, onClose, onSaved }: {
  mapId: string;
  layer: GisLayer;
  geometry: Geometry | null;
  drawing: boolean;
  onStartDraw: () => void;
  onGeometryChange: (geometry: Geometry | null) => void;
  onClose: () => void;
  onSaved: (result: GeoFeatureCreateResult, keepOpen: boolean) => void;
}) {
  const schema = layer.attributeSchema!;
  const initialValues = useMemo(() => Object.fromEntries(schema.fields.flatMap((field) =>
    !field.readOnly && field.defaultValue !== undefined && field.defaultValue !== null
      ? [[field.key, String(field.defaultValue)]]
      : []
  )), [schema]);
  const [values, setValues] = useState<Record<string, string | boolean>>(initialValues);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [coordinateText, setCoordinateText] = useState("");
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [clientFeatureId, setClientFeatureId] = useState(() => crypto.randomUUID());
  const [pointText, setPointText] = useState({ lng: "", lat: "" });

  useEffect(() => {
    if (geometry?.type === "Point") setPointText({ lng: String(geometry.coordinates[0]), lat: String(geometry.coordinates[1]) });
    else if (!geometry) setPointText({ lng: "", lat: "" });
  }, [geometry]);

  const missing = schema.fields.filter((field) => field.required && !field.readOnly && (values[field.key] === undefined || values[field.key] === ""));
  const canSave = !!geometry && missing.length === 0 && !coordinateError && !saving;

  function applyCoordinateText(text: string) {
    setCoordinateText(text);
    if (!text.trim()) { setCoordinateError(null); onGeometryChange(null); return; }
    try {
      const positions = text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
        const parts = line.trim().split(/[;,\s]+/).map(Number);
        if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error(`Vértice ${index + 1} inválido`);
        if (parts[0] < -180 || parts[0] > 180 || parts[1] < -90 || parts[1] > 90) throw new Error(`Vértice ${index + 1} fuera de rango`);
        return parts as Position;
      });
      if (layer.geometry === "LineString") {
        if (positions.length < 2) throw new Error("La línea requiere al menos dos vértices");
        onGeometryChange({ type: "LineString", coordinates: positions });
      } else if (layer.geometry === "Polygon") {
        if (positions.length < 3) throw new Error("El polígono requiere al menos tres vértices");
        const closed = samePosition(positions[0], positions[positions.length - 1]) ? positions : [...positions, positions[0]];
        onGeometryChange({ type: "Polygon", coordinates: [closed] });
      }
      setCoordinateError(null);
    } catch (error) {
      setCoordinateError(error instanceof Error ? error.message : "Coordenadas inválidas");
    }
  }

  function updatePoint(axis: 0 | 1, raw: string) {
    const nextText = axis === 0 ? { ...pointText, lng: raw } : { ...pointText, lat: raw };
    setPointText(nextText);
    const current = [Number(nextText.lng), Number(nextText.lat)];
    if (!nextText.lng.trim() || !nextText.lat.trim()) { onGeometryChange(null); setCoordinateError(null); return; }
    if (Number.isFinite(current[0]) && Number.isFinite(current[1])) {
      onGeometryChange({ type: "Point", coordinates: [current[0], current[1]] });
      setCoordinateError(current[0] < -180 || current[0] > 180 || current[1] < -90 || current[1] > 90 ? "Coordenadas fuera de rango" : null);
    }
  }

  function buildProperties(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.readOnly) continue;
      const value = values[field.key];
      if (value === undefined || value === "") { properties[field.key] = null; continue; }
      if (field.type === "boolean") properties[field.key] = value === true || value === "true";
      else if (field.type === "integer" || field.type === "number") properties[field.key] = Number(value);
      else if (field.type === "datetime") properties[field.key] = new Date(String(value)).toISOString();
      else properties[field.key] = value;
    }
    return properties;
  }

  async function save(keepOpen: boolean) {
    if (!geometry || !canSave) return;
    setSaving(true);
    try {
      const result = await createFeatureRemote(mapId, layer.id, {
        expectedRevision: layer.dataRevision ?? 1,
        clientFeatureId,
        properties: buildProperties(),
        geometry: geometry as unknown as Record<string, unknown>,
        reason: reason.trim() || undefined,
      });
      toast.success("Observación agregada correctamente");
      onSaved(result, keepOpen);
      if (keepOpen) {
        setValues(initialValues);
        setReason("");
        setCoordinateText("");
        setCoordinateError(null);
        setClientFeatureId(crypto.randomUUID());
        onGeometryChange(null);
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la observación"));
    } finally {
      setSaving(false);
    }
  }

  return <aside className="fixed right-4 top-16 z-[1400] flex max-h-[calc(100vh-90px)] w-[410px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
    <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
      <div><h2 className="text-sm font-semibold text-slate-900">Nueva observación</h2><p className="mt-0.5 text-xs text-slate-500">{layer.name} · revisión {layer.dataRevision ?? 1}</p></div>
      <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100" onClick={onClose} disabled={saving}><X className="h-4 w-4" /></button>
    </div>
    <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Atributos</h3>
        <div className="space-y-3">
          {schema.fields.map((field) => <FeatureField key={field.key} field={field} value={values[field.key]} geometry={geometry} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />)}
          {schema.fields.length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Esta capa no tiene atributos; dibuja únicamente la geometría.</p>}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Geometría · {layer.geometry}</h3>{geometry && <button className="flex items-center gap-1 text-xs text-red-600" onClick={() => { onGeometryChange(null); setCoordinateText(""); }}><Trash2 className="h-3 w-3" />Limpiar</button>}</div>
        <button type="button" className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium ${drawing ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} onClick={onStartDraw} disabled={saving}>
          {layer.geometry === "Point" ? <MapPin className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}{drawing ? drawInstruction(layer.geometry) : `Dibujar ${geometryLabel(layer.geometry)} en el mapa`}
        </button>
        {layer.geometry === "Point" ? <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">Longitud<input type="number" step="any" value={pointText.lng} onChange={(event) => updatePoint(0, event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label><label className="text-xs text-slate-600">Latitud<input type="number" step="any" value={pointText.lat} onChange={(event) => updatePoint(1, event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label></div> : <label className="mt-3 block text-xs text-slate-600">Coordenadas manuales <span className="text-slate-400">(longitud, latitud; una por línea)</span><textarea rows={5} value={coordinateText} onChange={(event) => applyCoordinateText(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs" placeholder={"-90.31, -0.74\n-90.30, -0.75\n-90.29, -0.74"} /></label>}
        {coordinateError && <p className="mt-2 text-xs text-red-600">{coordinateError}</p>}
        {geometry && !coordinateError && <p className="mt-2 text-xs font-medium text-emerald-700">Geometría preparada · {vertexCount(geometry)} vértice(s)</p>}
      </section>
      <label className="block text-xs font-medium text-slate-700">Motivo o fuente del levantamiento <span className="font-normal text-slate-400">(opcional)</span><textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
      {missing.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Completa: {missing.map((field) => field.label).join(", ")}.</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
      <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-3 text-sm font-medium text-teal-700 disabled:opacity-40" onClick={() => void save(true)} disabled={!canSave}><Save className="h-3.5 w-3.5" />Guardar y agregar otra</button>
      <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-medium text-white disabled:opacity-40" onClick={() => void save(false)} disabled={!canSave}><Save className="h-3.5 w-3.5" />{saving ? "Guardando…" : "Guardar"}</button>
    </div>
  </aside>;
}

function FeatureField({ field, value, geometry, onChange }: { field: GeoAttributeFieldSchema; value: string | boolean | undefined; geometry: Geometry | null; onChange: (value: string | boolean) => void }) {
  if (field.readOnly) return <label className="block text-xs font-medium text-slate-700">{field.label}<input disabled value={derivedPreview(field, geometry)} placeholder="Se calculará al guardar" className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500" /></label>;
  const label = <>{field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</>;
  if (field.allowedValues?.length) return <label className="block text-xs font-medium text-slate-700">{label}<select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Selecciona…</option>{field.allowedValues.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select></label>;
  if (field.type === "boolean") return <label className="block text-xs font-medium text-slate-700">{label}<select value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "true")} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Selecciona…</option><option value="true">Sí</option><option value="false">No</option></select></label>;
  return <label className="block text-xs font-medium text-slate-700">{label}<input type={field.type === "integer" || field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"} step={field.type === "number" ? "any" : undefined} min={field.min} max={field.max} maxLength={field.maxLength} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>;
}

function derivedPreview(field: GeoAttributeFieldSchema, geometry: Geometry | null): string {
  if (!field.derived || geometry?.type !== "Point") return "";
  if (field.derived.kind === "longitude") return String(geometry.coordinates[0]);
  if (field.derived.kind === "latitude") return String(geometry.coordinates[1]);
  return "";
}
function drawInstruction(type: GisLayer["geometry"]): string { return type === "Point" ? "Haz clic en el mapa" : "Clic para vértices · doble clic para terminar"; }
function geometryLabel(type: GisLayer["geometry"]): string { return type === "Point" ? "punto" : type === "LineString" ? "línea" : "polígono"; }
function samePosition(a: Position, b: Position): boolean { return a[0] === b[0] && a[1] === b[1]; }
function vertexCount(geometry: Geometry): number { return geometry.type === "Point" ? 1 : geometry.type === "LineString" ? geometry.coordinates.length : geometry.type === "Polygon" ? geometry.coordinates.flat().length : 0; }
