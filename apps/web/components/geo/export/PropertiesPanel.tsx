"use client";

import { Eye, EyeOff, Info, SlidersHorizontal } from "lucide-react";

import type {
  BuilderOptions,
  BuilderState,
  IndicatorVisibility,
  LocatorLevel,
  ScaleBarStyle,
  ToggleId,
} from "./types";
import { BLOCK_NAMES, parentBlock } from "./types";

export interface PropertyLegendLayer {
  id: string;
  label: string;
}

interface PropertiesPanelProps {
  state: BuilderState;
  legendLayers: readonly PropertyLegendLayer[];
  hasElevationData: boolean;
  hasLandCoverData: boolean;
  hasSelection: boolean;
  collapsed?: boolean;
  onText: (key: string, value: string) => void;
  onOptions: (patch: Partial<BuilderOptions>) => void;
  onToggle: (id: ToggleId) => void;
  onExtent: (extent: BuilderState["extent"]) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  );
}

const inputClass = "h-[30px] w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none transition-shadow focus:border-teal-500 focus:ring-2 focus:ring-teal-100";
const textareaClass = "min-h-[70px] w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-4 text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100";

function PropertySwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">
      <span>{label}</span>
      <span className={`relative h-[15px] w-[26px] flex-shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-teal-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 h-[11px] w-[11px] rounded-full bg-white shadow-sm transition-[left] duration-150 ${checked ? "left-[13px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Segments<T extends string>({ value, options, onChange }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${value === option.value ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function EmptyDataNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-[11.5px] leading-4 text-slate-500">
      <Info className="mb-1.5 h-4 w-4 text-slate-400" />
      {children}
    </div>
  );
}

const DOC_TEXT_KEYS: Partial<Record<ToggleId, string>> = {
  doc_elaborado: "elaborado",
  doc_revisado: "revisado",
  doc_fecha: "fecha",
  doc_fuente: "fuente",
  doc_precision: "precision",
  doc_notas: "notas",
};

export default function PropertiesPanel({
  state,
  legendLayers,
  hasElevationData,
  hasLandCoverData,
  hasSelection,
  collapsed = false,
  onText,
  onOptions,
  onToggle,
  onExtent,
}: PropertiesPanelProps) {
  if (collapsed) {
    return (
      <aside className="flex w-12 flex-shrink-0 justify-center border-l border-slate-200 bg-white pt-4" aria-label="Propiedades">
        <SlidersHorizontal className="h-4 w-4 text-slate-400" />
      </aside>
    );
  }

  const selected = state.selected;
  const block = selected ? parentBlock(selected) : null;
  const docKey = selected ? DOC_TEXT_KEYS[selected] : undefined;

  return (
    <aside className="flex w-[292px] flex-shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white" aria-label="Propiedades del elemento">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[12.5px] font-semibold text-slate-900">Propiedades</h2>
            {block && <span className="rounded-full border border-teal-100 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">{BLOCK_NAMES[block]}</span>}
          </div>
        </div>

        {!selected || !block ? (
          <div className="px-4 py-6">
            <SlidersHorizontal className="mb-3 h-6 w-6 text-slate-300" />
            <p className="text-xs leading-[1.55] text-slate-400">Selecciona un elemento en la hoja o en el panel izquierdo para editar sus propiedades.</p>
          </div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            {(selected === "header" || selected === "hdr_titulo") && (
              <>
                <Field label="Título"><input className={inputClass} value={state.texts.titulo ?? ""} onChange={(event) => onText("titulo", event.target.value)} /></Field>
                <Field label={`Tamaño · ${state.options.titleSize} pt`}><input type="range" min={14} max={32} value={state.options.titleSize} onChange={(event) => onOptions({ titleSize: Number(event.target.value) })} className="w-full accent-teal-600" /></Field>
                <Field label="Alineación">
                  <Segments value={state.options.titleAlign} options={[{ value: "left", label: "Izquierda" }, { value: "center", label: "Centro" }, { value: "right", label: "Derecha" }]} onChange={(titleAlign) => onOptions({ titleAlign })} />
                </Field>
                <PropertySwitch label="Título en negrita" checked={state.options.titleBold} onChange={() => onOptions({ titleBold: !state.options.titleBold })} />
              </>
            )}

            {selected === "header" && (
              <>
                <Field label="Institución"><input className={inputClass} value={state.texts.institucion ?? ""} onChange={(event) => onText("institucion", event.target.value)} /></Field>
                <Field label="Unidad"><input className={inputClass} value={state.texts.unidad ?? ""} onChange={(event) => onText("unidad", event.target.value)} /></Field>
              </>
            )}

            {selected === "hdr_subtitulo" && <Field label="Subtítulo"><textarea className={textareaClass} value={state.texts.subtitulo ?? ""} onChange={(event) => onText("subtitulo", event.target.value)} /></Field>}
            {selected === "hdr_logo" && <Field label={`Tamaño del logo · ${state.options.logoSize} mm`}><input type="range" min={8} max={24} value={state.options.logoSize} onChange={(event) => onOptions({ logoSize: Number(event.target.value) })} className="w-full accent-teal-600" /></Field>}
            {selected === "hdr_norte" && <PropertySwitch label="Mostrar flecha norte" checked={state.visible.hdr_norte} onChange={() => onToggle("hdr_norte")} />}

            {block === "map" && (
              <>
                <Field label="Extensión">
                  <select className={inputClass} value={state.extent} onChange={(event) => onExtent(event.target.value as BuilderState["extent"])}>
                    <option value="actual">Vista actual</option>
                    <option value="capas">Capas visibles</option>
                    <option value="seleccion">Selección</option>
                    <option value="geometria">Geometría de estudio</option>
                  </select>
                </Field>
                <PropertySwitch label="Marco de coordenadas" checked={state.visible.map_coords} onChange={() => onToggle("map_coords")} />
                <Field label="Densidad de retícula">
                  <Segments value={state.options.gridDensity} options={[{ value: "baja", label: "Baja" }, { value: "media", label: "Media" }, { value: "alta", label: "Alta" }]} onChange={(gridDensity) => onOptions({ gridDensity })} />
                </Field>
                {state.extent === "seleccion" && !hasSelection && (
                  <EmptyDataNotice>No hay una geometría seleccionada; se conservará la extensión de la vista actual.</EmptyDataNotice>
                )}
                {state.extent === "geometria" && (
                  <EmptyDataNotice>No hay una geometría de estudio asociada; se conservará la extensión de la vista actual.</EmptyDataNotice>
                )}
                <div className="rounded-lg border border-teal-100 bg-teal-50 p-2.5 text-[11px] leading-4 text-teal-800">El mapa es estructural: su tamaño lo calcula el sistema y no puede ocultarse ni moverse.</div>
              </>
            )}

            {block === "legend" && (
              <>
                <Field label="Título"><input className={inputClass} value={state.texts.legendTitle ?? "LEYENDA"} onChange={(event) => onText("legendTitle", event.target.value)} /></Field>
                <Field label="Columnas"><Segments value={String(state.options.legendColumns) as "1" | "2"} options={[{ value: "1", label: "1 columna" }, { value: "2", label: "2 columnas" }]} onChange={(value) => onOptions({ legendColumns: Number(value) as 1 | 2 })} /></Field>
                <Field label={`Capas incluidas · ${legendLayers.length - state.options.legendExcludedLayerIds.length} de ${legendLayers.length}`}>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
                    {legendLayers.length ? legendLayers.map((layer) => {
                      const included = !state.options.legendExcludedLayerIds.includes(layer.id);
                      return <button type="button" key={layer.id} onClick={() => onOptions({ legendExcludedLayerIds: included ? [...state.options.legendExcludedLayerIds, layer.id] : state.options.legendExcludedLayerIds.filter((id) => id !== layer.id) })} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${included ? "text-slate-700 hover:bg-slate-50" : "text-slate-400"}`}>{included ? <Eye className="h-3.5 w-3.5 flex-shrink-0 text-teal-600" /> : <EyeOff className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />}<span className="truncate">{layer.label}</span></button>;
                    }) : <p className="p-2 text-[11px] text-slate-400">No hay capas visibles.</p>}
                  </div>
                </Field>
              </>
            )}

            {block === "locator" && (
              <>
                <Field label="Niveles territoriales">
                  <div className="flex flex-wrap gap-1.5">
                    {(["ecuador", "galapagos", "santacruz"] as LocatorLevel[]).map((level) => {
                      const active = state.options.locatorLevels.includes(level);
                      const label = level === "ecuador" ? "Ecuador" : level === "galapagos" ? "Galápagos" : "Santa Cruz";
                      return <button type="button" key={level} onClick={() => onOptions({ locatorLevels: active ? state.options.locatorLevels.filter((item) => item !== level) : [...state.options.locatorLevels, level] })} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${active ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500"}`}>{label}</button>;
                    })}
                  </div>
                </Field>
                <PropertySwitch label="Etiquetas" checked={state.options.locatorLabels} onChange={() => onOptions({ locatorLabels: !state.options.locatorLabels })} />
                <PropertySwitch label="Bordes" checked={state.options.locatorBorder} onChange={() => onOptions({ locatorBorder: !state.options.locatorBorder })} />
                <EmptyDataNotice>Los GeoJSON territoriales no están disponibles; el bloque conserva un estado vacío listo para recibirlos.</EmptyDataNotice>
              </>
            )}

            {block === "indicators" && (
              <Field label="Tarjetas visibles">
                <div className="space-y-1.5">
                  {(Object.entries({ escala: "Escala", area: "Área", precision: "Precisión", hoja: "Hoja" }) as [keyof IndicatorVisibility, string][]).map(([key, label]) => (
                    <PropertySwitch key={key} label={label} checked={state.options.indicators[key]} onChange={() => onOptions({ indicators: { ...state.options.indicators, [key]: !state.options.indicators[key] } })} />
                  ))}
                </div>
              </Field>
            )}

            {block === "elevation" && (
              <>
                {!hasElevationData && <EmptyDataNotice>No hay un servicio de elevación conectado a este mapa. El PDF mostrará un estado vacío legible.</EmptyDataNotice>}
                <button type="button" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => onToggle("elevation")}>Ocultar componente</button>
              </>
            )}

            {block === "landcover" && !hasLandCoverData && <EmptyDataNotice>No existe un análisis de cobertura asociado al mapa. El módulo permanece listo para futuros resultados.</EmptyDataNotice>}

            {block === "scalebar" && (
              <Field label="Estilo de escala">
                <Segments value={state.options.scaleStyle} options={(["barras", "linea", "bloque"] as ScaleBarStyle[]).map((value) => ({ value, label: value === "barras" ? "Barras" : value === "linea" ? "Línea" : "Bloque" }))} onChange={(scaleStyle) => onOptions({ scaleStyle })} />
              </Field>
            )}

            {block === "scalenum" && <Field label="Escala numérica"><input className={inputClass} value={state.texts.escala ?? ""} onChange={(event) => onText("escala", event.target.value)} /></Field>}

            {block === "refsys" && (
              <>
                <Field label="Sistema de coordenadas"><input className={inputClass} value={state.texts.srs ?? ""} onChange={(event) => onText("srs", event.target.value)} /></Field>
                <Field label="Datum"><input className={inputClass} value={state.texts.datum ?? ""} onChange={(event) => onText("datum", event.target.value)} /></Field>
                <Field label="Unidades"><input className={inputClass} value={state.texts.unidades ?? ""} onChange={(event) => onText("unidades", event.target.value)} /></Field>
              </>
            )}

            {block === "techinfo" && (
              <>
                <Field label="Escala"><input className={inputClass} value={state.texts.escala ?? ""} onChange={(event) => onText("escala", event.target.value)} /></Field>
                <Field label="Área"><input className={inputClass} value={state.texts.area ?? ""} onChange={(event) => onText("area", event.target.value)} /></Field>
                <Field label="Hoja"><input className={inputClass} value={state.texts.hoja ?? ""} onChange={(event) => onText("hoja", event.target.value)} /></Field>
                <Field label="Código"><input className={inputClass} value={state.texts.codigo ?? ""} onChange={(event) => onText("codigo", event.target.value)} /></Field>
              </>
            )}

            {block === "docs" && docKey && (
              <Field label={selected === "doc_notas" ? "Notas" : selected === "doc_fuente" ? "Fuente" : selected === "doc_fecha" ? "Fecha" : selected === "doc_revisado" ? "Revisado por" : selected === "doc_elaborado" ? "Elaborado por" : "Precisión"}>
                {selected === "doc_notas" ? <textarea className={textareaClass} value={state.texts[docKey] ?? ""} onChange={(event) => onText(docKey, event.target.value)} /> : <input className={inputClass} value={state.texts[docKey] ?? ""} onChange={(event) => onText(docKey, event.target.value)} />}
              </Field>
            )}

            {block === "docs" && selected !== "docs" && !docKey && (
              <PropertySwitch label="Mostrar campo" checked={state.visible[selected]} onChange={() => onToggle(selected)} />
            )}

            {selected === "docs" && (
              <>
                <Field label="Elaborado por"><input className={inputClass} value={state.texts.elaborado ?? ""} onChange={(event) => onText("elaborado", event.target.value)} /></Field>
                <Field label="Revisado por"><input className={inputClass} value={state.texts.revisado ?? ""} onChange={(event) => onText("revisado", event.target.value)} /></Field>
                <Field label="Fecha"><input className={inputClass} value={state.texts.fecha ?? ""} onChange={(event) => onText("fecha", event.target.value)} /></Field>
                <Field label="Fuente"><textarea className={textareaClass} value={state.texts.fuente ?? ""} onChange={(event) => onText("fuente", event.target.value)} /></Field>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
