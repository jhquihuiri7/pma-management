"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Edit3, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { GeoLayerVisualization, GeoVisualizationDraft } from "@pma/types/geo";
import { apiErrorMessage } from "@/lib/api-client";
import {
  createVisualizationRemote, deleteVisualizationRemote, fetchVisualizations,
  reorderVisualizationsRemote, updateVisualizationRemote, fetchLayerRevisions,
  type LayerRevisionManifest,
} from "./persistence";
import { inferSchema } from "./charts";
import { CHART_BY_TYPE, validateVisualization } from "./chart-config";
import VisualizationBuilder from "./VisualizationBuilder";
import VisualizationRenderer from "./VisualizationRenderer";
import type { GisLayer, SchemaColumn } from "./types";

const EMPTY_VISUALIZATIONS: GeoLayerVisualization[] = [];

function toDraft(item: GeoLayerVisualization): GeoVisualizationDraft {
  return { type: item.type, title: item.title, position: item.position, bindings: item.bindings.map((binding) => ({ ...binding })), options: { ...item.options }, version: 1 };
}

function ColumnsView({ schema }: { schema: SchemaColumn[] }) {
  return <div className="columns-table-wrap"><table className="columns-table">
    <thead><tr><th>Columna</th><th>Tipo</th><th>Únicos</th><th>Nulos</th></tr></thead>
    <tbody>{schema.map((column) => <tr key={column.key}><td title={column.key}>{column.key}</td><td><span className={`type-pill t-${column.type}`}>{column.type}</span></td><td>{column.uniqueCount ?? 0}</td><td>{column.nullCount ?? 0}</td></tr>)}</tbody>
  </table></div>;
}

function MetadataView({ layer, schema, revisions, revisionsLoading, canManageSchema, onConfigureSchema }: { layer: GisLayer; schema: SchemaColumn[]; revisions: LayerRevisionManifest[]; revisionsLoading: boolean; canManageSchema?: boolean; onConfigureSchema?: () => void }) {
  const rows: [string, string | number][] = [
    ["Nombre", layer.name], ["Archivo", layer.filename || "—"], ["Geometría", layer.geometry],
    ["Features", layer.geojson.features.length], ["Columnas", schema.length], ["CRS", layer.crs || "EPSG:4326"],
    ["Tamaño", layer.size || "—"], ["Cargado", new Date(layer.loadedAt || Date.now()).toLocaleString("es-EC")],
    ["Revisión de datos", layer.dataRevision ?? 1], ["Captura manual", layer.manualEntryEnabled ? "Habilitada" : "Deshabilitada"],
  ];
  return <><div className="dash-card"><div className="dash-card-head"><div className="dh-title">Información de capa</div></div><div className="dash-card-body">{rows.map(([key, value]) => <div key={key} className="identify-row"><span className="k">{key}</span><span className="v">{value}</span></div>)}{canManageSchema && <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100" onClick={onConfigureSchema}><ShieldCheck size={14} />Configurar captura</button>}</div></div>
    {(revisionsLoading || revisions.length > 0) && <div className="dash-card"><div className="dash-card-head"><div className="dh-title">Historial de datos</div></div><div className="dash-card-body">{revisionsLoading ? <div className="text-xs text-slate-500">Cargando revisiones…</div> : revisions.slice(0, 8).map((revision) => <div key={revision.id} className="border-b border-slate-100 py-2 last:border-0"><div className="flex items-center justify-between text-xs"><strong className="text-slate-700">Revisión {revision.revision}</strong><span className="text-slate-400">{new Date(revision.createdAt).toLocaleString("es-EC")}</span></div><div className="mt-1 text-[11px] text-slate-500">{revision.action === "append" ? "Nueva observación" : "Carga inicial"} · {revision.featureCount} entidades{revision.changeReason ? ` · ${revision.changeReason}` : ""}</div></div>)}</div></div>}
  </>;
}

function VisualizationCard({ item, layer, invalid, canConfigure, first, last, onEdit, onDuplicate, onDelete, onMove }: {
  item: GeoLayerVisualization; layer: GisLayer; invalid: string[]; canConfigure: boolean; first: boolean; last: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (delta: number) => void;
}) {
  const definition = CHART_BY_TYPE[item.type];
  return <article className="dash-card viz-card">
    <div className="dash-card-head"><div className="dh-l"><div className="dh-title"><span className="viz-card-icon">{definition?.icon}</span>{item.title}</div><div className="dh-sub">{definition?.name} · {item.bindings.map((binding) => binding.field).join(" · ")}</div></div>
      {canConfigure && <div className="viz-card-actions"><button disabled={first} onClick={() => onMove(-1)} title="Subir">↑</button><button disabled={last} onClick={() => onMove(1)} title="Bajar">↓</button><button onClick={onEdit} title="Editar"><Edit3 size={12} /></button><button onClick={onDuplicate} title="Duplicar"><Copy size={12} /></button><button onClick={onDelete} title="Eliminar"><Trash2 size={12} /></button></div>}
    </div>
    <div className="dash-card-body">{invalid.length ? <div className="viz-invalid"><strong>Requiere revisión</strong><span>{invalid[0]}</span>{canConfigure && <button onClick={onEdit}>Corregir</button>}</div> : <VisualizationRenderer config={item} features={layer.geojson.features} compact />}</div>
  </article>;
}

export default function DashboardsPanel({ layer, mapId, canConfigure = false, canManageSchema = false, onConfigureSchema, workspaceMode = false, workspaceVisualizations = EMPTY_VISUALIZATIONS, onWorkspaceChange }: {
  layer: GisLayer | undefined; mapId?: string; canConfigure?: boolean; workspaceMode?: boolean;
  canManageSchema?: boolean; onConfigureSchema?: () => void;
  workspaceVisualizations?: GeoLayerVisualization[]; onWorkspaceChange?: (layerId: string, items: GeoLayerVisualization[]) => void;
}) {
  const [tab, setTab] = useState<"dashboards" | "columns" | "metadata">("dashboards");
  const [items, setItems] = useState<GeoLayerVisualization[]>(workspaceVisualizations);
  const [loading, setLoading] = useState(false);
  const [builder, setBuilder] = useState<{ id?: string; draft?: GeoVisualizationDraft } | null>(null);
  const [revisions, setRevisions] = useState<LayerRevisionManifest[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const schema = useMemo(() => inferSchema(layer?.geojson.features || []), [layer]);

  useEffect(() => {
    setBuilder(null);
    if (!layer) { setItems([]); return; }
    if (workspaceMode) { setItems(workspaceVisualizations); return; }
    if (!mapId || !layer.persisted) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchVisualizations(mapId, layer.id).then((loaded) => { if (!cancelled) setItems(loaded); }).catch((error) => { if (!cancelled) toast.error(apiErrorMessage(error, "No se pudieron cargar las visualizaciones")); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [layer, mapId, workspaceMode, workspaceVisualizations]);

  useEffect(() => {
    if (tab !== "metadata" || !canConfigure || !mapId || !layer?.persisted || workspaceMode) { setRevisions([]); setRevisionsLoading(false); return; }
    let cancelled = false;
    setRevisionsLoading(true);
    fetchLayerRevisions(mapId, layer.id).then((items) => { if (!cancelled) setRevisions(items); }).catch((error) => { if (!cancelled) toast.error(apiErrorMessage(error, "No se pudo cargar el historial de la capa")); }).finally(() => { if (!cancelled) setRevisionsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, canConfigure, mapId, layer, workspaceMode]);

  const commitWorkspace = (next: GeoLayerVisualization[]) => { setItems(next); if (layer) onWorkspaceChange?.(layer.id, next); };

  const save = async (draft: GeoVisualizationDraft) => {
    if (!layer) return;
    try {
      if (workspaceMode) {
        const existing = builder?.id ? items.find((item) => item.id === builder.id) : undefined;
        const nextItem: GeoLayerVisualization = existing ? { ...existing, ...draft } : { ...draft, id: crypto.randomUUID(), mapId: layer.workspaceSource?.mapId || "workspace", layerId: layer.id };
        const next = existing ? items.map((item) => item.id === existing.id ? nextItem : item) : [...items, nextItem];
        commitWorkspace(next.map((item, position) => ({ ...item, position })));
      } else if (mapId) {
        const saved = builder?.id ? await updateVisualizationRemote(mapId, layer.id, builder.id, draft) : await createVisualizationRemote(mapId, layer.id, draft);
        setItems((current) => builder?.id ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      }
      setBuilder(null); toast.success("Visualización guardada");
    } catch (error) { toast.error(apiErrorMessage(error, "No se pudo guardar la visualización")); throw error; }
  };

  const remove = async (item: GeoLayerVisualization) => {
    if (!layer || !window.confirm(`¿Eliminar la visualización “${item.title}”?`)) return;
    try {
      if (workspaceMode) commitWorkspace(items.filter((current) => current.id !== item.id).map((current, position) => ({ ...current, position })));
      else if (mapId) {
        await deleteVisualizationRemote(mapId, layer.id, item.id);
        const remaining = items.filter((candidate) => candidate.id !== item.id);
        setItems(remaining.length ? await reorderVisualizationsRemote(mapId, layer.id, remaining.map((candidate) => candidate.id)) : []);
      }
      toast.success("Visualización eliminada");
    } catch (error) { toast.error(apiErrorMessage(error, "No se pudo eliminar la visualización")); }
  };

  const move = async (index: number, delta: number) => {
    if (!layer) return;
    const target = index + delta; if (target < 0 || target >= items.length) return;
    const previous = items; const next = [...items]; [next[index], next[target]] = [next[target], next[index]];
    const positioned = next.map((item, position) => ({ ...item, position })); setItems(positioned);
    try { if (workspaceMode) onWorkspaceChange?.(layer.id, positioned); else if (mapId) setItems(await reorderVisualizationsRemote(mapId, layer.id, positioned.map((item) => item.id))); }
    catch (error) { setItems(previous); toast.error(apiErrorMessage(error, "No se pudo reordenar")); }
  };

  if (!layer) return <div className="right-rail"><div className="rail-header"><div><div className="rail-title">Visualizaciones</div><div className="rail-sub">Selecciona una capa vectorial</div></div></div><div className="rail-empty">◇<span>Selecciona una capa para consultar o crear visualizaciones.</span></div></div>;

  return <div className="right-rail">
    <div className="dash-source"><div className="ds-name"><span className="geom-dot" style={{ background: layer.style.color }} /><span>{layer.name}</span><span className="type-pill">{layer.geometry}</span></div><div className="ds-meta"><span>{layer.geojson.features.length} features</span><span>{schema.length} cols</span><span>{layer.crs || "EPSG:4326"}</span></div></div>
    <div className="dash-tabs"><button className={`dash-tab${tab === "dashboards" ? " active" : ""}`} onClick={() => setTab("dashboards")}>Visualizaciones</button><button className={`dash-tab${tab === "columns" ? " active" : ""}`} onClick={() => setTab("columns")}>Columnas</button><button className={`dash-tab${tab === "metadata" ? " active" : ""}`} onClick={() => setTab("metadata")}>Metadata</button></div>
    <div className="dash-body">
      {tab === "dashboards" && <>{loading && <div className="empty">Cargando visualizaciones…</div>}{!loading && items.map((item, index) => <VisualizationCard key={item.id} item={item} layer={layer} invalid={validateVisualization(item, schema)} canConfigure={canConfigure} first={index === 0} last={index === items.length - 1} onEdit={() => setBuilder({ id: item.id, draft: toDraft(item) })} onDuplicate={() => setBuilder({ draft: { ...toDraft(item), title: `${item.title} (copia)`, position: items.length } })} onDelete={() => void remove(item)} onMove={(delta) => void move(index, delta)} />)}
        {canConfigure && items.length < 20 && <button className="add-viz-card" onClick={() => setBuilder({})}><span><Plus size={20} /></span><strong>Crear visualización</strong><small>Combina y agrupa columnas de esta capa</small></button>}
        {!loading && !canConfigure && items.length === 0 && <div className="rail-empty small">◇<span>Esta capa todavía no tiene visualizaciones publicadas.</span></div>}</>}
      {tab === "columns" && <ColumnsView schema={schema} />}{tab === "metadata" && <MetadataView layer={layer} schema={schema} revisions={revisions} revisionsLoading={revisionsLoading} canManageSchema={canManageSchema} onConfigureSchema={onConfigureSchema} />}
    </div>
    {builder && <VisualizationBuilder layer={layer} initial={builder.draft} position={items.length} onClose={() => setBuilder(null)} onSave={save} />}
  </div>;
}
