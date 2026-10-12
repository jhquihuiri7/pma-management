import { Card, CardContent } from "@/components/ui/card";
import { formatUsd } from "@/lib/pg2030";
import type { Pg2030CatalogoResumen } from "@/types";

/** Cuadro 1 of the dashboard: what the Plan Galápagos 2030 contains. */
export default function ResumenPlan({ resumen }: { resumen: Pg2030CatalogoResumen }) {
  const tiles = [
    { label: "Ejes", value: resumen.ejes },
    { label: "Objetivos", value: resumen.objetivos },
    { label: "Políticas", value: resumen.politicas },
    { label: "Estrategias", value: resumen.estrategias },
    { label: "Metas", value: resumen.metas, hint: `${resumen.metasCuantificables} cuantificables` },
    { label: "Hitos al 2030", value: resumen.hitos2030 },
    { label: "Proyectos y acciones", value: resumen.proyectos },
  ];
  const sinMonto = resumen.proyectos - resumen.presupuesto.proyectosConMonto;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((tile) => (
          <Card key={tile.label} className="rounded-xl border border-slate-100 bg-white shadow-sm">
            <CardContent className="py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{tile.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{tile.value}</p>
              {tile.hint && <p className="text-xs text-slate-500">{tile.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="rounded-xl border border-slate-100 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Presupuesto referencial</p>
            <p className="mt-1 text-2xl font-bold text-teal-700">{formatUsd(resumen.presupuesto.total)}</p>
            <p className="text-xs text-slate-500">
              {resumen.presupuesto.proyectosConMonto} de {resumen.proyectos} proyectos tienen monto; {sinMonto} no tienen valoración.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            {Object.entries(resumen.presupuesto.porEstado)
              .filter(([estado, count]) => estado !== "Monto" && count > 0)
              .map(([estado, count]) => (
                <span key={estado} className="rounded-md bg-slate-100 px-2 py-1">
                  {estado}: <span className="font-semibold">{count}</span>
                </span>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
