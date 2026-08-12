"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlignLeft,
  BadgeCheck,
  BarChart3,
  Binary,
  CalendarDays,
  ClipboardList,
  Crosshair,
  Database,
  GripVertical,
  Heading,
  Info,
  Landmark,
  Layers3,
  ListTree,
  LockKeyhole,
  Map,
  MapPinned,
  MountainSnow,
  Navigation,
  Orbit,
  Ruler,
  StickyNote,
  Type,
  UserRoundCheck,
} from "lucide-react";

import type { BlockId, BuilderState, ToggleId } from "./types";
import { parentBlock } from "./types";

interface ElementRow {
  id: ToggleId;
  label: string;
  icon: LucideIcon;
  reorderable?: boolean;
}

interface ElementCategory {
  label: string;
  rows: ElementRow[];
}

const BLOCK_IDS = new Set<BlockId>([
  "header", "map", "legend", "locator", "indicators", "elevation", "landcover",
  "scalebar", "scalenum", "refsys", "techinfo", "docs",
]);

const CATEGORIES: ElementCategory[] = [
  {
    label: "Básicos",
    rows: [
      { id: "header", label: "Encabezado", icon: Heading, reorderable: true },
      { id: "hdr_titulo", label: "Título", icon: Type },
      { id: "hdr_subtitulo", label: "Subtítulo", icon: AlignLeft },
      { id: "hdr_norte", label: "Norte", icon: Navigation },
      { id: "map_coords", label: "Coordenadas", icon: Crosshair },
      { id: "scalebar", label: "Escala gráfica", icon: Ruler, reorderable: true },
      { id: "scalenum", label: "Escala numérica", icon: Binary, reorderable: true },
    ],
  },
  {
    label: "Información cartográfica",
    rows: [
      { id: "legend", label: "Leyenda", icon: ListTree, reorderable: true },
      { id: "locator", label: "Mapa de ubicación", icon: MapPinned, reorderable: true },
      { id: "refsys", label: "Sistema de referencia", icon: Orbit, reorderable: true },
      { id: "techinfo", label: "Información técnica", icon: Info, reorderable: true },
    ],
  },
  {
    label: "Análisis",
    rows: [
      { id: "indicators", label: "Indicadores territoriales", icon: BarChart3, reorderable: true },
      { id: "elevation", label: "Perfil de elevación", icon: MountainSnow, reorderable: true },
      { id: "landcover", label: "Cobertura del suelo", icon: Layers3, reorderable: true },
    ],
  },
  {
    label: "Documentación",
    rows: [
      { id: "docs", label: "Bloque documental", icon: ClipboardList, reorderable: true },
      { id: "doc_elaborado", label: "Elaborado por", icon: UserRoundCheck },
      { id: "doc_revisado", label: "Revisado por", icon: BadgeCheck },
      { id: "doc_fecha", label: "Fecha", icon: CalendarDays },
      { id: "doc_fuente", label: "Fuente", icon: Database },
      { id: "doc_precision", label: "Precisión", icon: Crosshair },
      { id: "doc_notas", label: "Notas", icon: StickyNote },
      { id: "hdr_logo", label: "Logo institucional", icon: Landmark },
    ],
  },
];

interface ElementsPanelProps {
  state: BuilderState;
  collapsed?: boolean;
  onSelect: (id: ToggleId) => void;
  onToggle: (id: ToggleId) => void;
}

function Switch({ checked, label, onChange }: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${checked ? "Ocultar" : "Mostrar"} ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`relative h-[15px] w-[26px] flex-shrink-0 rounded-full transition-colors duration-150 ${checked ? "bg-teal-600" : "bg-slate-200"}`}
    >
      <span className={`absolute top-0.5 h-[11px] w-[11px] rounded-full bg-white shadow-sm transition-[left] duration-150 ${checked ? "left-[13px]" : "left-0.5"}`} />
    </button>
  );
}

export default function ElementsPanel({ state, collapsed = false, onSelect, onToggle }: ElementsPanelProps) {
  return (
    <aside className={`flex flex-shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-[width] ${collapsed ? "w-12" : "w-[262px]"}`} aria-label="Elementos de la carta">
      <div className={`${collapsed ? "hidden" : "block"} px-3.5 pb-2.5 pt-3.5`}>
        <h2 className="text-[12.5px] font-semibold text-slate-900">Elementos de la carta</h2>
        <p className="mt-1 text-[11px] leading-4 text-slate-400">Activa o desactiva módulos; la composición se reorganiza sola.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <button
          type="button"
          onClick={() => onSelect("map")}
          title="Mapa principal · Bloqueado"
          className={`mb-2 mt-2 flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors ${state.selected !== null && parentBlock(state.selected) === "map"
            ? "border-teal-200 bg-teal-50 text-teal-800"
            : "border-teal-100 bg-teal-50/60 text-teal-700 hover:bg-teal-50"}`}
        >
          <Map className="h-3.5 w-3.5 flex-shrink-0" />
          <span className={`${collapsed ? "hidden" : "block"} min-w-0 flex-1`}>
            <span className="block truncate text-xs font-semibold">Mapa principal</span>
            <span className="block text-[10px] text-teal-500">Elemento fijo · bloqueado</span>
          </span>
          <LockKeyhole className={`${collapsed ? "hidden" : "block"} h-3.5 w-3.5 text-teal-500`} />
        </button>

        {CATEGORIES.map((category) => (
          <section key={category.label}>
            <h3 className={`${collapsed ? "sr-only" : ""} px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400`}>{category.label}</h3>
            <div className="space-y-px">
              {category.rows.map((row) => {
                const Icon = row.icon;
                const visible = state.visible[row.id];
                const selected = state.selected === row.id;
                const reorderable = row.reorderable && BLOCK_IDS.has(row.id as BlockId);
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={row.id}
                    title={row.label}
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(row.id);
                      }
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors ${selected
                      ? "bg-teal-50 ring-1 ring-inset ring-teal-200"
                      : "hover:bg-slate-50"} ${visible ? "text-slate-700" : "text-slate-400"}`}
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className={`${collapsed ? "hidden" : "block"} min-w-0 flex-1 truncate text-xs font-medium`}>{row.label}</span>
                    <span className={collapsed ? "hidden" : ""}>
                      <Switch checked={visible} label={row.label} onChange={() => onToggle(row.id)} />
                    </span>
                    {reorderable && (
                      <GripVertical className={`${collapsed ? "hidden" : "block"} h-3.5 w-3.5 flex-shrink-0 text-slate-300`} aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className={`${collapsed ? "hidden" : "block"} border-t border-slate-100 px-3 py-2 text-[10.5px] leading-4 text-slate-400`}>
        {state.mode === "custom"
          ? "Personalizar: arrastra y redimensiona los módulos sobre la hoja."
          : "Automático: la hoja se recompone al cambiar sus elementos."}
      </div>
    </aside>
  );
}
