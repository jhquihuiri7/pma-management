"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClasificacionBadges } from "@/components/pg2030/MetaCard";
import { MESES_LARGOS, deTotal, formatNumero, formatPct, formatUsd } from "@/lib/pg2030";
import type { Pg2030Dashboard, Pg2030DashboardMeta } from "@/types";
import { Estado, Tile } from "./comunes";
import { ESTADO_REPORTE } from "./Cuadros";

/** Why a goal's figures read as they do: shown beside it, in words. */
function alertas(m: Pg2030DashboardMeta): string[] {
  const out: string[] = [];
  if (!m.aReportar) out.push("No tenía meses que reportar en este corte.");
  else if (!m.reportada) out.push("No reportó todos los meses del corte: no cuenta en los promedios.");
  if (m.fisico.estado === "ejecutado_sin_programacion") out.push("Reportó avance físico sin haberlo planificado.");
  if (m.fisico.estado === "sin_programacion") out.push("Sin avance físico planificado al corte.");
  if (m.presupuesto.estado === "devengado_sin_programacion") out.push("Devengó sin presupuesto planificado.");
  if (m.presupuesto.devengado > m.presupuesto.planificado && m.presupuesto.planificado > 0) {
    out.push("Devengó más de lo planificado: se toma lo planificado.");
  }
  return out;
}

/** One institution's goals at the cutoff, opened from a bar, a dot or a table row. */
export default function InstitucionDetalle({
  d,
  institucionId,
  onClose,
}: {
  d: Pg2030Dashboard;
  institucionId: string | null;
  onClose: () => void;
}) {
  const inst = d.instituciones.find((i) => i.institucion.id === institucionId);
  const corte = d.corte;
  return (
    <Dialog open={!!inst} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {inst && (
          <>
            <DialogHeader>
              <DialogTitle>{inst.institucion.sigla} — {inst.institucion.nombre}</DialogTitle>
              <DialogDescription>
                {corte && d.anio
                  ? `Corte T${corte.trimestre} ${d.anio.anio}. Acumulado de enero a ${MESES_LARGOS[Math.max(corte.hasta, 1) - 1]}.`
                  : "Sin corte."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <Tile label="Metas reportadas" value={deTotal(inst.reportadas, inst.aReportar)}
                hint={<Estado {...ESTADO_REPORTE[inst.estadoReporte]} />} />
              <Tile label="Avance físico" value={formatPct(inst.fisico.valor)}
                hint={inst.fisico.semaforo && <Estado {...d.leyenda.semaforo[inst.fisico.semaforo]} />} />
              <Tile label="Avance presupuestario" value={formatPct(inst.presupuesto.valor)}
                hint={inst.presupuesto.sinPresupuesto
                  ? "Sin presupuesto planificado"
                  : inst.presupuesto.semaforo && <Estado {...d.leyenda.semaforo[inst.presupuesto.semaforo]} />} />
              <Tile label="Coherencia" value={<span className="text-lg">{d.leyenda.coherencia[inst.coherencia].label}</span>} />
            </div>

            <div className="space-y-3">
              {inst.metas.length === 0 && <p className="text-sm text-slate-500">No tiene metas en este filtro.</p>}
              {inst.metas.map((m) => {
                const avisos = alertas(m);
                return (
                  <div key={m.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-slate-900">{m.nombre}</p>
                        <p className="text-xs text-slate-500">
                          {m.proyectoCodigo} · Eje {m.ejeCodigo}
                          {m.fuenteFinanciamiento ? ` · ${m.fuenteFinanciamiento}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1"><ClasificacionBadges clasificacion={m.clasificacion} /></div>
                    </div>
                    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Físico ({m.unidadMedida})</dt>
                        <dd className="tabular-nums text-slate-800">
                          {formatNumero(m.fisico.ejecutado)} de {formatNumero(m.fisico.planificado)} · {formatPct(m.fisico.avance)}
                        </dd>
                        {m.fisico.semaforo && <Estado {...d.leyenda.semaforo[m.fisico.semaforo]} />}
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Presupuesto</dt>
                        <dd className="tabular-nums text-slate-800">
                          {formatUsd(m.presupuesto.devengado)} de {formatUsd(m.presupuesto.planificado)} · {formatPct(m.presupuesto.avance)}
                        </dd>
                        {m.presupuesto.semaforo && <Estado {...d.leyenda.semaforo[m.presupuesto.semaforo]} />}
                      </div>
                    </dl>
                    {avisos.length > 0 && (
                      <ul className="mt-3 space-y-0.5 text-xs text-amber-800">
                        {avisos.map((a) => <li key={a}>• {a}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
