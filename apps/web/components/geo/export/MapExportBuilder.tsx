"use client";

import type { Feature } from "geojson";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import type { GisLayer, RasterLayer } from "@/components/geo/gis/types";
import { buildGeoExportData, type GeoBounds } from "@/lib/geo-export-data";
import type { GeoMap } from "@/types/geo";

import Canvas from "./Canvas";
import ElementsPanel from "./ElementsPanel";
import ExportMapPreview, { type ExportMapView } from "./ExportMapPreview";
import PropertiesPanel from "./PropertiesPanel";
import Toolbar from "./Toolbar";
import { exportMapPdf } from "./pdf";
import { applyTemplate, templateVisibility } from "./templates";
import type { BlockId, BuilderOptions, BuilderState, Format, Mode, Orientation, Rect, TemplateId, ToggleId } from "./types";
import { createDefaultBuilderOptions, parentBlock } from "./types";
import { getExportWarnings } from "./warnings";

export interface MapExportBuilderProps {
  geoMap: GeoMap;
  vectorLayers: GisLayer[];
  rasterLayers: RasterLayer[];
  view: ExportMapView;
  sourceMapElement?: HTMLElement | null;
  selectedFeature?: Feature | null;
  onClose: () => void;
}

interface HistoryState {
  present: BuilderState;
  past: BuilderState[];
  future: BuilderState[];
}

type Action =
  | { type: "commit"; mutate: (state: BuilderState) => BuilderState }
  | { type: "update"; mutate: (state: BuilderState) => BuilderState }
  | { type: "snapshot" }
  | { type: "undo" }
  | { type: "redo" };

function cloneState(state: BuilderState): BuilderState {
  return {
    ...state,
    visible: { ...state.visible },
    overrides: Object.fromEntries(Object.entries(state.overrides).map(([key, rect]) => [key, rect ? { ...rect } : rect])),
    texts: { ...state.texts },
    options: {
      ...state.options,
      legendExcludedLayerIds: [...state.options.legendExcludedLayerIds],
      locatorLevels: [...state.options.locatorLevels],
      indicators: { ...state.options.indicators },
    },
  };
}

function historyReducer(history: HistoryState, action: Action): HistoryState {
  if (action.type === "undo") {
    const previous = history.past.at(-1);
    if (!previous) return history;
    return { present: cloneState(previous), past: history.past.slice(0, -1), future: [...history.future, cloneState(history.present)].slice(-40) };
  }
  if (action.type === "redo") {
    const next = history.future.at(-1);
    if (!next) return history;
    return { present: cloneState(next), past: [...history.past, cloneState(history.present)].slice(-40), future: history.future.slice(0, -1) };
  }
  if (action.type === "snapshot") {
    return { ...history, past: [...history.past, cloneState(history.present)].slice(-40), future: [] };
  }
  const next = action.mutate(cloneState(history.present));
  if (action.type === "update") return { ...history, present: next };
  return { present: next, past: [...history.past, cloneState(history.present)].slice(-40), future: [] };
}

function initialTexts(geoMap: GeoMap, scaleLabel: string, areaLabel: string): Record<string, string> {
  return {
    institucion: "Consejo de Gobierno del Régimen Especial de Galápagos",
    unidad: "Dirección de Gestión Territorial",
    titulo: geoMap.title || "MAPA TÉCNICO GEOGRÁFICO",
    subtitulo: geoMap.description || geoMap.thematic || "Geoportal institucional",
    sistema: "DGTAR · Sistema de Información Territorial",
    legendTitle: "LEYENDA",
    escala: scaleLabel,
    area: areaLabel,
    precision: "Según fuente",
    hoja: "1 de 1",
    codigo: `GEO-${geoMap.id.slice(0, 8).toUpperCase()}`,
    srs: "WGS 84 / UTM Zona 15S",
    datum: "WGS 84",
    unidades: "Metros",
    elaborado: "Dirección de Gestión Territorial",
    revisado: "",
    fecha: new Intl.DateTimeFormat("es-EC", { month: "long", year: "numeric" }).format(new Date()),
    fuente: "Capas visibles del Geoportal institucional · Límites territoriales: INEC, DPA 2020",
    notas: "Las coordenadas y la escala están referidas a la vista cartográfica exportada.",
  };
}

function toGeoBounds(view: ExportMapView): GeoBounds | undefined {
  if (!view.bounds) return undefined;
  return { north: view.bounds.north, south: view.bounds.south, east: view.bounds.east, west: view.bounds.west };
}

function selectedFeatureBounds(feature: Feature | null | undefined): GeoBounds | undefined {
  if (!feature?.geometry || !("coordinates" in feature.geometry)) return undefined;
  let bounds: GeoBounds | undefined;
  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      const longitude = coordinates[0];
      const latitude = coordinates[1];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      bounds = bounds
        ? { north: Math.max(bounds.north, latitude), south: Math.min(bounds.south, latitude), east: Math.max(bounds.east, longitude), west: Math.min(bounds.west, longitude) }
        : { north: latitude, south: latitude, east: longitude, west: longitude };
      return;
    }
    coordinates.forEach(visit);
  };
  visit(feature.geometry.coordinates);
  return bounds;
}

export default function MapExportBuilder({ geoMap, vectorLayers, rasterLayers, view, sourceMapElement, selectedFeature, onClose }: MapExportBuilderProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const initialData = useMemo(() => buildGeoExportData({ geoMap, vectorLayers, rasterLayers, center: view.center, zoom: view.zoom, bounds: toGeoBounds(view), viewportWidthPx: 1200 }), [geoMap, rasterLayers, vectorLayers, view]);
  const [history, dispatch] = useReducer(historyReducer, null, (): HistoryState => ({
    present: {
      format: "A4",
      orientation: "h",
      mode: "auto",
      zoom: 1,
      selected: null,
      template: "tecnica",
      showMargins: true,
      visible: templateVisibility("tecnica"),
      overrides: {},
      texts: initialTexts(geoMap, initialData.scale.label, initialData.areaLabel),
      options: { ...createDefaultBuilderOptions(), elevationHasData: Boolean(initialData.elevation?.length) },
      extent: "actual",
    },
    past: [],
    future: [],
  }));
  const [exportPending, setExportPending] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const state = history.present;

  const extentData = useMemo(() => {
    if (state.extent === "actual") return initialData;
    const requestedBounds = state.extent === "seleccion"
      ? selectedFeatureBounds(selectedFeature) ?? toGeoBounds(view)
      : state.extent === "geometria"
        ? toGeoBounds(view)
        : undefined;
    return buildGeoExportData({ geoMap, vectorLayers, rasterLayers, center: view.center, zoom: view.zoom, bounds: requestedBounds, viewportWidthPx: 1200 });
  }, [geoMap, initialData, rasterLayers, selectedFeature, state.extent, vectorLayers, view]);
  const exportData = useMemo(() => ({
    ...extentData,
    scale: { ...extentData.scale, label: state.texts.escala || extentData.scale.label },
  }), [extentData, state.texts.escala]);
  const propertyLegendLayers = useMemo(() => Array.from(
    new Map(exportData.legend.map((layer) => [layer.layerId, { id: layer.layerId, label: layer.layerLabel }])).values(),
  ), [exportData.legend]);
  const warnings = useMemo(() => getExportWarnings(state, { legendLayerIds: propertyLegendLayers.map((layer) => layer.id), elevationHasData: Boolean(exportData.elevation?.length) }), [exportData.elevation, propertyLegendLayers, state]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        dispatch({ type: "update", mutate: (current) => ({ ...current, selected: null }) });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const syncPanels = (compact: boolean) => {
      setLeftCollapsed(compact);
      setRightCollapsed(compact);
    };
    syncPanels(media.matches);
    const onChange = (event: MediaQueryListEvent) => syncPanels(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const update = useCallback((mutate: (current: BuilderState) => BuilderState) => dispatch({ type: "update", mutate }), []);
  const commit = useCallback((mutate: (current: BuilderState) => BuilderState) => dispatch({ type: "commit", mutate }), []);
  const select = useCallback((selected: BlockId | null) => update((current) => ({ ...current, selected })), [update]);
  const selectToggle = useCallback((selected: ToggleId) => update((current) => ({ ...current, selected })), [update]);
  const toggle = useCallback((id: ToggleId) => commit((current) => {
    const visible = { ...current.visible, [id]: !current.visible[id] };
    const block = parentBlock(id);
    if (id === block && id !== "map") {
      const childIds: ToggleId[] = block === "header"
        ? ["hdr_logo", "hdr_titulo", "hdr_subtitulo", "hdr_norte"]
        : block === "docs"
          ? ["doc_elaborado", "doc_revisado", "doc_fecha", "doc_fuente", "doc_precision", "doc_notas"]
          : [];
      if (visible[id]) childIds.forEach((child) => { visible[child] = true; });
    } else if (id !== block && visible[id]) {
      visible[block] = true;
    }
    return { ...current, visible, overrides: current.mode === "auto" ? {} : current.overrides, selected: id };
  }), [commit]);
  const override = useCallback((block: BlockId, rect: Rect) => update((current) => block === "map" ? current : ({ ...current, overrides: { ...current.overrides, [block]: rect } })), [update]);
  const setFormat = useCallback((format: Format) => commit((current) => ({ ...current, format, overrides: {} })), [commit]);
  const setOrientation = useCallback((orientation: Orientation) => commit((current) => ({ ...current, orientation, overrides: {} })), [commit]);
  const setMode = useCallback((mode: Mode) => commit((current) => ({ ...current, mode, overrides: mode === "auto" ? {} : current.overrides })), [commit]);
  const setTemplate = useCallback((template: TemplateId) => commit((current) => applyTemplate(current, template)), [commit]);
  const setOptions = useCallback((patch: Partial<BuilderOptions>) => update((current) => ({ ...current, options: { ...current.options, ...patch } })), [update]);

  const handleExport = useCallback(async () => {
    if (!sheetRef.current || exportPending) return;
    setExportPending(true);
    try {
      await exportMapPdf(sheetRef.current, { format: state.format, orientation: state.orientation, title: state.texts.titulo || geoMap.title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el PDF");
    } finally {
      setExportPending(false);
    }
  }, [exportPending, geoMap.title, state.format, state.orientation, state.texts.titulo]);

  const builder = (
    <div role="dialog" aria-modal="true" aria-label="Constructor de carta cartográfica" className="fixed inset-0 z-[1200] bg-black/10 backdrop-blur-[2px]" style={{ fontFamily: "Inter, var(--font-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`@keyframes geo-export-block-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }`}</style>
      <div className="absolute inset-5 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-foreground/10">
        <Toolbar state={state} canUndo={history.past.length > 0} canRedo={history.future.length > 0} exportPending={exportPending} onFormat={setFormat} onOrientation={setOrientation} onMode={setMode} onTemplate={setTemplate} onZoom={(zoom) => update((current) => ({ ...current, zoom }))} onUndo={() => dispatch({ type: "undo" })} onRedo={() => dispatch({ type: "redo" })} onReset={() => commit((current) => ({ ...current, mode: "auto", overrides: {}, selected: null }))} onToggleMargins={() => update((current) => ({ ...current, showMargins: !current.showMargins }))} onToggleLeft={() => setLeftCollapsed((value) => !value)} onToggleRight={() => setRightCollapsed((value) => !value)} onClose={onClose} onExport={() => void handleExport()} />

        <div className="flex min-h-0 flex-1">
          <ElementsPanel state={state} collapsed={leftCollapsed} onSelect={selectToggle} onToggle={toggle} />
          <Canvas state={state} data={exportData} mapPreview={<ExportMapPreview layers={vectorLayers} rasterLayers={rasterLayers} view={view} extent={state.extent} targetBounds={exportData.bounds} sourceMapElement={sourceMapElement} />} locatorCenter={view.center} sheetRef={sheetRef} onSelect={select} onGestureStart={() => dispatch({ type: "snapshot" })} onOverride={override} onHide={(block) => toggle(block)} />
          <PropertiesPanel state={state} legendLayers={propertyLegendLayers} hasElevationData={Boolean(exportData.elevation?.length)} hasLandCoverData={Boolean(exportData.landCover?.length)} hasSelection={Boolean(selectedFeature)} collapsed={rightCollapsed} onText={(key, value) => update((current) => ({ ...current, texts: { ...current.texts, [key]: value } }))} onOptions={setOptions} onToggle={toggle} onExtent={(extent) => update((current) => ({ ...current, extent }))} />
        </div>

        <footer title={warnings.join(" · ") || "Carta lista para exportar"} className="flex h-[34px] flex-shrink-0 items-center gap-2 border-t border-slate-200 bg-white px-3 text-[11px]">
          {warnings.length ? (
            <><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /><span className="font-medium text-amber-700">{warnings.length === 1 ? "1 advertencia" : `${warnings.length} advertencias`}</span><span className="truncate text-slate-500">{warnings[0]}</span></>
          ) : (
            <><CheckCircle2 className="h-3.5 w-3.5 text-teal-600" /><span className="font-medium text-teal-700">Carta lista para exportar</span></>
          )}
          <span className="ml-auto text-slate-400">{state.format} · {state.orientation === "h" ? "Horizontal" : "Vertical"} · {state.mode === "auto" ? "Diseño automático" : "Diseño personalizado"}</span>
        </footer>
      </div>
    </div>
  );

  return createPortal(builder, document.body);
}
