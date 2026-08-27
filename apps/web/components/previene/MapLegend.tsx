"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { INCIDENT_VISUAL, UNASSIGNED_VISUAL, visualForCode, type PrevieneEventType } from "@/lib/previene";

/**
 * The legend is not decoration: colour alone cannot carry the type encoding, so
 * every swatch sits next to the written name and the glyph that appears on the
 * map. It also documents the second encoding (shape = report class) and the
 * accuracy halo, neither of which is guessable.
 *
 * It can be collapsed to a title bar when it covers the part of the map the
 * user is reading; the header stays visible so the way back is obvious.
 */
export default function MapLegend({ eventTypes }: { eventTypes: PrevieneEventType[] }) {
  const [open, setOpen] = useState(true);

  const hasUnassigned = eventTypes.some(
    (t) => visualForCode(t.code).color === UNASSIGNED_VISUAL.color
  );

  return (
    <div
      className={`pointer-events-auto rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur ${
        open ? "min-w-[186px] p-3.5" : "px-3 py-2"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Colapsar leyenda" : "Expandir leyenda"}
        className={`flex w-full items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400 hover:text-slate-600 ${
          open ? "mb-2.5" : ""
        }`}
      >
        Leyenda
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-none" aria-hidden />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 flex-none" aria-hidden />
        )}
      </button>

      {open && (
        <>
          <div className="flex flex-col gap-2">
            {eventTypes.map((type) => {
              const visual = visualForCode(type.code);
              return (
                <div key={type.code} className="flex items-center gap-2.5">
                  <span
                    className="flex h-5 w-5 flex-none items-center justify-center rounded-full ring-2 ring-white"
                    style={{ background: visual.color }}
                    aria-hidden
                    dangerouslySetInnerHTML={{
                      __html: `<svg width="11" height="11" viewBox="0 0 12 12">${visual.glyph}</svg>`,
                    }}
                  />
                  <span className="text-xs text-slate-800">{type.name}</span>
                </div>
              );
            })}

            <div className="my-0.5 h-px bg-slate-200" />

            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 flex-none items-center justify-center">
                <span
                  className="flex h-[15px] w-[15px] rotate-45 items-center justify-center rounded-[3px] ring-2 ring-white"
                  style={{ background: INCIDENT_VISUAL.color }}
                  aria-hidden
                >
                  <span
                    className="-rotate-45"
                    dangerouslySetInnerHTML={{
                      __html: `<svg width="9" height="9" viewBox="0 0 12 12">${INCIDENT_VISUAL.glyph}</svg>`,
                    }}
                  />
                </span>
              </span>
              <span className="text-xs text-slate-800">
                Incidente <span className="text-slate-400">(sin tipo)</span>
              </span>
            </div>

            {hasUnassigned && (
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-5 w-5 flex-none items-center justify-center rounded-full ring-2 ring-white"
                  style={{ background: UNASSIGNED_VISUAL.color }}
                  aria-hidden
                  dangerouslySetInnerHTML={{
                    __html: `<svg width="11" height="11" viewBox="0 0 12 12">${UNASSIGNED_VISUAL.glyph}</svg>`,
                  }}
                />
                <span className="text-xs text-slate-800">
                  Tipo nuevo <span className="text-slate-400">(sin color asignado)</span>
                </span>
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 flex-none items-center justify-center">
                <span className="h-4 w-4 rounded-full border border-dashed border-slate-400 opacity-85" />
              </span>
              <span className="text-[11.5px] text-slate-500">Precisión aproximada</span>
            </div>
          </div>

          <div className="mt-2.5 border-t border-slate-200 pt-2.5 text-[10.5px] leading-relaxed text-slate-400">
            Color = tipo de evento · forma = clase de reporte
          </div>
        </>
      )}
    </div>
  );
}
