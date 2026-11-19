"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Trash2, ChevronRight, Upload, RotateCcw } from "lucide-react";
import { COLOR_RAMPS } from "./gis-data";
import { inferSchema } from "./charts";
import GeomGlyph from "./GeomGlyph";
import type { GisLayer, LayerStyle, RasterLayer, RasterStatus } from "./types";
import { buildSymbolizer, styleExtras, withExtras, type MarkerShape, type StyleCategory, type SymbolSpec } from "./symbology";
import SymbolSwatch from "./SymbolSwatch";

const RASTER_STATUS: Record<RasterStatus, { text: string; color: string }> = {
  uploaded: { text: "En cola", color: "#6e5a2c" },
  queued: { text: "En cola", color: "#6e5a2c" },
  processing: { text: "Procesando…", color: "#2c5481" },
  processed: { text: "Listo", color: "#3f7c5f" },
  deleting: { text: "Eliminando…", color: "#64748b" },
  error: { text: "Error", color: "#9d4636" },
};

// One orthophoto row: status badge, opacity (when ready), retry (on error).
function RasterItem({ layer, readOnly, canDelete, workspaceMode, isFirst, isLast, busy = false, onChange, onRemove, onRetry, onMove }: {
  layer: RasterLayer; readOnly?: boolean; canDelete?: boolean; busy?: boolean;
  workspaceMode?: boolean; isFirst: boolean; isLast: boolean;
  onChange: (l: RasterLayer) => void; onRemove: () => void; onRetry: () => void; onMove: (direction: number) => void;
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
            {layer.workspaceSource?.mapTitle && <><span>•</span><span title={layer.workspaceSource.mapTitle}>{layer.workspaceSource.mapTitle}</span></>}
          </div>
        </div>
        {!readOnly && (
          <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
            {workspaceMode && <>
              <button className="icon-btn" data-tip="Subir" disabled={deleting || isFirst} onClick={() => onMove(-1)} style={{ opacity: deleting || isFirst ? 0.4 : 1 }}>▲</button>
              <button className="icon-btn" data-tip="Bajar" disabled={deleting || isLast} onClick={() => onMove(1)} style={{ opacity: deleting || isLast ? 0.4 : 1 }}>▼</button>
            </>}
            {layer.status === "error" && (
              <button className="icon-btn" data-tip="Reintentar" disabled={deleting} onClick={onRetry}><RotateCcw size={13} /></button>
            )}
            {canDelete && (
              <button className="icon-btn" data-tip={workspaceMode ? "Quitar del Workspace" : "Eliminar"} disabled={deleting} onClick={onRemove}><Trash2 size={13} /></button>
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
// Symbol details (symbology.ts extras): per-class symbols, outline, dashes,
// casing, marker shape and label look.
// ────────────────────────────────────────────────────────────
const MAX_CLASS_ROWS = 40;
const DASHES: Array<[string, string]> = [["", "Continuo"], ["6 3", "Guiones"], ["1 3", "Puntos"], ["8 3 1 3", "Guion y punto"]];
const SHAPES: Array<[MarkerShape, string]> = [["circle", "Círculo"], ["square", "Cuadrado"], ["triangle", "Triángulo"], ["diamond", "Rombo"]];

/** <input type="color"> only takes #rrggbb. */
function hex6(color: string | null | undefined, fallback = "#333333"): string {
  const c = color || fallback;
  return /^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
}

function cleanSpec<T extends object>(spec: T): T {
  return Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) as T;
}

/**
 * A layer-wide control applies to every class: the classes and the "other
 * values" symbol drop their own value of the keys it sets.
 */
function applyToAllClasses(style: LayerStyle, keys: Array<keyof SymbolSpec>): LayerStyle {
  const extras = styleExtras(style);
  const strip = <T extends SymbolSpec>(spec: T): T => {
    const next = { ...spec };
    for (const k of keys) delete next[k];
    return next;
  };
  return withExtras(style, {
    categories: extras.categories ? extras.categories.map(strip) : extras.categories,
    otherSymbol: extras.otherSymbol ? strip(extras.otherSymbol) : extras.otherSymbol,
    symbol: extras.symbol && (keys.includes("strokeWidth") || keys.includes("size")) ? strip(extras.symbol) : extras.symbol,
  });
}

function ColorDot({ value, onChange, tip }: { value: string; onChange: (c: string) => void; tip: string }) {
  return (
    <label className="swatch" style={{ background: value, position: "relative" }} data-tip={tip}>
      <input type="color" value={hex6(value)} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
    </label>
  );
}

function ClassList({ layer, onChange }: { layer: GisLayer; onChange: (l: GisLayer) => void }) {
  const { classes } = buildSymbolizer(layer);
  const extras = styleExtras(layer.style);
  const custom = !!extras.categories?.length;
  const editable = classes.filter((c) => !c.other);
  const line = layer.geometry === "LineString";

  // The first edit turns the palette colors into explicit classes.
  const materialize = (): StyleCategory[] =>
    custom ? extras.categories!.map((c) => ({ ...c })) : editable.map((c) => ({ value: c.key, color: c.symbol.color }));
  const update = (key: string, patch: Partial<StyleCategory>) => {
    const cats = materialize();
    let i = cats.findIndex((c) => c.value === key);
    if (i < 0) { cats.push({ value: key }); i = cats.length - 1; }
    cats[i] = cleanSpec({ ...cats[i], ...patch });
    onChange({ ...layer, style: withExtras(layer.style, { categories: cats }) });
  };

  return (
    <div className="style-section">
      <div className="style-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Clases ({editable.length})</span>
        {custom && (
          <button className="link-btn" style={{ fontSize: 11, background: "none", border: 0, color: "var(--muted-fg)", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => onChange({ ...layer, style: withExtras(layer.style, { categories: null, otherSymbol: null }) })}>
            Volver a la paleta
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
        {classes.slice(0, MAX_CLASS_ROWS).map((c) => (
          <div key={c.key} style={{ display: "grid", gridTemplateColumns: `20px minmax(0, 1fr) ${line ? "46px " : ""}34px`, gap: 6, alignItems: "center" }}>
            {c.other ? (
              <SymbolSwatch symbol={c.symbol} width={20} height={15} />
            ) : (
              <label style={{ position: "relative", cursor: "pointer" }} data-tip="Color de la clase">
                <SymbolSwatch symbol={c.symbol} width={20} height={15} />
                <input type="color" value={hex6(c.symbol.color)} onChange={(e) => update(c.key, { color: e.target.value })}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
              </label>
            )}
            {c.other ? (
              <span style={{ fontSize: 11.5, color: "var(--muted-fg)" }}>{c.label}</span>
            ) : (
              <input
                key={`${c.key}:${c.label}`}
                className="field-input"
                defaultValue={c.label}
                title={`Valor: ${c.key || "(vacío)"}`}
                style={{ fontSize: 11.5, padding: "3px 6px" }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== c.label) update(c.key, { label: v && v !== c.key ? v : undefined }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
            )}
            {line && (
              c.other ? <span /> : (
                <input type="number" className="field-input" min={0} max={20} step={0.5} value={c.symbol.strokeWidth}
                  data-tip="Grosor (px)" style={{ fontSize: 11.5, padding: "3px 4px" }}
                  onChange={(e) => { const w = parseFloat(e.target.value); if (Number.isFinite(w) && w >= 0 && w <= 20) update(c.key, { strokeWidth: w }); }} />
              )
            )}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-fg)", textAlign: "right" }}>{c.count}</span>
          </div>
        ))}
      </div>
      {classes.length > MAX_CLASS_ROWS && (
        <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 4 }}>Se muestran {MAX_CLASS_ROWS} de {classes.length} clases.</div>
      )}
    </div>
  );
}

function SymbolControls({ layer, onChange }: { layer: GisLayer; onChange: (l: GisLayer) => void }) {
  const sym: SymbolSpec = styleExtras(layer.style).symbol ?? {};
  const base = buildSymbolizer(layer).classes[0]?.symbol;
  const setSymbol = (patch: Partial<SymbolSpec>) => {
    const next = cleanSpec({ ...sym, ...patch });
    const style = applyToAllClasses(layer.style, Object.keys(patch) as Array<keyof SymbolSpec>);
    onChange({ ...layer, style: withExtras(style, { symbol: Object.keys(next).length ? next : null }) });
  };
  const dashSelect = (
    <select className="field-select" value={sym.dash ?? ""} onChange={(e) => setSymbol({ dash: e.target.value || undefined })}>
      {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      {sym.dash && !DASHES.some(([v]) => v === sym.dash) && <option value={sym.dash}>Personalizado ({sym.dash})</option>}
    </select>
  );

  if (layer.geometry === "Polygon") {
    const outline = sym.strokeColor !== null;
    // With classes that share one fill opacity, show theirs (the slider sets it for all).
    const classFills = Array.from(new Set((styleExtras(layer.style).categories ?? []).map((c) => c.fillOpacity)));
    const fill = sym.fillOpacity ?? (classFills.length === 1 && classFills[0] !== undefined ? classFills[0] : 0.78);
    return (
      <>
        <div className="style-section">
          <div className="style-label">Relleno: {Math.round(fill * 100)}%</div>
          <div className="slider-row">
            <input type="range" min="0" max="100" value={Math.round(fill * 100)} onChange={(e) => setSymbol({ fillOpacity: parseInt(e.target.value) / 100 })} />
            <div className="slider-val">{Math.round(fill * 100)}%</div>
          </div>
        </div>
        <div className="style-section">
          <div className="style-label">Contorno</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={outline} onChange={(e) => setSymbol({ strokeColor: e.target.checked ? undefined : null })} />
              Dibujar
            </label>
            {outline && <ColorDot value={sym.strokeColor ?? base?.strokeColor ?? "#333333"} onChange={(c) => setSymbol({ strokeColor: c })} tip="Color del contorno" />}
          </div>
          {outline && <div style={{ marginTop: 6 }}>{dashSelect}</div>}
        </div>
      </>
    );
  }

  if (layer.geometry === "LineString") {
    const casing = !!sym.casingColor;
    return (
      <>
        <div className="style-section">
          <div className="style-label">Trazo</div>
          {dashSelect}
        </div>
        <div className="style-section">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <input type="checkbox" checked={casing} onChange={(e) => setSymbol(e.target.checked
              ? { casingColor: "#555555", casingWidth: (base?.strokeWidth ?? 2) + 2 }
              : { casingColor: undefined, casingWidth: undefined })} />
            Doble trazo (borde de la línea)
          </label>
          {casing && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <ColorDot value={sym.casingColor!} onChange={(c) => setSymbol({ casingColor: c })} tip="Color del borde" />
              <div className="slider-row" style={{ flex: 1 }}>
                <input type="range" min="1" max="14" step="0.5" value={sym.casingWidth ?? 4} onChange={(e) => setSymbol({ casingWidth: parseFloat(e.target.value) })} />
                <div className="slider-val">{sym.casingWidth ?? 4}px</div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  const backdrop = !!sym.haloColor;
  return (
    <>
      <div className="style-section">
        <div className="style-label">Forma</div>
        <div className="tab-row">
          {SHAPES.map(([shape, label]) => (
            <button key={shape} className={(sym.marker ?? "circle") === shape ? "active" : ""} onClick={() => setSymbol({ marker: shape === "circle" ? undefined : shape })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="style-section">
        <div className="style-label">Contorno y fondo</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <ColorDot value={sym.strokeColor ?? "#ffffff"} onChange={(c) => setSymbol({ strokeColor: c })} tip="Color del contorno" />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={backdrop} onChange={(e) => setSymbol(e.target.checked
              ? { haloColor: "#ffffff", haloOpacity: 0.67, haloSize: Math.round((base?.size ?? 12) * 1.6) }
              : { haloColor: undefined, haloOpacity: undefined, haloSize: undefined })} />
            Círculo de fondo
          </label>
          {backdrop && <ColorDot value={sym.haloColor!} onChange={(c) => setSymbol({ haloColor: c })} tip="Color del fondo" />}
        </div>
      </div>
    </>
  );
}

const LABEL_ZOOMS = [null, 10, 11, 12, 13, 14, 15, 16, 17] as const;

function LabelControls({ layer, onChange }: { layer: GisLayer; onChange: (l: GisLayer) => void }) {
  const ls = styleExtras(layer.style).labelStyle ?? {};
  const set = (patch: Partial<typeof ls>) => {
    const next = cleanSpec({ ...ls, ...patch });
    onChange({ ...layer, style: withExtras(layer.style, { labelStyle: Object.keys(next).length ? next : null }) });
  };
  const halo = ls.haloColor !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <ColorDot value={ls.color ?? "#1a1a1a"} onChange={(c) => set({ color: c })} tip="Color del texto" />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={halo} onChange={(e) => set({ haloColor: e.target.checked ? undefined : null })} />
          Halo
        </label>
        {halo && <ColorDot value={ls.haloColor ?? "#ffffff"} onChange={(c) => set({ haloColor: c })} tip="Color del halo" />}
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={ls.bold ?? true} onChange={(e) => set({ bold: e.target.checked ? undefined : false })} />
          Negrita
        </label>
      </div>
      <div className="slider-row">
        <input type="range" min="8" max="16" step="0.5" value={ls.size ?? 10.5} onChange={(e) => set({ size: parseFloat(e.target.value) })} />
        <div className="slider-val">{ls.size ?? 10.5}px</div>
      </div>
      <select className="field-select" value={ls.minZoom ?? ""} onChange={(e) => set({ minZoom: e.target.value ? Number(e.target.value) : undefined })}>
        {LABEL_ZOOMS.map((z) => <option key={z ?? "all"} value={z ?? ""}>{z === null ? "Visibles a cualquier zoom" : `Desde el zoom ${z}`}</option>)}
        {ls.minZoom != null && !LABEL_ZOOMS.includes(ls.minZoom as never) && <option value={ls.minZoom}>Desde el zoom {ls.minZoom}</option>}
      </select>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Style Editor (per layer, lives inside the layer list expand)
// ────────────────────────────────────────────────────────────
function StyleEditor({ layer, onChange }: { layer: GisLayer; onChange: (l: GisLayer) => void }) {
  const schema = inferSchema(layer.geojson.features);
  const numericCols = schema.filter((c) => c.type === "numeric");
  const catCols = schema.filter((c) => c.type === "categorical" || c.type === "boolean" || c.type === "numeric");

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
            <select className="field-select" value={layer.style.colorBy || ""} onChange={(e) => onChange({ ...layer, style: withExtras({ ...layer.style, colorBy: e.target.value }, { categories: null, otherSymbol: null }) })}>
              {catCols.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
          </div>
          <div className="style-section">
            <div className="style-label">Paleta categórica{styleExtras(layer.style).categories?.length ? " (las clases tienen colores propios)" : ""}</div>
            <div className="ramp-row" style={{ opacity: styleExtras(layer.style).categories?.length ? 0.45 : 1 }}>
              {["categorical", "viridis", "earth"].map((name) => (
                <div key={name} className={"ramp" + (layer.style.palette === name ? " selected" : "")} onClick={() => onChange({ ...layer, style: withExtras({ ...layer.style, palette: name }, { categories: null }) })}>
                  {COLOR_RAMPS[name].slice(0, 7).map((c, i) => <span key={i} style={{ background: c }} />)}
                </div>
              ))}
            </div>
          </div>
          {layer.style.colorBy && <ClassList layer={layer} onChange={onChange} />}
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
            <input type="range" min="3" max="14" value={layer.style.size} onChange={(e) => onChange({ ...layer, style: { ...applyToAllClasses(layer.style, ["size"]), size: parseInt(e.target.value) } })} />
          ) : (
            <input type="range" min="0" max="4" step="0.5" value={layer.style.strokeWidth} onChange={(e) => onChange({ ...layer, style: { ...applyToAllClasses(layer.style, ["strokeWidth"]), strokeWidth: parseFloat(e.target.value) } })} />
          )}
          <div className="slider-val">{layer.geometry === "Point" ? layer.style.size : layer.style.strokeWidth}</div>
        </div>
      </div>

      <SymbolControls layer={layer} onChange={onChange} />

      {/* Labels toggle */}
      <div className="style-section">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <input type="checkbox" checked={!!layer.style.labels} onChange={(e) => setStyle({ labels: e.target.checked })} />
          Mostrar etiquetas
        </label>
        {layer.style.labels && (
          <>
            <select className="field-select" value={layer.style.labelField || ""} onChange={(e) => setStyle({ labelField: e.target.value })}>
              {schema.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
            <LabelControls layer={layer} onChange={onChange} />
          </>
        )}
      </div>
    </>
  );
}

function LayerItem({ layer, active, isFirst, isLast, readOnly, canDelete, workspaceMode, busy = false, onClick, onChange, onRemove, onMove }: {
  layer: GisLayer; active: boolean; isFirst: boolean; isLast: boolean; readOnly?: boolean; canDelete?: boolean; busy?: boolean;
  workspaceMode?: boolean;
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
            {layer.workspaceSource?.mapTitle && <><span>•</span><span title={layer.workspaceSource.mapTitle}>{layer.workspaceSource.mapTitle}</span></>}
          </div>
        </div>
        {!readOnly && (
          <div className="layer-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" data-tip="Subir" disabled={busy || isFirst} onClick={() => onMove(-1)} style={{ opacity: busy || isFirst ? 0.4 : 1 }}>▲</button>
            <button className="icon-btn" data-tip="Bajar" disabled={busy || isLast} onClick={() => onMove(1)} style={{ opacity: busy || isLast ? 0.4 : 1 }}>▼</button>
            {canDelete && (
              <button className="icon-btn" data-tip={workspaceMode ? "Quitar del Workspace" : "Eliminar"} disabled={busy} onClick={onRemove}><Trash2 size={13} /></button>
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
  rasterLayers = [], onRasterChange, onRasterRemove, onRasterRetry, onRasterMove, busyLayerIds, busyRasterIds, workspaceMode,
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
  workspaceMode?: boolean;
  rasterLayers?: RasterLayer[];
  onRasterChange?: (l: RasterLayer) => void;
  onRasterRemove?: (id: string) => void;
  onRasterRetry?: (id: string) => void;
  onRasterMove?: (id: string, direction: number) => void;
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
          <button className="tb-btn primary" onClick={onOpenUpload} data-tip={workspaceMode ? "Agregar desde el catálogo SIGTAR" : "Agregar capa (shapefile u ortofoto)"}>
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
              : workspaceMode
                ? "Agrega capas publicadas desde cualquier mapa del SIGTAR."
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
            workspaceMode={workspaceMode}
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
          {rasterLayers.map((r, index) => (
            <RasterItem
              key={r.id}
              layer={r}
              isFirst={index === 0}
              isLast={index === rasterLayers.length - 1}
              readOnly={readOnly}
              canDelete={canDelete}
              workspaceMode={workspaceMode}
              busy={busyRasterIds?.has(r.id)}
              onChange={(l) => onRasterChange?.(l)}
              onRemove={() => onRasterRemove?.(r.id)}
              onRetry={() => onRasterRetry?.(r.id)}
              onMove={(direction) => onRasterMove?.(r.id, direction)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
