"use client";

import type { CoeMetrica } from "@/types";
import { EditorMetricas, areaTexto, control, etiqueta, metricasCompletas } from "./estilos";

// The result of an activity (19h00 cut): whether it was done, the reason when
// it was not, a description and optional numeric results. For a programmed
// activity each planned goal gets its own quantity field.

export interface EstadoResultado {
  cumplida: "" | "si" | "no";
  estado: "" | "partial" | "missed";
  motivo: string;
  resultado: string;
  numerosPlan: string[];
  extras: CoeMetrica[];
}

export const resultadoVacio = (metas: CoeMetrica[] = []): EstadoResultado => ({
  cumplida: "",
  estado: "",
  motivo: "",
  resultado: "",
  numerosPlan: metas.map(() => ""),
  extras: [],
});

export type ResultadoLeido = {
  estado: "done" | "partial" | "missed" | "extra";
  resultado: string;
  motivo: string;
  numeros: CoeMetrica[];
};

/** The values to send, or the message to show when something is missing. */
export function leerResultado(
  valor: EstadoResultado,
  metas: CoeMetrica[],
  esExtra: boolean,
): ResultadoLeido | string {
  const resultado = valor.resultado.trim();
  if (!esExtra && !valor.cumplida) return "Indica si se cumplió la actividad programada.";
  if (!esExtra && valor.cumplida === "no" && (!valor.estado || !valor.motivo.trim())) {
    return "Indica el estado de ejecución y el motivo.";
  }
  if (!resultado) return "Escribe la descripción del resultado.";
  const numeros = metas
    .flatMap((m, i) => (valor.numerosPlan[i]?.trim() ? [{ ...m, cantidad: valor.numerosPlan[i].trim() }] : []))
    .concat(metricasCompletas(valor.extras));
  return {
    estado: esExtra ? "extra" : valor.cumplida === "si" ? "done" : (valor.estado as "partial" | "missed"),
    resultado,
    motivo: !esExtra && valor.cumplida === "no" ? valor.motivo.trim() : "",
    numeros,
  };
}

export default function CamposResultado({
  valor,
  onChange,
  metas,
  esExtra,
}: {
  valor: EstadoResultado;
  onChange: (valor: EstadoResultado) => void;
  metas: CoeMetrica[];
  esExtra: boolean;
}) {
  const poner = <K extends keyof EstadoResultado>(campo: K, v: EstadoResultado[K]) => onChange({ ...valor, [campo]: v });
  return (
    <div className="space-y-4">
      {!esExtra && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={etiqueta}>
            ¿Se cumplió la actividad programada?
            <select className={control} required value={valor.cumplida} onChange={(e) => poner("cumplida", e.target.value as EstadoResultado["cumplida"])}>
              <option value="">Seleccione</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </label>
          {valor.cumplida === "no" && (
            <label className={etiqueta}>
              Estado de ejecución
              <select className={control} required value={valor.estado} onChange={(e) => poner("estado", e.target.value as EstadoResultado["estado"])}>
                <option value="">Seleccione</option>
                <option value="partial">Avance parcial</option>
                <option value="missed">No ejecutada</option>
              </select>
            </label>
          )}
          {valor.cumplida === "no" && (
            <label className={`${etiqueta} sm:col-span-2`}>
              Motivo
              <textarea className={areaTexto} required maxLength={2500} value={valor.motivo} onChange={(e) => poner("motivo", e.target.value)} />
            </label>
          )}
        </div>
      )}
      <label className={etiqueta}>
        Descripción del resultado
        <textarea className={areaTexto} required maxLength={2500} value={valor.resultado} onChange={(e) => poner("resultado", e.target.value)} />
      </label>
      <fieldset className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Resultados numéricos (opcional)</legend>
        {metas.map((m, i) => (
          <label key={i} className={etiqueta}>
            {m.indicador} · Meta {m.cantidad} {m.unidad}
            <input
              className={control}
              type="number"
              min="0"
              step="any"
              value={valor.numerosPlan[i] ?? ""}
              onChange={(e) => poner("numerosPlan", valor.numerosPlan.map((n, j) => (j === i ? e.target.value : n)))}
            />
          </label>
        ))}
        <EditorMetricas valor={valor.extras} onChange={(extras) => poner("extras", extras)} />
      </fieldset>
    </div>
  );
}
