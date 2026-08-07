"use client";

import { useEffect, useRef, useState } from "react";
import { formatDay, visualForCode, type PrevieneEventType } from "@/lib/previene";

export interface FilterState {
  tipos: Set<string>;
  clases: Set<string>;
  /** `YYYY-MM-DD`, or "" for no lower bound. */
  desde: string;
  /** `YYYY-MM-DD`, or "" for no upper bound. */
  hasta: string;
}

interface Props {
  eventTypes: PrevieneEventType[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
  visibleCount: number;
  totalCount: number;
  kindCounts: { EVENT: number; INCIDENT: number };
  onReset: () => void;
}

/** Anchor a popover to a trigger using measured coordinates. */
function useAnchoredPopover() {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const toggle = (width: number) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // position:fixed with measured coordinates — a popover laid out inside
      // the filter row gets clipped by its overflow, and this row scrolls.
      setPosition({
        top: Math.round(rect.bottom + 7),
        left: Math.round(Math.min(rect.left, window.innerWidth - width - 12)),
      });
    }
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return { triggerRef, open, setOpen, position, toggle };
}

export default function PrevieneFilters({
  eventTypes,
  filters,
  onChange,
  visibleCount,
  totalCount,
  kindCounts,
  onReset,
}: Props) {
  const typePopover = useAnchoredPopover();
  const datePopover = useAnchoredPopover();
  const [query, setQuery] = useState("");

  const selectedTypes = eventTypes.filter((t) => filters.tipos.has(t.code));
  const typeSummary =
    filters.tipos.size === 0
      ? "Ningún tipo"
      : selectedTypes.length === eventTypes.length
        ? "Todos los tipos"
        : selectedTypes.length === 1
          ? selectedTypes[0].name
          : `${selectedTypes.length} tipos`;

  // An empty edge is "no bound", not "today": pinning the upper edge to a fixed
  // date makes every report submitted after it invisible, with no error and no
  // way back through the interface.
  const dateSummary = !filters.desde && !filters.hasta
    ? "Todas"
    : !filters.desde
      ? `hasta ${formatDay(filters.hasta)}`
      : !filters.hasta
        ? `desde ${formatDay(filters.desde)}`
        : `${formatDay(filters.desde)} → ${formatDay(filters.hasta)}`;

  const matches = eventTypes.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  const toggleType = (code: string) => {
    const tipos = new Set(filters.tipos);
    if (tipos.has(code)) tipos.delete(code);
    else tipos.add(code);
    onChange({ ...filters, tipos });
  };

  const toggleKind = (kind: "EVENT" | "INCIDENT") => {
    const clases = new Set(filters.clases);
    if (clases.has(kind)) clases.delete(kind);
    else clases.add(kind);
    onChange({ ...filters, clases });
  };

  const chip = (active: boolean) =>
    active
      ? "border-slate-200 bg-slate-50 text-slate-800"
      : "border-transparent bg-transparent text-slate-400";

  return (
    <div className="flex flex-none items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto pb-1 -mb-1">
        {/* Event type — a searchable multi-select, not a chip row: the catalog
            is expected to grow and chips would push the row off screen. */}
        <div className="flex-none">
          <button
            ref={typePopover.triggerRef}
            type="button"
            onClick={() => typePopover.toggle(266)}
            className="flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            <span className="flex items-center gap-0.5">
              {selectedTypes.slice(0, 4).map((type) => (
                <span
                  key={type.code}
                  className="h-2.5 w-2.5 rounded-full ring-[1.5px] ring-white"
                  style={{ background: visualForCode(type.code).color }}
                />
              ))}
            </span>
            <span>{typeSummary}</span>
            <span className="opacity-55">▾</span>
          </button>
        </div>

        <span className="h-6 w-px flex-none bg-slate-200" />

        {/* Report class */}
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            onClick={() => toggleKind("EVENT")}
            aria-pressed={filters.clases.has("EVENT")}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium ${chip(filters.clases.has("EVENT"))}`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full border-2 border-slate-500"
              style={{ opacity: filters.clases.has("EVENT") ? 1 : 0.28 }}
            />
            Evento
            <span className="font-mono text-[10.5px] text-slate-400">{kindCounts.EVENT}</span>
          </button>
          <button
            type="button"
            onClick={() => toggleKind("INCIDENT")}
            aria-pressed={filters.clases.has("INCIDENT")}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium ${chip(filters.clases.has("INCIDENT"))}`}
          >
            <span
              className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-slate-500"
              style={{ opacity: filters.clases.has("INCIDENT") ? 1 : 0.28 }}
            />
            Incidente
            <span className="font-mono text-[10.5px] text-slate-400">{kindCounts.INCIDENT}</span>
          </button>
        </div>

        <span className="h-6 w-px flex-none bg-slate-200" />

        <div className="flex-none">
          <button
            ref={datePopover.triggerRef}
            type="button"
            onClick={() => datePopover.toggle(262)}
            className="flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            <span className="opacity-60">🗓</span>
            <span>{dateSummary}</span>
            <span className="opacity-55">▾</span>
          </button>
        </div>
      </div>

      <div className="flex flex-none items-center gap-2 whitespace-nowrap rounded-lg bg-emerald-50 px-3 py-1.5">
        <span className="font-mono text-[15px] font-medium text-emerald-700">{visibleCount}</span>
        <span className="text-[11.5px] text-slate-500">de {totalCount} reportes visibles</span>
      </div>

      <button
        type="button"
        onClick={onReset}
        title="Limpiar filtros y reencuadrar el mapa"
        aria-label="Limpiar filtros y reencuadrar el mapa"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      >
        ⟲
      </button>

      {/* ── Type popover ── */}
      {typePopover.open && (
        <>
          <div className="fixed inset-0 z-[790]" onClick={() => typePopover.setOpen(false)} />
          <div
            className="fixed z-[800] w-[266px] rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl"
            style={{ top: typePopover.position.top, left: typePopover.position.left }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar tipo…"
              className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-400"
            />
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {matches.map((type) => {
                const checked = filters.tipos.has(type.code);
                return (
                  <button
                    key={type.code}
                    type="button"
                    onClick={() => toggleType(type.code)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-slate-800 hover:bg-slate-50 ${
                      checked ? "bg-emerald-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-[15px] w-[15px] flex-none items-center justify-center rounded border-[1.5px] text-[10px] text-white ${
                        checked ? "border-emerald-600 bg-emerald-600" : "border-slate-300"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ background: visualForCode(type.code).color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{type.name}</span>
                    <span className="font-mono text-[10.5px] text-slate-400">{type.count}</span>
                  </button>
                );
              })}
              {matches.length === 0 && (
                <div className="px-2 py-4 text-center text-[11.5px] text-slate-400">Sin coincidencias</div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200 pt-2">
              <button
                type="button"
                onClick={() => onChange({ ...filters, tipos: new Set(eventTypes.map((t) => t.code)) })}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] text-slate-500 hover:bg-slate-50"
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...filters, tipos: new Set() })}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11.5px] text-slate-500 hover:bg-slate-50"
              >
                Ninguno
              </button>
              <div className="flex-1" />
              <span className="font-mono text-[10.5px] text-slate-400">
                {filters.tipos.size} de {eventTypes.length}
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Date popover ── */}
      {datePopover.open && (
        <>
          <div className="fixed inset-0 z-[790]" onClick={() => datePopover.setOpen(false)} />
          <div
            className="fixed z-[800] w-[262px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
            style={{ top: datePopover.position.top, left: datePopover.position.left }}
          >
            <label className="mb-2 flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              Desde
              <input
                type="date"
                value={filters.desde}
                onChange={(event) => onChange({ ...filters, desde: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11.5px] text-slate-800"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              Hasta
              <input
                type="date"
                value={filters.hasta}
                onChange={(event) => onChange({ ...filters, hasta: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11.5px] text-slate-800"
              />
            </label>
            <div className="mt-2.5 flex gap-1.5 border-t border-slate-200 pt-2.5">
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const from = new Date(now.getTime() - 30 * 86_400_000);
                  onChange({
                    ...filters,
                    desde: from.toISOString().slice(0, 10),
                    hasta: now.toISOString().slice(0, 10),
                  });
                }}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11.5px] text-slate-500 hover:bg-slate-50"
              >
                30 días
              </button>
              <button
                type="button"
                onClick={() => {
                  const year = new Date().getUTCFullYear();
                  onChange({ ...filters, desde: `${year}-01-01`, hasta: `${year}-12-31` });
                }}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11.5px] text-slate-500 hover:bg-slate-50"
              >
                Año actual
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...filters, ...DEFAULT_RANGE })}
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11.5px] text-slate-500 hover:bg-slate-50"
              >
                Todo
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * No bounds at all — NOT a wide window with hardcoded edges.
 *
 * The upper edge becomes a `submitted_at <= hasta` on the server, so any fixed
 * date is a timer: from that day on every new report is missing from the map
 * with nothing on screen to say so. Both edges stay empty and the condition is
 * simply not added.
 */
export const DEFAULT_RANGE: Pick<FilterState, "desde" | "hasta"> = { desde: "", hasta: "" };
