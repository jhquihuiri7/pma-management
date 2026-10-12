"use client";

import { CalendarRange, Check, Lock, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MESES_CORTOS, formatNumero, formatUsd } from "@/lib/pg2030";
import type { Pg2030Clasificacion, Pg2030MetaInstitucional } from "@/types";

/**
 * The AI's classification (plan §8). Read-only for everyone: it is shown,
 * never edited, and nobody can ask for it to be redone.
 */
export function ClasificacionBadges({ clasificacion }: { clasificacion: Pg2030Clasificacion }) {
  const title = "Clasificación automática con IA según el Plan Galápagos 2030";
  if (clasificacion.estado === "analizando") {
    return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700" title={title}>Analizando…</Badge>;
  }
  return (
    <>
      {clasificacion.contribucion && (
        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700" title={title}>
          {clasificacion.contribucion}
        </Badge>
      )}
      {clasificacion.tipoInversion && (
        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700" title={title}>
          Inversión: {clasificacion.tipoInversion}
        </Badge>
      )}
      {clasificacion.estado === "pendiente_clasificacion" && (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700" title={title}>
          Pendiente de clasificación
        </Badge>
      )}
    </>
  );
}

/**
 * One institutional goal: what was planned and what was executed, month by
 * month. Clicking a month opens its report (or shows it, when closed).
 */
export default function MetaCard({
  meta,
  puedeEditar,
  onReportar,
  onEditar,
  onPlanificar,
  onEliminar,
}: {
  meta: Pg2030MetaInstitucional;
  puedeEditar: boolean;
  onReportar: (mes: number) => void;
  onEditar: () => void;
  onPlanificar: () => void;
  onEliminar: () => void;
}) {
  const filas: Array<{ label: string; valor: (i: number) => string; total: string; ejecucion?: boolean }> = [
    {
      label: `Físico planificado`,
      valor: (i) => formatNumero(meta.meses[i].fisicoPlanificado),
      total: formatNumero(meta.totales.fisicoPlanificado),
    },
    {
      label: `Físico ejecutado`,
      valor: (i) => formatNumero(meta.meses[i].fisicoEjecutado),
      total: formatNumero(meta.totales.fisicoEjecutado),
      ejecucion: true,
    },
    {
      label: "Presupuesto planificado",
      valor: (i) => formatUsd(meta.meses[i].presupuestoPlanificado),
      total: formatUsd(meta.totales.presupuestoPlanificado),
    },
    {
      label: "Devengado",
      valor: (i) => (meta.meses[i].presupuestoDevengado === null ? "—" : formatUsd(meta.meses[i].presupuestoDevengado!)),
      total: formatUsd(meta.totales.presupuestoDevengado),
      ejecucion: true,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            <span className="font-mono font-semibold text-teal-700">{meta.proyecto.codigo}</span>
            <span className="mx-1">·</span>
            Meta del Plan {meta.proyecto.metaPlanCodigo}
          </p>
          <p className="font-semibold text-slate-900">{meta.nombre}</p>
          {meta.descripcion && <p className="text-sm text-slate-600">{meta.descripcion}</p>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">{meta.unidadMedida}</Badge>
            {meta.fuenteFinanciamiento && <Badge variant="secondary">{meta.fuenteFinanciamiento}</Badge>}
            <ClasificacionBadges clasificacion={meta.clasificacion} />
          </div>
        </div>
        {puedeEditar && (
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="sm" onClick={onPlanificar}>
              <CalendarRange className="mr-1 h-3.5 w-3.5" />
              Planificación
            </Button>
            <Button variant="ghost" size="sm" title="Editar datos de la meta" onClick={onEditar}>
              <Pencil className="h-4 w-4 text-slate-500" />
            </Button>
            <Button variant="ghost" size="sm" title="Eliminar meta" onClick={onEliminar}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600" />
              {meta.meses.map((m, i) => (
                <th key={m.mes} className="px-1 py-1">
                  <button type="button" onClick={() => onReportar(m.mes)}
                    title={m.puedeReportar ? `Reportar ${MESES_CORTOS[i]}` : `Ver ${MESES_CORTOS[i]}`}
                    className={`inline-flex w-full items-center justify-center gap-0.5 rounded px-1 py-1 font-medium ${
                      m.puedeReportar ? "text-teal-700 hover:bg-teal-50" : "text-slate-500 hover:bg-slate-100"
                    }`}>
                    {MESES_CORTOS[i]}
                    {m.bloqueado && <Lock className="h-3 w-3" aria-label="Mes cerrado" />}
                    {m.reportadoAt && <Check className="h-3 w-3 text-green-600" aria-label="Reportado" />}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.label} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white px-3 py-1.5 whitespace-nowrap text-slate-600">{fila.label}</td>
                {meta.meses.map((m, i) => (
                  <td key={m.mes}
                    className={`px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap ${
                      fila.ejecucion && m.reportadoAt ? "bg-green-50/60 text-slate-900" : "text-slate-600"
                    } ${m.bloqueado ? "opacity-70" : ""}`}>
                    {fila.valor(i)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums whitespace-nowrap">{fila.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
