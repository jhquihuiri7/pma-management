"use client";

import { useMemo, useState } from "react";
import { X, ArrowLeft, GripVertical, Plus, Trash2 } from "lucide-react";
import type { GeoChartFieldBinding, GeoChartType, GeoVisualizationDraft } from "@pma/types/geo";
import { CHART_BY_TYPE, CHART_DEFINITIONS, acceptsColumn, chartAvailable, defaultVisualization, validateVisualization } from "./chart-config";
import { inferSchema } from "./charts";
import VisualizationRenderer from "./VisualizationRenderer";
import type { GisLayer, SchemaColumn } from "./types";

function cloneDraft(draft: GeoVisualizationDraft): GeoVisualizationDraft {
  return { ...draft, bindings: draft.bindings.map((item) => ({ ...item })), options: { ...draft.options } };
}

export default function VisualizationBuilder({ layer, initial, position, onClose, onSave }: {
  layer: GisLayer;
  initial?: GeoVisualizationDraft;
  position: number;
  onClose: () => void;
  onSave: (draft: GeoVisualizationDraft) => Promise<void>;
}) {
  const schema = useMemo(() => inferSchema(layer.geojson.features), [layer]);
  const [draft, setDraft] = useState<GeoVisualizationDraft | null>(initial ? cloneDraft(initial) : null);
  const [saving, setSaving] = useState(false);
  const definition = draft ? CHART_BY_TYPE[draft.type] : null;
  const errors = draft ? validateVisualization(draft, schema) : [];

  const chooseType = (type: GeoChartType) => setDraft(defaultVisualization(type, position));
  const addBinding = (role: GeoChartFieldBinding["role"], column: SchemaColumn) => {
    if (!draft || !definition) return;
    const roleDefinition = definition.roles.find((item) => item.role === role);
    if (!roleDefinition || !acceptsColumn(roleDefinition.kind, column.type)) return;
    const current = draft.bindings.filter((item) => item.role === role);
    if (current.length >= roleDefinition.max || draft.bindings.some((item) => item.role === role && item.field === column.key)) return;
    const aggregation = roleDefinition.aggregations?.[0];
    setDraft({ ...draft, bindings: [...draft.bindings, { role, field: column.key, aggregation, ...(column.type === "date" ? { dateGrain: "year" as const } : {}) }] });
  };
  const autoAdd = (column: SchemaColumn) => {
    if (!definition || !draft) return;
    const role = definition.roles.find((item) => acceptsColumn(item.kind, column.type) && draft.bindings.filter((binding) => binding.role === item.role).length < item.max);
    if (role) addBinding(role.role, column);
  };
  const removeBinding = (index: number) => draft && setDraft({ ...draft, bindings: draft.bindings.filter((_, itemIndex) => itemIndex !== index) });
  const updateBinding = (index: number, patch: Partial<GeoChartFieldBinding>) => draft && setDraft({ ...draft, bindings: draft.bindings.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const moveBinding = (index: number, delta: number) => {
    if (!draft) return;
    const roleIndexes = draft.bindings.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => item.role === draft.bindings[index].role).map(({ itemIndex }) => itemIndex);
    const rolePosition = roleIndexes.indexOf(index);
    const target = roleIndexes[rolePosition + delta];
    if (target === undefined) return;
    const next = [...draft.bindings];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, bindings: next });
  };

  return (
    <div className="viz-builder-backdrop" role="dialog" aria-modal="true" aria-label="Constructor de visualizaciones">
      <div className="viz-builder">
        <div className="viz-builder-head">
          <div>
            <div className="viz-builder-title">{draft ? (initial ? "Editar visualización" : "Nueva visualización") : "Elige una visualización"}</div>
            <div className="viz-builder-sub">{layer.name} · {layer.geojson.features.length} registros</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>

        {!draft ? (
          <div className="viz-gallery">
            {CHART_DEFINITIONS.map((item) => {
              const available = chartAvailable(item, schema);
              return (
                <button key={item.type} className="viz-gallery-card" disabled={!available} onClick={() => chooseType(item.type)} title={available ? item.description : "La capa no contiene suficientes columnas compatibles"}>
                  <span className="viz-gallery-icon">{item.icon}</span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  {!available && <em>Campos insuficientes</em>}
                </button>
              );
            })}
          </div>
        ) : definition && (
          <div className="viz-builder-grid">
            <aside className="viz-fields">
              <button className="viz-back" onClick={() => setDraft(null)}><ArrowLeft size={13} /> Cambiar tipo</button>
              <div className="viz-side-title">Columnas</div>
              <div className="viz-field-list">
                {schema.filter((column) => column.type !== "empty").map((column) => (
                  <button
                    key={column.key}
                    className="viz-field"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", column.key)}
                    onClick={() => autoAdd(column)}
                    title="Arrastra a un espacio o presiona para asignar"
                  >
                    <GripVertical size={12} /><span>{column.key}</span><em>{column.type}</em>
                  </button>
                ))}
              </div>
            </aside>

            <main className="viz-preview">
              <div className="viz-preview-head">
                <span>{definition.icon}</span>
                <input value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Título de visualización" />
              </div>
              <div className="viz-preview-canvas">
                {errors.length === 0
                  ? <VisualizationRenderer config={draft} features={layer.geojson.features} />
                  : <div className="viz-preview-empty"><Plus size={28} /><span>Asigna los campos requeridos para generar la vista previa.</span></div>}
              </div>
            </main>

            <aside className="viz-bindings">
              <div className="viz-side-title">Construir</div>
              {definition.roles.map((role) => {
                const indexed = draft.bindings.map((item, index) => ({ item, index })).filter(({ item }) => item.role === role.role);
                return (
                  <div
                    className="viz-drop-zone"
                    key={role.role}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const column = schema.find((item) => item.key === event.dataTransfer.getData("text/plain"));
                      if (column) addBinding(role.role, column);
                    }}
                  >
                    <div className="viz-drop-title"><span>{role.label}{role.min > 0 ? " *" : ""}</span><small>{role.hint}</small></div>
                    {indexed.map(({ item, index }, roleIndex) => (
                      <div className="viz-binding" key={`${item.role}-${item.field}-${index}`}>
                        <span className="viz-binding-name">{item.field}</span>
                        {role.aggregations && (
                          <select value={item.aggregation || role.aggregations[0]} onChange={(event) => updateBinding(index, { aggregation: event.target.value as GeoChartFieldBinding["aggregation"] })}>
                            {role.aggregations.map((aggregation) => <option key={aggregation} value={aggregation}>{aggregation}</option>)}
                          </select>
                        )}
                        {schema.find((column) => column.key === item.field)?.type === "date" && (
                          <select value={item.dateGrain || "year"} onChange={(event) => updateBinding(index, { dateGrain: event.target.value as GeoChartFieldBinding["dateGrain"] })}>
                            <option value="year">Año</option><option value="quarter">Trimestre</option><option value="month">Mes</option><option value="day">Día</option>
                          </select>
                        )}
                        {role.max > 1 && <div className="viz-order"><button disabled={roleIndex === 0} onClick={() => moveBinding(index, -1)}>↑</button><button disabled={roleIndex === indexed.length - 1} onClick={() => moveBinding(index, 1)}>↓</button></div>}
                        <button className="viz-binding-remove" onClick={() => removeBinding(index)} aria-label={`Quitar ${item.field}`}><Trash2 size={12} /></button>
                      </div>
                    ))}
                    {indexed.length < role.max && <div className="viz-drop-placeholder">Suelta una columna aquí</div>}
                  </div>
                );
              })}

              <div className="viz-side-title viz-options-title">Opciones</div>
              {(draft.type === "histogram") && <label className="viz-option">Intervalos <input type="number" min={3} max={30} value={draft.options.bins ?? 8} onChange={(event) => setDraft({ ...draft, options: { ...draft.options, bins: Number(event.target.value) } })} /></label>}
              {!(["kpi", "scatter", "histogram", "sankey"].includes(draft.type)) && <label className="viz-option">Top N <input type="number" min={1} max={100} value={draft.options.topN ?? 12} onChange={(event) => setDraft({ ...draft, options: { ...draft.options, topN: Number(event.target.value) } })} /></label>}
              {(["bar", "stackedBar"].includes(draft.type)) && <label className="viz-option">Orientación <select value={draft.options.orientation || "vertical"} onChange={(event) => setDraft({ ...draft, options: { ...draft.options, orientation: event.target.value as "horizontal" | "vertical" } })}><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>}
              <label className="viz-check"><input type="checkbox" checked={!!draft.options.includeNulls} onChange={(event) => setDraft({ ...draft, options: { ...draft.options, includeNulls: event.target.checked } })} /> Incluir valores sin dato</label>
            </aside>
          </div>
        )}

        {draft && (
          <div className="viz-builder-foot">
            <div className="viz-errors">{errors[0] || "Configuración válida"}</div>
            <button className="tb-btn" onClick={onClose}>Cancelar</button>
            <button className="tb-btn primary" disabled={saving || errors.length > 0} onClick={async () => { setSaving(true); try { await onSave(draft); } catch { /* parent reports and keeps the builder open */ } finally { setSaving(false); } }}>
              {saving ? "Guardando…" : "Guardar visualización"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
