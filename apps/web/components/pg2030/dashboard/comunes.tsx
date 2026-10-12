"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Text and chrome tokens: data never colors text (dataviz rule). */
export const INK = { primary: "#0f172a", secondary: "#475569", muted: "#94a3b8", grid: "#e2e8f0", surface: "#ffffff" };

export function Cuadro({
  numero,
  titulo,
  descripcion,
  accion,
  children,
}: {
  numero: number;
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base text-slate-900">
            <span className="mr-2 text-xs font-medium text-slate-400">Cuadro {numero}</span>
            {titulo}
          </CardTitle>
          {descripcion && <p className="mt-1 text-xs text-slate-500">{descripcion}</p>}
        </div>
        {accion}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** A status always travels with its label, never as color alone. */
export function Estado({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  );
}

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Legend row for two or more series: swatch beside text, text in ink. */
export function Leyenda({ items }: { items: Array<{ label: string; color: string; forma?: "barra" | "punto" }> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span
            className={it.forma === "punto" ? "h-2.5 w-2.5 rounded-full" : "h-2.5 w-3.5 rounded-sm"}
            style={{ backgroundColor: it.color }}
            aria-hidden
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export const tooltipStyle = {
  contentStyle: { borderRadius: 8, borderColor: INK.grid, fontSize: 12, color: INK.primary },
  labelStyle: { color: INK.secondary, fontWeight: 600 },
};

/** Every chart carries its data as a table (dataviz rule), folded so it doesn't crowd the page. */
export function VerTabla({ children }: { children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-100">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900">
        Ver los datos en tabla
      </summary>
      <div className="border-t border-slate-100 px-1 pb-1">{children}</div>
    </details>
  );
}
