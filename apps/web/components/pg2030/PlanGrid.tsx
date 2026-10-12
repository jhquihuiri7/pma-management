"use client";

import { Lock } from "lucide-react";
import { MESES_CORTOS, formatNumero, formatUsd, parseDecimal } from "@/lib/pg2030";

/** What the user typed, kept as text so "1," mid-typing is not lost. */
export type PlanCelda = { fisico: string; presupuesto: string };

export function planVacio(): PlanCelda[] {
  return Array.from({ length: 12 }, () => ({ fisico: "", presupuesto: "" }));
}

/**
 * Turn the grid into the twelve months the API expects, or the first problem
 * found. Empty cells are 0: the yearly target is the sum of the months.
 */
export function planDesdeGrid(celdas: PlanCelda[]): { mes: number; fisico: number; presupuesto: number }[] | string {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const fisico = parseDecimal(celdas[i].fisico);
    const presupuesto = parseDecimal(celdas[i].presupuesto);
    if (fisico === null) return `Avance físico de ${MESES_CORTOS[i]}: escribe un número mayor o igual a 0`;
    if (presupuesto === null) return `Presupuesto de ${MESES_CORTOS[i]}: escribe un número mayor o igual a 0`;
    out.push({ mes: i + 1, fisico, presupuesto });
  }
  return out;
}

const inputClass =
  "w-20 rounded-md border border-input bg-background px-1.5 py-1 text-right text-xs tabular-nums disabled:bg-slate-100 disabled:text-slate-500";

/**
 * Monthly plan: physical progress and budget, January to December. Locked
 * months show their value but cannot change.
 */
export default function PlanGrid({
  celdas,
  bloqueados,
  unidad,
  onChange,
}: {
  celdas: PlanCelda[];
  bloqueados: boolean[];
  unidad: string;
  onChange: (index: number, campo: keyof PlanCelda, value: string) => void;
}) {
  const totalFisico = celdas.reduce((s, c) => s + (parseDecimal(c.fisico) ?? 0), 0);
  const totalPresupuesto = celdas.reduce((s, c) => s + (parseDecimal(c.presupuesto) ?? 0), 0);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="text-xs">
        <thead className="bg-slate-50">
          <tr>
            <th className="sticky left-0 bg-slate-50 px-2 py-1.5 text-left font-medium text-slate-600">Planificado</th>
            {MESES_CORTOS.map((mes, i) => (
              <th key={mes} className="px-1 py-1.5 text-center font-medium text-slate-600">
                <span className="inline-flex items-center gap-0.5">
                  {mes}
                  {bloqueados[i] && <Lock className="h-3 w-3 text-slate-400" aria-label="Mes cerrado" />}
                </span>
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-semibold text-slate-700">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sticky left-0 bg-white px-2 py-1 text-slate-600">Físico ({unidad || "unidad"})</td>
            {celdas.map((c, i) => (
              <td key={i} className="px-1 py-1">
                <input className={inputClass} inputMode="decimal" disabled={bloqueados[i]} value={c.fisico}
                  aria-label={`Avance físico planificado de ${MESES_CORTOS[i]}`}
                  onChange={(e) => onChange(i, "fisico", e.target.value)} />
              </td>
            ))}
            <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatNumero(totalFisico)}</td>
          </tr>
          <tr>
            <td className="sticky left-0 bg-white px-2 py-1 text-slate-600">Presupuesto (USD)</td>
            {celdas.map((c, i) => (
              <td key={i} className="px-1 py-1">
                <input className={inputClass} inputMode="decimal" disabled={bloqueados[i]} value={c.presupuesto}
                  aria-label={`Presupuesto planificado de ${MESES_CORTOS[i]}`}
                  onChange={(e) => onChange(i, "presupuesto", e.target.value)} />
              </td>
            ))}
            <td className="px-2 py-1 text-right font-semibold tabular-nums">{formatUsd(totalPresupuesto)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
