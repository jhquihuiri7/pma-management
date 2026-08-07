"use client";

import { INCIDENT_VISUAL, UNASSIGNED_VISUAL, visualForCode, type PrevieneEventType } from "@/lib/previene";

/**
 * The legend is not decoration: colour alone cannot carry the type encoding, so
 * every swatch sits next to the written name and the glyph that appears on the
 * map. It also documents the second encoding (shape = report class) and the
 * accuracy halo, neither of which is guessable.
 */
export default function MapLegend({ eventTypes }: { eventTypes: PrevieneEventType[] }) {
  const hasUnassigned = eventTypes.some(
    (t) => visualForCode(t.code).color === UNASSIGNED_VISUAL.color
  );

  return (
    <div className="pointer-events-auto min-w-[186px] rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur">
      <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">
        Leyenda
      </div>

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
    </div>
  );
}
