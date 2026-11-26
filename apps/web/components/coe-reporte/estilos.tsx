"use client";

import type { CoeMetrica } from "@/types";

// Plain Tailwind 3 classes: components/ui is written for Tailwind v4 variants
// and some of it (tabs) renders broken here.

export const tarjeta = "rounded-xl border border-[#dbe6ed] bg-white p-5 shadow-sm";
export const control =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100";
export const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";
export const boton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#08766a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#065e55] disabled:opacity-60";
export const botonSecundario =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

/** Editable list of numeric indicators (indicator, quantity, unit). */
export function EditorMetricas({
  valor,
  onChange,
  max = 8,
  textoAgregar = "Agregar indicador",
}: {
  valor: CoeMetrica[];
  onChange: (valor: CoeMetrica[]) => void;
  max?: number;
  textoAgregar?: string;
}) {
  const cambiar = (i: number, campo: keyof CoeMetrica, texto: string) =>
    onChange(valor.map((m, j) => (j === i ? { ...m, [campo]: texto } : m)));
  return (
    <div className="space-y-3">
      {valor.map((m, i) => {
        const usada = Boolean(m.indicador || m.cantidad || m.unidad);
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <label className={etiqueta}>
              Indicador
              <input className={control} value={m.indicador} required={usada} maxLength={160} onChange={(e) => cambiar(i, "indicador", e.target.value)} />
            </label>
            <label className={etiqueta}>
              Cantidad
              <input className={control} type="number" min="0" step="any" value={m.cantidad} required={usada} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
            </label>
            <label className={etiqueta}>
              Unidad
              <input className={control} value={m.unidad} required={usada} maxLength={80} onChange={(e) => cambiar(i, "unidad", e.target.value)} />
            </label>
            <button type="button" className={botonSecundario} onClick={() => onChange(valor.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        );
      })}
      {valor.length < max && (
        <button type="button" className={botonSecundario} onClick={() => onChange([...valor, { indicador: "", cantidad: "", unidad: "" }])}>
          {textoAgregar}
        </button>
      )}
    </div>
  );
}

/** Only complete rows are sent, as in the original form. */
export const metricasCompletas = (valor: CoeMetrica[]) =>
  valor
    .map((m) => ({ indicador: m.indicador.trim(), cantidad: m.cantidad.trim(), unidad: m.unidad.trim() }))
    .filter((m) => m.indicador && m.cantidad !== "" && m.unidad);
