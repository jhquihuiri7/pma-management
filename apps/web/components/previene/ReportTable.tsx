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
          minimum width instead of collapsing to nothing. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[496px]">
          <div
            className="sticky top-0 z-[2] grid items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2.5"
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
            return (
              <button
                key={report.id}
                type="button"
                onClick={() => onSelect(report.id)}
                aria-current={report.id === selectedId}
                className={`grid w-full items-center gap-2 border-b border-slate-200 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                  report.id === selectedId ? "bg-emerald-50" : "bg-white"
                }`}
                style={{ gridTemplateColumns: "minmax(112px,150px) minmax(84px,112px) 70px minmax(132px,1fr) 44px" }}
              >
                <span className="font-mono text-[11.5px] text-slate-500">{formatShort(report.submittedAt)}</span>
                <span className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-slate-800">
                  <span
                    className="h-2.5 w-2.5 flex-none"
                    style={{
                      background: visual.color,
                      borderRadius: incident ? "2px" : "50%",
                      transform: incident ? "rotate(45deg)" : undefined,
                    }}
                    aria-hidden
                  />
                  {typeLabel(report)}
                </span>
                <span className="truncate text-[11.5px] text-slate-500">{kindLabel(report)}</span>
                <span className="truncate text-[12.5px] text-slate-500">{report.description || "—"}</span>
                <span className="text-right font-mono text-[11px] text-slate-400">
                  {report.media.length > 0 ? `${report.media.length} ${hasVideo ? "▶" : "▣"}` : "—"}
                </span>
              </button>
            );
          })}

          {rows.length === 0 && (
            <div className="px-5 py-11 text-center text-[12.5px] text-slate-400">
              Ningún reporte cumple los filtros aplicados.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-3.5 border-t border-slate-200 px-3.5 py-2 text-[11px] text-slate-400">
        <span>
          Ordenado por {sortKey === "fecha" ? "fecha de envío" : "tipo de evento"}{" "}
          {sortDir === "desc" ? "(descendente)" : "(ascendente)"}
        </span>
        <div className="flex-1" />
        <span>El identificador de quien reporta no se muestra ni se exporta.</span>
      </div>
    </div>
  );
}
