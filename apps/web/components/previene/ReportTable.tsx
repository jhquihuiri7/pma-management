"use client";

import { useMemo } from "react";
import {
  formatShort,
  isIncident,
  kindLabel,
  typeLabel,
  visualFor,
  type PrevieneReport,
} from "@/lib/previene";

export type SortKey = "fecha" | "tipo";
export type SortDir = "asc" | "desc";

interface Props {
  reports: PrevieneReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

/**
 * The table is an accessibility requirement, not a convenience: a map alone
 * makes the data unreadable to anyone using a screen reader or unable to
 * discriminate the marker colours. It shows the same filtered set, ordered.
 */
export default function ReportTable({ reports, selectedId, onSelect, sortKey, sortDir, onSort }: Props) {
  const rows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...reports].sort((a, b) => {
      if (sortKey === "tipo") {
        const byName = typeLabel(a).localeCompare(typeLabel(b), "es");
        if (byName !== 0) return byName * direction;
      }
      const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return sortKey === "tipo" ? bt - at : (at - bt) * direction;
    });
  }, [reports, sortKey, sortDir]);

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "desc" ? "↓" : "↑") : "");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Header and rows share one horizontally scrolling container so the
          columns cannot drift apart, and the description column keeps a
          minimum width instead of collapsing to nothing.

          The five columns need ~500px, which no phone has: below `sm` the same
          rows are stacked as cards, the column header is replaced by a sort bar
          and the minimum width is dropped so nothing scrolls sideways. */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="sm:min-w-[496px]">
          {/* Sorting is the only thing the column header did that the cards
              cannot: on narrow screens it becomes an explicit control. */}
          <div className="sticky top-0 z-[2] flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:hidden">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-400">Ordenar</span>
            {([
              ["fecha", "Enviado"],
              ["tipo", "Tipo"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onSort(key)}
                aria-pressed={sortKey === key}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11.5px] font-medium ${
                  sortKey === key
                    ? "border-emerald-200 bg-white text-emerald-700"
                    : "border-transparent text-slate-500"
                }`}
              >
                {label}
                <span className="text-emerald-600">{arrow(key)}</span>
              </button>
            ))}
          </div>

          <div
            className="sticky top-0 z-[2] hidden items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5 sm:grid"
            style={{ gridTemplateColumns: "minmax(112px,150px) minmax(84px,112px) 70px minmax(132px,1fr) 44px" }}
          >
            <button
              type="button"
              onClick={() => onSort("fecha")}
              className="flex items-center gap-1.5 whitespace-nowrap text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-500 hover:text-slate-800"
            >
              Enviado (UTC-6)
              <span className="text-emerald-600">{arrow("fecha")}</span>
            </button>
            <button
              type="button"
              onClick={() => onSort("tipo")}
              className="flex items-center gap-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-500 hover:text-slate-800"
            >
              Tipo
              <span className="text-emerald-600">{arrow("tipo")}</span>
            </button>
            <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-500">
              Clase
            </span>
            <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-500">
              Descripción
            </span>
            <span className="text-right text-[10.5px] font-semibold uppercase tracking-[0.07em] text-slate-500">
              Evid.
            </span>
          </div>

          {rows.map((report) => {
            const visual = visualFor(report);
            const incident = isIncident(report);
            const hasVideo = report.media.some((m) => m.mediaType === "VIDEO");
            const swatch = (
              <span
                className="h-2.5 w-2.5 flex-none"
                style={{
                  background: visual.color,
                  borderRadius: incident ? "2px" : "50%",
                  transform: incident ? "rotate(45deg)" : undefined,
                }}
                aria-hidden
              />
            );
            const evidence = report.media.length > 0 ? `${report.media.length} ${hasVideo ? "▶" : "▣"}` : "—";
            return (
              <button
                key={report.id}
                type="button"
                onClick={() => onSelect(report.id)}
                aria-current={report.id === selectedId}
                className={`block w-full border-b border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50 sm:px-3.5 sm:py-2.5 ${
                  report.id === selectedId ? "bg-emerald-50" : "bg-white"
                }`}
              >
                {/* Narrow: type and evidence count on top, description, then
                    the metadata line. Same fields, one column. */}
                <span className="flex flex-col gap-1 sm:hidden">
                  <span className="flex items-center gap-2">
                    {swatch}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                      {typeLabel(report)}
                    </span>
                    <span className="flex-none font-mono text-[11px] text-slate-400">{evidence}</span>
                  </span>
                  <span className="line-clamp-2 text-[12.5px] leading-snug text-slate-500">
                    {report.description || "—"}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="font-mono">{formatShort(report.submittedAt)}</span>
                    <span aria-hidden>·</span>
                    <span>{kindLabel(report)}</span>
                  </span>
                </span>

                <span
                  className="hidden items-center gap-2 sm:grid"
                  style={{
                    gridTemplateColumns: "minmax(112px,150px) minmax(84px,112px) 70px minmax(132px,1fr) 44px",
                  }}
                >
                  <span className="font-mono text-[11.5px] text-slate-500">{formatShort(report.submittedAt)}</span>
                  <span className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-slate-800">
                    {swatch}
                    {typeLabel(report)}
                  </span>
                  <span className="truncate text-[11.5px] text-slate-500">{kindLabel(report)}</span>
                  <span className="truncate text-[12.5px] text-slate-500">{report.description || "—"}</span>
                  <span className="text-right font-mono text-[11px] text-slate-400">{evidence}</span>
                </span>
              </button>
            );
          })}

          {rows.length === 0 && (
            <div className="px-4 py-11 text-center text-[12.5px] text-slate-400">
              Ningún reporte cumple los filtros aplicados.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-3.5 gap-y-0.5 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-400 sm:flex-nowrap sm:px-3.5">
        <span>
          Ordenado por {sortKey === "fecha" ? "fecha de envío" : "tipo de evento"}{" "}
          {sortDir === "desc" ? "(descendente)" : "(ascendente)"}
        </span>
        <div className="hidden flex-1 sm:block" />
        <span>El identificador de quien reporta no se muestra ni se exporta.</span>
      </div>
    </div>
  );
}
