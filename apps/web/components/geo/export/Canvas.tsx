"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GeoExportData } from "@/lib/geo-export-data";
import { toUTM } from "@/components/geo/gis/geo-point";

import DocsBlock from "./blocks/DocsBlock";
import ElevationBlock from "./blocks/ElevationBlock";
import HeaderBlock from "./blocks/HeaderBlock";
import IndicatorsBlock from "./blocks/IndicatorsBlock";
import LandCoverBlock from "./blocks/LandCoverBlock";
import LegendBlock from "./blocks/LegendBlock";
import LocatorBlock from "./blocks/LocatorBlock";
import MapBlock from "./blocks/MapBlock";
import RefSysBlock from "./blocks/RefSysBlock";
import ScaleBarBlock from "./blocks/ScaleBarBlock";
import ScaleNumBlock from "./blocks/ScaleNumBlock";
import TechInfoBlock from "./blocks/TechInfoBlock";
import TerritorialLocatorMap from "./TerritorialLocatorMap";
import {
  clampRect,
  overlaps,
  resolveOverlaps,
  snapRect,
  type SnapGuide,
  type ResizeHandle,
} from "./interaction";
import { fitScale, MM_TO_PX, paperFontSizePx, paperSize, rects, safeBounds } from "./layout";
import type { BlockId, BuilderState, Rect } from "./types";
import { BLOCK_IDS, parentBlock } from "./types";
import { useTerritorialLocator } from "./use-territorial-locator";

export interface CanvasProps {
  state: BuilderState;
  data: GeoExportData;
  mapPreview: ReactNode;
  locatorCenter: [number, number];
  sheetRef: RefObject<HTMLDivElement>;
  onSelect: (block: BlockId | null) => void;
  onGestureStart: () => void;
  onOverride: (block: BlockId, rect: Rect) => void;
  onHide: (block: BlockId) => void;
}

interface CanvasSize {
  width: number;
  height: number;
}

interface GestureState {
  block: BlockId;
  handle: ResizeHandle | "move";
  startX: number;
  startY: number;
  initial: Rect;
  latest: Rect;
  others: Rect[];
}

const HANDLE_DEFS: readonly { id: ResizeHandle; x: number; y: number; cursor: string }[] = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
];

function resizeRect(initial: Rect, handle: ResizeHandle, dx: number, dy: number): Rect {
  const next = { ...initial };
  if (handle.includes("e")) next.w = initial.w + dx;
  if (handle.includes("s")) next.h = initial.h + dy;
  if (handle.includes("w")) {
    next.x = initial.x + dx;
    next.w = initial.w - dx;
  }
  if (handle.includes("n")) {
    next.y = initial.y + dy;
    next.h = initial.h - dy;
  }
  if (next.w < 24) {
    if (handle.includes("w")) next.x -= 24 - next.w;
    next.w = 24;
  }
  if (next.h < 12) {
    if (handle.includes("n")) next.y -= 12 - next.h;
    next.h = 12;
  }
  return next;
}

function tickValues(data: GeoExportData) {
  const bounds = data.bounds;
  if (!bounds) return undefined;
  const middleLatitude = (bounds.north + bounds.south) / 2;
  const middleLongitude = (bounds.east + bounds.west) / 2;
  const eastings = Array.from({ length: 5 }, (_, index) => ({
    position: index * 25,
    value: toUTM(middleLatitude, bounds.west + ((bounds.east - bounds.west) * index) / 4).easting.toLocaleString("es-EC"),
  }));
  const northings = Array.from({ length: 3 }, (_, index) => ({
    position: 12 + index * 38,
    value: toUTM(bounds.north - ((bounds.north - bounds.south) * index) / 2, middleLongitude).northing.toLocaleString("es-EC"),
  }));
  return { eastings, northings };
}

export default function Canvas({ state, data, mapPreview, locatorCenter, sheetRef, onSelect, onGestureStart, onOverride, onHide }: CanvasProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 900, height: 620 });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [colliding, setColliding] = useState(false);
  const layout = useMemo(() => rects(state), [state]);
  const paper = paperSize(state.format, state.orientation);
  const scale = Math.max(0.12, fitScale(canvasSize.width, canvasSize.height, state.format, state.orientation)) * state.zoom;
  const paperWidthPx = paper.w * MM_TO_PX;
  const paperHeightPx = paper.h * MM_TO_PX;
  const bounds = safeBounds(state.format, state.orientation);
  const selectedBlock = state.selected ? parentBlock(state.selected) : null;
  const locatorPoint = useMemo(() => ({
    longitude: data.bounds ? (data.bounds.east + data.bounds.west) / 2 : locatorCenter[1],
    latitude: data.bounds ? (data.bounds.north + data.bounds.south) / 2 : locatorCenter[0],
  }), [data.bounds, locatorCenter]);
  const locator = useTerritorialLocator({ point: locatorPoint, bounds: data.bounds });
  const locatorLevels = useMemo(() => state.options.locatorLevels.map((level) => {
    if (level === "ecuador") {
      return {
        id: level,
        label: "Ecuador",
        preview: <TerritorialLocatorMap features={locator.provinces} selected={locator.province} point={locatorPoint} loading={locator.loading} error={locator.error} source={locator.source} label="Ecuador" />,
      };
    }
    if (level === "provincia") {
      const label = locator.province?.name ?? "Provincia";
      return {
        id: level,
        label,
        preview: <TerritorialLocatorMap features={locator.cantons} selected={locator.canton} point={locatorPoint} loading={locator.loading} error={locator.error} source={locator.source} label={`Provincia de ${label}`} />,
      };
    }
    const territory = locator.canton ? [locator.canton] : [];
    const cantonName = locator.canton?.name ?? "Cantón";
    return {
      id: level,
      label: locator.canton ? `Cantón ${cantonName}` : cantonName,
      preview: <TerritorialLocatorMap features={territory} selected={locator.canton} point={locatorPoint} viewportBounds={data.bounds} showViewport loading={locator.loading} error={locator.error} source={locator.source} label={`Cantón ${cantonName}`} />,
    };
  }), [data.bounds, locator, locatorPoint, state.options.locatorLevels]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const measure = () => setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const startGesture = useCallback((block: BlockId, handle: ResizeHandle | "move", event: ReactPointerEvent) => {
    onSelect(block);
    if (state.mode !== "custom" || block === "map") return;
    const initial = layout[block];
    if (!initial) return;
    event.preventDefault();
    event.stopPropagation();
    onGestureStart();
    const others = BLOCK_IDS.filter((id) => id !== block).map((id) => layout[id]).filter((rect): rect is Rect => Boolean(rect));
    gestureRef.current = { block, handle, startX: event.clientX, startY: event.clientY, initial: { ...initial }, latest: { ...initial }, others };

    const move = (pointerEvent: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const dx = (pointerEvent.clientX - gesture.startX) / (MM_TO_PX * scale);
      const dy = (pointerEvent.clientY - gesture.startY) / (MM_TO_PX * scale);
      const candidate = gesture.handle === "move"
        ? { ...gesture.initial, x: gesture.initial.x + dx, y: gesture.initial.y + dy }
        : resizeRect(gesture.initial, gesture.handle, dx, dy);
      const snapped = snapRect(candidate, { others: gesture.others, bounds, kind: gesture.handle });
      const clamped = clampRect(snapped.rect, bounds, { w: 24, h: 12 });
      gesture.latest = clamped;
      setGuides(snapped.guides);
      setColliding(gesture.others.some((other) => overlaps(clamped, other)));
      onOverride(gesture.block, clamped);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;
      const resolved = resolveOverlaps(gesture.latest, gesture.others, bounds, gesture.initial, { maxIterations: 12, separation: 1.5 });
      onOverride(gesture.block, resolved.rect);
      setGuides([]);
      setColliding(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }, [bounds, layout, onGestureStart, onOverride, onSelect, scale, state.mode]);

  const renderBlock = (block: BlockId): ReactNode => {
    const texts = state.texts;
    switch (block) {
      case "header": return <HeaderBlock institution={texts.institucion} unit={texts.unidad} title={texts.titulo} subtitle={texts.subtitulo} system={texts.sistema} showLogo={state.visible.hdr_logo} showTitle={state.visible.hdr_titulo} showSubtitle={state.visible.hdr_subtitulo} showNorth={state.visible.hdr_norte} logoSizeMm={state.options.logoSize} titleSizeEm={state.options.titleSize / 10} titleAlignment={state.options.titleAlign} titleBold={state.options.titleBold} />;
      case "map": return <MapBlock preview={mapPreview} coordinates={tickValues(data)} showCoordinates={state.visible.map_coords} showGrid={state.visible.map_coords} gridDensity={state.options.gridDensity} selected={selectedBlock === "map"} />;
      case "legend": return <LegendBlock title={texts.legendTitle || "LEYENDA"} items={data.legend.filter((item) => !state.options.legendExcludedLayerIds.includes(item.layerId))} columns={state.options.legendColumns} />;
      case "locator": return <LocatorBlock levels={locatorLevels} showLabels={state.options.locatorLabels} showBorders={state.options.locatorBorder} />;
      case "indicators": return <IndicatorsBlock indicators={data.indicators.map((indicator) => ({ ...indicator, visible: state.options.indicators[indicator.id as keyof typeof state.options.indicators] ?? true }))} />;
      case "elevation": return <ElevationBlock points={data.elevation ?? []} onHide={() => onHide("elevation")} />;
      case "landcover": return <LandCoverBlock items={data.landCover ?? []} onHide={() => onHide("landcover")} />;
      case "scalebar": return <ScaleBarBlock maxDistance={data.scale.barDistance} unit={data.scale.unit} scaleStyle={state.options.scaleStyle} />;
      case "scalenum": return <ScaleNumBlock scale={texts.escala || data.scale.label} />;
      case "refsys": return <RefSysBlock coordinateSystem={texts.srs || data.referenceSystem.name} datum={texts.datum || data.referenceSystem.datum} units={texts.unidades || data.referenceSystem.units} epsg={data.referenceSystem.epsg} />;
      case "techinfo": return <TechInfoBlock scale={texts.escala || data.scale.label} area={texts.area || data.areaLabel} sheet={texts.hoja} code={texts.codigo} />;
      case "docs": return <DocsBlock elaboratedBy={texts.elaborado} reviewedBy={texts.revisado} date={texts.fecha} source={texts.fuente} precision={texts.precision} notes={texts.notas} visibility={{ elaborated: state.visible.doc_elaborado, reviewed: state.visible.doc_revisado, date: state.visible.doc_fecha, source: state.visible.doc_fuente, precision: state.visible.doc_precision, notes: state.visible.doc_notas }} />;
    }
  };

  const selectedRect = selectedBlock ? layout[selectedBlock] : undefined;
  const paperStyle: CSSProperties = {
    width: paperWidthPx,
    height: paperHeightPx,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    fontSize: paperFontSizePx(state.format, state.orientation),
  };

  return (
    <main ref={workspaceRef} className="relative min-w-0 flex-1 overflow-auto bg-[#e7ebef]" onPointerDown={(event) => { if (!(event.target as Element).closest("[data-export-sheet]")) onSelect(null); }}>
      <div className="flex items-center justify-center" style={{ width: `max(100%, ${paperWidthPx * scale + 56}px)`, height: `max(100%, ${paperHeightPx * scale + 56}px)` }}>
        <div className="relative flex-shrink-0" style={{ width: paperWidthPx * scale, height: paperHeightPx * scale }}>
        <div ref={sheetRef} data-export-sheet aria-label={`Hoja ${state.format} ${state.orientation === "h" ? "horizontal" : "vertical"}`} className="absolute left-0 top-0 bg-white shadow-[0_8px_24px_-6px_rgba(15,23,42,.28)] ring-1 ring-slate-900/10" style={paperStyle} onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
          {state.showMargins && <div data-editor-chrome className="pointer-events-none absolute border border-dashed border-teal-300" style={{ left: bounds.x * MM_TO_PX, top: bounds.y * MM_TO_PX, width: bounds.w * MM_TO_PX, height: bounds.h * MM_TO_PX }} />}

          {BLOCK_IDS.map((block) => {
            const blockRect = layout[block];
            if (!blockRect || (block !== "map" && !state.visible[block])) return null;
            return (
              <div key={block} data-cartographic-block={block} className={`absolute overflow-hidden ${state.mode === "custom" && block !== "map" ? "cursor-move" : "cursor-pointer"}`} style={{ left: blockRect.x * MM_TO_PX, top: blockRect.y * MM_TO_PX, width: blockRect.w * MM_TO_PX, height: blockRect.h * MM_TO_PX, animation: "geo-export-block-in 160ms ease-out", transition: state.mode === "auto" ? "left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease" : undefined }} onPointerDown={(event) => startGesture(block, "move", event)}>
                {renderBlock(block)}
              </div>
            );
          })}

          {guides.map((guide, index) => <div key={`${guide.axis}-${guide.position}-${index}`} data-editor-chrome className="pointer-events-none absolute z-30 bg-[#f43f5e]" style={guide.axis === "x" ? { left: guide.position * MM_TO_PX, top: 0, bottom: 0, width: 1 } : { top: guide.position * MM_TO_PX, left: 0, right: 0, height: 1 }} />)}

          {selectedRect && (
            <div data-editor-chrome className="pointer-events-none absolute z-40" style={{ left: selectedRect.x * MM_TO_PX, top: selectedRect.y * MM_TO_PX, width: selectedRect.w * MM_TO_PX, height: selectedRect.h * MM_TO_PX, border: `1.5px solid ${colliding ? "#f43f5e" : "#0d9488"}`, boxShadow: `0 0 0 3px ${colliding ? "rgba(244,63,94,.18)" : "rgba(13,148,136,.14)"}` }}>
              {state.mode === "custom" && selectedBlock !== "map" && HANDLE_DEFS.map((handle) => <button key={handle.id} type="button" aria-label={`Redimensionar ${handle.id}`} className="pointer-events-auto absolute h-[9px] w-[9px] rounded-[2px] border-[1.5px] border-teal-600 bg-white" style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%`, transform: "translate(-50%, -50%)", cursor: handle.cursor }} onPointerDown={(event) => selectedBlock && startGesture(selectedBlock, handle.id, event)} />)}
            </div>
          )}
        </div>
        </div>
      </div>
    </main>
  );
}
