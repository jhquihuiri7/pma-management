"use client";

import type { CoeMetrica } from "@/types";

// Plain Tailwind 3 classes: components/ui is written for Tailwind v4 variants
// and some of it (tabs) renders broken here.

export const tarjeta = "rounded-2xl border border-slate-100 bg-white p-5 shadow-sm";
export const control =
  "block h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/20 disabled:bg-slate-50";
export const areaTexto =
  "block min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/20";
export const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";
export const boton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:pointer-events-none disabled:opacity-50";
export const botonSecundario =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50";
export const tituloTarjeta = "text-base font-semibold text-slate-900";
export const aviso = "rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800 shadow-sm";

/**
 * Page header shared by the module's pages: the teal-to-emerald band of the
 * PMA, PG2030 and Geoportal dashboards, with the cards overlapping it below.
 */
export function Encabezado({
  icono: Icono,
  titulo,
  descripcion,
}: {
  icono: React.ComponentType<{ className?: string }>;
  titulo: string;
  descripcion: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-700 px-4 pb-24 pt-10 sm:px-6 sm:pt-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />
      <div className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <Icono className="h-6 w-6 text-teal-200" />
            <span className="text-sm font-medium uppercase tracking-widest text-teal-200">COE Provincial de Galápagos</span>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-white sm:text-3xl">{titulo}</h1>
          <p className="max-w-2xl text-base text-teal-100">{descripcion}</p>
        </div>
        <div className="hidden shrink-0 rounded-xl bg-white px-3 py-2 shadow-sm md:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/coe-reporte/logo-coe-galapagos.webp" alt="COE Provincial de Galápagos" width={168} height={70} />
        </div>
      </div>
    </div>
  );
}

/** Content column that overlaps the header band. */
export function Contenido({ children }: { children: React.ReactNode }) {
  return <div className="relative z-10 mx-auto -mt-12 max-w-7xl space-y-6 px-4 pb-16 sm:px-6">{children}</div>;
}

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
