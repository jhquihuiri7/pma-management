"use client";

import {
  Download,
  FileOutput,
  Grid3X3,
  LayoutTemplate,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Redo2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";

import type { BuilderState, Format, Mode, Orientation } from "./types";

interface ToolbarProps {
  state: BuilderState;
  canUndo: boolean;
  canRedo: boolean;
  exportPending: boolean;
  onFormat: (format: Format) => void;
  onOrientation: (orientation: Orientation) => void;
  onMode: (mode: Mode) => void;
  onTemplate: (template: BuilderState["template"]) => void;
  onZoom: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onToggleMargins: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onClose: () => void;
  onExport: () => void;
}
const segmentBase = "inline-flex h-6 items-center justify-center rounded-md px-2 text-[12px] font-medium transition-colors";

function Segment({ active, children, title, onClick }: {
  active: boolean;
  children: React.ReactNode;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`${segmentBase} ${active
        ? "bg-white text-teal-700 shadow-sm"
        : "text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function IconButton({ title, active = false, disabled = false, children, onClick }: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${active
        ? "border-teal-200 bg-teal-50 text-teal-700"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} disabled:cursor-default disabled:text-slate-300`}
    >
      {children}
    </button>
  );
}

export default function Toolbar({
  state,
  canUndo,
  canRedo,
  exportPending,
  onFormat,
  onOrientation,
  onMode,
  onTemplate,
  onZoom,
  onUndo,
  onRedo,
  onReset,
  onToggleMargins,
  onToggleLeft,
  onToggleRight,
  onClose,
  onExport,
}: ToolbarProps) {
  return (
    <header className="flex min-h-14 flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <div className="mr-1 flex min-w-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
          <FileOutput className="h-4 w-4" />
        </span>
        <div className="hidden min-w-0 xl:block">
          <p className="truncate text-[13px] font-semibold text-slate-900">Constructor de carta cartográfica</p>
          <p className="text-[10.5px] text-slate-400">Exportación PDF · Geoportal</p>
        </div>
      </div>

      <label className="relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-2 text-slate-600 hover:bg-slate-50" title="Aplicar plantilla">
        <LayoutTemplate className="h-3.5 w-3.5" />
        <span className="sr-only">Plantilla</span>
        <select
          value={state.template}
          onChange={(event) => onTemplate(event.target.value as BuilderState["template"])}
          className="h-full appearance-none bg-transparent py-0 pl-0 pr-7 text-[12px] font-medium text-slate-700 outline-none"
        >
          <option value="tecnica">Técnica completa</option>
          <option value="basica">Básica</option>
          <option value="analisis">Análisis territorial</option>
        </select>
        <span className="pointer-events-none absolute right-2 text-[9px] text-slate-400">▾</span>
      </label>

      <div className="ml-auto flex items-center gap-2 max-[1160px]:ml-0">
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" aria-label="Formato de hoja">
          {(["A4", "A3"] as const).map((format) => (
            <Segment key={format} active={state.format === format} onClick={() => onFormat(format)}>{format}</Segment>
          ))}
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" aria-label="Orientación">
          <Segment active={state.orientation === "h"} title="Horizontal" onClick={() => onOrientation("h")}>
            <RectangleHorizontal className="h-3.5 w-3.5" />
          </Segment>
          <Segment active={state.orientation === "v"} title="Vertical" onClick={() => onOrientation("v")}>
            <RectangleVertical className="h-3.5 w-3.5" />
          </Segment>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5" aria-label="Modo de diseño">
          <Segment active={state.mode === "auto"} onClick={() => onMode("auto")}>Automático</Segment>
          <Segment active={state.mode === "custom"} onClick={() => onMode("custom")}>Personalizar</Segment>
        </div>

        <div className="flex h-8 items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-0.5">
          <button type="button" title="Alejar" aria-label="Alejar" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" onClick={() => onZoom(Math.max(0.45, state.zoom - 0.12))}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-10 text-center text-[11px] font-medium tabular-nums text-slate-600">{Math.round(state.zoom * 100)}%</span>
          <button type="button" title="Acercar" aria-label="Acercar" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" onClick={() => onZoom(Math.min(2.6, state.zoom + 0.12))}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="hidden h-5 w-px bg-slate-200 lg:block" />
        <div className="flex items-center gap-1">
          <IconButton title="Deshacer" disabled={!canUndo} onClick={onUndo}><Undo2 className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Rehacer" disabled={!canRedo} onClick={onRedo}><Redo2 className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Restaurar diseño" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" /></IconButton>
          <IconButton title="Mostrar márgenes seguros" active={state.showMargins} onClick={onToggleMargins}><Grid3X3 className="h-3.5 w-3.5" /></IconButton>
          <span className="hidden max-[1279px]:contents">
            <IconButton title="Elementos" onClick={onToggleLeft}><PanelLeft className="h-3.5 w-3.5" /></IconButton>
            <IconButton title="Propiedades" onClick={onToggleRight}><PanelRight className="h-3.5 w-3.5" /></IconButton>
          </span>
        </div>
      </div>

      <div className="hidden h-5 w-px bg-slate-200 lg:block" />
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <X className="h-3.5 w-3.5" />
        <span className="hidden 2xl:inline">Cancelar</span>
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={exportPending}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-wait disabled:opacity-70"
      >
        <Download className="h-3.5 w-3.5" />
        {exportPending ? "Preparando…" : "Generar PDF"}
      </button>
    </header>
  );
}
