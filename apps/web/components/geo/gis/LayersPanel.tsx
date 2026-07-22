"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Trash2, ChevronRight, Upload, RotateCcw } from "lucide-react";
import { COLOR_RAMPS } from "./gis-data";
import { inferSchema } from "./charts";
import GeomGlyph from "./GeomGlyph";
import type { GisLayer, LayerStyle, RasterLayer, RasterStatus } from "./types";

const RASTER_STATUS: Record<RasterStatus, { text: string; color: string }> = {
  uploaded: { text: "En cola", color: "#6e5a2c" },
  queued: { text: "En cola", color: "#6e5a2c" },
  processing: { text: "Procesando…", color: "#2c5481" },
  processed: { text: "Listo", color: "#3f7c5f" },
  deleting: { text: "Eliminando…", color: "#64748b" },
  error: { text: "Error", color: "#9d4636" },
};

// One orthophoto row: status badge, opacity (when ready), retry (on error).
function RasterItem({ layer, readOnly, canDelete, busy = false, onChange, onRemove, onRetry }: {
  layer: RasterLayer; readOnly?: boolean; canDelete?: boolean; busy?: boolean;
  onChange: (l: RasterLayer) => void; onRemove: () => void; onRetry: () => void;
}) {
  const st = RASTER_STATUS[layer.status];
  const ready = layer.status === "processed";
  const deleting = layer.status === "deleting" || busy;
  return (
    <div className={"layer-item" + (ready && layer.visible ? " active" : "")}>
      <div className={"layer-row layer-row-stacked" + (!readOnly ? " has-actions" : "")}>
        <div className="drag raster-kind" data-tip="Ortofoto">▦</div>
        <div
          className={"layer-vis" + (layer.visible && ready ? " on" : "")}
          onClick={() => { if (ready && !deleting) onChange({ ...layer, visible: !layer.visible }); }}
          data-tip={ready ? (layer.visible ? "Ocultar" : "Mostrar") : "Disponible al terminar el procesamiento"}
          style={{ opacity: ready ? 1 : 0.4, cursor: ready ? "pointer" : "default" }}
        >
          {layer.visible && ready ? <Eye size={13} /> : <EyeOff size={13} />}
        </div>
        <div className="layer-info">
          <div className="layer-title-line">
            <span className="layer-name">{layer.name}</span>
          </div>
          <div className="layer-meta">
            <span style={{ color: st.color, fontWeight: 600 }}>{st.text}</span>
            <span>•</span><span>ráster</span>
          </div>
        </div>
        {!readOnly && (
          <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
            {layer.status === "error" && (
              <button className="icon-btn" data-tip="Reintentar" disabled={deleting} onClick={onRetry}><RotateCcw size={13} /></button>
            )}
            {canDelete && (
              <button className="icon-btn" data-tip="Eliminar" disabled={deleting} onClick={onRemove}><Trash2 size={13} /></button>
            )}
          </div>
        )}
      </div>

      {layer.status === "error" && layer.errorMessage && (
        <div style={{ padding: "2px 12px 8px 32px", fontSize: 11, color: "#9d4636", lineHeight: 1.4 }}>
          {layer.errorMessage}
        </div>
      )}

      {ready && !readOnly && (
        <div className="layer-expand">
          <div className="style-section">
            <div className="style-label">Opacidad: {Math.round(layer.opacity * 100)}%</div>
            <div className="slider-row">
              <input
                type="range" min="0" max="100" value={Math.round(layer.opacity * 100)}
                disabled={deleting}
                onChange={(e) => onChange({ ...layer, opacity: parseInt(e.target.value) / 100 })}
              />
              <div className="slider-val">{Math.round(layer.opacity * 100)}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Style Editor (per layer, lives inside the layer list expand)
// ────────────────────────────────────────────────────────────
function StyleEditor({ layer, onChange }: { layer: GisLayer; onChange: (l: GisLayer) => void }) {
  const schema = inferSchema(layer.geojson.features);
  const numericCols = schema.filter((c) => c.type === "numeric");
  const catCols = schema.filter((c) => c.type === "categorical");

  const setStyle = (patch: Partial<LayerStyle>) => onChange({ ...layer, style: { ...layer.style, ...patch } });

  return (
    <>
      {/* Mode tabs */}
      <div className="style-section">
        <div className="style-label">Modo de simbolización</div>
        <div className="tab-row">
          <button className={layer.style.mode === "single" ? "active" : ""} onClick={() => setStyle({ mode: "single" })}>Único</button>
          <button className={layer.style.mode === "category" ? "active" : ""} onClick={() => setStyle({ mode: "category", colorBy: layer.style.colorBy || catCols[0]?.key || null })} disabled={catCols.length === 0}>Categoría</button>
          <button className={layer.style.mode === "ramp" ? "active" : ""} onClick={() => setStyle({ mode: "ramp", colorBy: layer.style.colorBy || numericCols[0]?.key || null })} disabled={numericCols.length === 0}>Cantidad</button>
        </div>
      </div>

      {/* SINGLE color */}
      {layer.style.mode === "single" && (
        <div className="style-section">
          <div className="style-label">Color de relleno</div>
          <div className="swatch-row">
            {["#3f7c5f", "#2c5481", "#c46d27", "#9d4636", "#6e5a2c", "#4a4458", "#1f5a3f", "#525252"].map((c) => (
              <div key={c} className={"swatch" + (layer.style.color === c ? " selected" : "")} style={{ background: c }} onClick={() => setStyle({ color: c })} />
            ))}
            <label className="swatch" style={{ background: layer.style.color, position: "relative", display: "grid", placeItems: "center" }} data-tip="Color personalizado">
              <span style={{ fontSize: 10, color: "white", textShadow: "0 0 2px rgba(0,0,0,0.6)" }}>+</span>
              <input type="color" value={layer.style.color} onChange={(e) => setStyle({ color: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
            </label>
          </div>
        </div>
      )}

      {/* CATEGORY */}
      {layer.style.mode === "category" && (
        <>
          <div className="style-section">
            <div className="style-label">Categorizar por</div>
            <select className="field-select" value={layer.style.colorBy || ""} onChange={(e) => setStyle({ colorBy: e.target.value })}>
              {catCols.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
          </div>
          <div className="style-section">
            <div className="style-label">Paleta categórica</div>
            <div className="ramp-row">
              {["categorical", "viridis", "earth"].map((name) => (
                <div key={name} className={"ramp" + (layer.style.palette === name ? " selected" : "")} onClick={() => setStyle({ palette: name })}>
                  {COLOR_RAMPS[name].slice(0, 7).map((c, i) => <span key={i} style={{ background: c }} />)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* RAMP / CHOROPLETH */}
      {layer.style.mode === "ramp" && (
        <>
          <div className="style-section">
            <div className="style-label">Atributo numérico</div>
            <select className="field-select" value={layer.style.colorBy || ""} onChange={(e) => setStyle({ colorBy: e.target.value })}>
              {numericCols.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
          </div>
          <div className="style-section">
            <div className="style-label">Rampa de color</div>
            <div className="ramp-row">
              {["greens", "blues", "oranges", "reds", "earth", "grayscale", "viridis"].map((name) => (
                <div key={name} className={"ramp" + (layer.style.ramp === name ? " selected" : "")} onClick={() => setStyle({ ramp: name })}>
                  {COLOR_RAMPS[name].map((c, i) => <span key={i} style={{ background: c }} />)}
                </div>
              ))}
            </div>
          </div>
          <div className="style-section">
            <div className="style-label">Clasificación</div>
            <div className="tab-row">
              {(["equal", "quantile", "jenks"] as const).map((k) => (
                <button key={k} className={layer.style.classification === k ? "active" : ""} onClick={() => setStyle({ classification: k })}>
                  {k === "equal" ? "Equal int." : k === "quantile" ? "Cuantil" : "Natural"}
                </button>
              ))}
            </div>
          </div>
          <div className="style-section">
            <div className="style-label">Clases: {layer.style.classes}</div>
            <div className="slider-row">
              <input type="range" min="3" max="7" value={layer.style.classes} onChange={(e) => setStyle({ classes: parseInt(e.target.value) })} />
              <div className="slider-val">{layer.style.classes}</div>
            </div>
          </div>
        </>
      )}

      {/* Opacity */}
      <div className="style-section">
        <div className="style-label">Opacidad: {Math.round(layer.style.opacity * 100)}%</div>
        <div className="slider-row">
          <input type="range" min="0" max="100" value={Math.round(layer.style.opacity * 100)} onChange={(e) => setStyle({ opacity: parseInt(e.target.value) / 100 })} />
          <div className="slider-val">{Math.round(layer.style.opacity * 100)}%</div>
        </div>
      </div>

      {/* Stroke / size */}
      <div className="style-section">
        <div className="style-label">{layer.geometry === "Point" ? `Tamaño: ${layer.style.size}px` : `Borde: ${layer.style.strokeWidth}px`}</div>
        <div className="slider-row">
          {layer.geometry === "Point" ? (
            <input type="range" min="3" max="14" value={layer.style.size} onChange={(e) => setStyle({ size: parseInt(e.target.value) })} />
          ) : (
            <input type="range" min="0" max="4" step="0.5" value={layer.style.strokeWidth} onChange={(e) => setStyle({ strokeWidth: parseFloat(e.target.value) })} />
          )}
          <div className="slider-val">{layer.geometry === "Point" ? layer.style.size : layer.style.strokeWidth}</div>
        </div>
      </div>

      {/* Labels toggle */}
      <div className="style-section">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <input type="checkbox" checked={!!layer.style.labels} onChange={(e) => setStyle({ labels: e.target.checked })} />
          Mostrar etiquetas
        </label>
        {layer.style.labels && (
          <select className="field-select" value={layer.style.labelField || ""} onChange={(e) => setStyle({ labelField: e.target.value })}>
            {schema.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
          </select>
        )}
      </div>
    </>
  );
}

function LayerItem({ layer, active, isFirst, isLast, readOnly, canDelete, busy = false, onClick, onChange, onRemove, onMove }: {
  layer: GisLayer; active: boolean; isFirst: boolean; isLast: boolean; readOnly?: boolean; canDelete?: boolean; busy?: boolean;
  onClick: () => void; onChange: (l: GisLayer) => void; onRemove: () => void; onMove: (d: number) => void;
}) {
  const [expanded, setExpanded] = useState(active);

  useEffect(() => {
    if (active) setExpanded(true);
  }, [active]);

  return (
    <div className={"layer-item" + (active ? " active" : "")} aria-busy={busy} style={{ opacity: busy ? 0.65 : 1 }}>
      <div className={"layer-row layer-row-stacked" + (!readOnly ? " has-actions" : "")} onClick={() => { if (!busy) onClick(); }}>
        {readOnly ? (
          <div className="drag layer-slot" aria-hidden="true" />
        ) : (
          <div className="drag" data-tip="Reordenar" onClick={(e) => e.stopPropagation()}>⋮⋮</div>
        )}
        <div className={"layer-vis" + (layer.visible ? " on" : "")} onClick={(e) => { e.stopPropagation(); if (!busy) onChange({ ...layer, visible: !layer.visible }); }} data-tip={busy ? "Operación en curso" : layer.visible ? "Ocultar" : "Mostrar"}>
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </div>
        <div className="layer-info">
          <div className="layer-title-line">
            <GeomGlyph type={layer.geometry} color={layer.style.color} />
            <span className="layer-name">{layer.name}</span>
          </div>
          <div className="layer-meta">
            <span>{layer.geometry}</span><span>•</span>
            <span>{layer.geojson.features.length} feat.</span>
          </div>
        </div>
        {!readOnly && (
          <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" data-tip="Subir" disabled={busy || isFirst} onClick={() => onMove(-1)} style={{ opacity: busy || isFirst ? 0.4 : 1 }}>▲</button>
            <button className="icon-btn" data-tip="Bajar" disabled={busy || isLast} onClick={() => onMove(1)} style={{ opacity: busy || isLast ? 0.4 : 1 }}>▼</button>
            {canDelete && (
              <button className="icon-btn" data-tip="Eliminar" disabled={busy} onClick={onRemove}><Trash2 size={13} /></button>
            )}
            <button className="icon-btn" data-tip={expanded ? "Cerrar" : "Estilos"} disabled={busy} onClick={() => setExpanded(!expanded)}>
              <ChevronRight size={13} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
            </button>
          </div>
        )}
      </div>

      {!readOnly && !busy && expanded && (
        <div className="layer-expand">
          <StyleEditor layer={layer} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export default function LayersPanel({
  layers, activeId, onActive, onChange, onRemove, onMove, onOpenUpload, readOnly, canDelete,
  rasterLayers = [], onRasterChange, onRasterRemove, onRasterRetry, busyLayerIds, busyRasterIds,
}: {
  layers: GisLayer[];
  activeId: string | null;
  onActive: (id: string) => void;
  onChange: (l: GisLayer) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: number) => void;
  onOpenUpload: () => void;
  readOnly?: boolean;
  /** Delete buttons are gated separately: only ADMIN may delete layers. */
  canDelete?: boolean;
  rasterLayers?: RasterLayer[];
  onRasterChange?: (l: RasterLayer) => void;
  onRasterRemove?: (id: string) => void;
  onRasterRetry?: (id: string) => void;
  busyLayerIds?: ReadonlySet<string>;
  busyRasterIds?: ReadonlySet<string>;
}) {
  const total = layers.length + rasterLayers.length;
  return (
    <div className="left-rail">
      <div className="rail-header">
        <div>
          <div className="rail-title">Capas</div>
          <div className="rail-sub">{total} {total === 1 ? "capa" : "capas"} cargada{total === 1 ? "" : "s"}</div>
        </div>
        {!readOnly && (
          <button className="tb-btn primary" onClick={onOpenUpload} data-tip="Agregar capa (shapefile u ortofoto)">
            <Upload size={14} />
          </button>
        )}
      </div>

      <div className="layer-list">
        {total === 0 && (
          <div className="layer-empty">
            <b>Sin capas aún</b>
            {readOnly
              ? "Este mapa todavía no tiene capas publicadas."
              : "Arrastra un .shp / .zip (vector) o un .tif / .tiff (ortofoto) para comenzar."}
          </div>
        )}

        {layers.map((layer, idx) => (
          <LayerItem
            key={layer.id}
            layer={layer}
            active={layer.id === activeId}
            isFirst={idx === 0}
            isLast={idx === layers.length - 1}
            readOnly={readOnly}
            canDelete={canDelete}
            busy={busyLayerIds?.has(layer.id)}
            onClick={() => onActive(layer.id)}
            onChange={onChange}
            onRemove={() => onRemove(layer.id)}
            onMove={(d) => onMove(layer.id, d)}
          />
        ))}
      </div>

      {rasterLayers.length > 0 && (
        <div className="layer-list" style={{ borderTop: "1px solid var(--border)" }}>
          <div style={{ padding: "8px 12px 4px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted-fg)" }}>
            Ortofotos
          </div>
          {rasterLayers.map((r) => (
            <RasterItem
              key={r.id}
              layer={r}
              readOnly={readOnly}
              canDelete={canDelete}
              busy={busyRasterIds?.has(r.id)}
              onChange={(l) => onRasterChange?.(l)}
              onRemove={() => onRasterRemove?.(r.id)}
              onRetry={() => onRasterRetry?.(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
