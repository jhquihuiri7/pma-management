"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RiesgosCatalogos, RiesgosResumen } from "@/types";

const numero = new Intl.NumberFormat("es-EC");

export default function ResumenVista({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [resumen, setResumen] = useState<RiesgosResumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<RiesgosResumen>("/riesgos/resumen")
      .then((data) => { if (!cancelled) setResumen(data); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "No se pudo cargar el resumen")); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!resumen) return <Skeleton className="h-80 w-full" />;

  const indicadores = [
    { etiqueta: "Instituciones registradas", valor: resumen.instituciones, nota: "Con al menos una ficha" },
    { etiqueta: "Fichas recibidas", valor: resumen.fichas, nota: "Cuentan desde que se envían" },
    { etiqueta: "Recursos declarados", valor: resumen.recursos, nota: "Incluye referencias no titulares" },
    { etiqueta: "Delegaciones al COE", valor: resumen.delegaciones, nota: "Designaciones recibidas" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {indicadores.map((i) => (
          <Card key={i.etiqueta}>
            <CardContent className="pt-1">
              <p className="text-xs text-muted-foreground">{i.etiqueta}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{numero.format(i.valor)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{i.nota}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capacidad movilizable</CardTitle>
          <p className="text-xs text-muted-foreground">
            Solo recursos de titularidad de la institución. Si una institución declara el mismo recurso en otra ficha,
            cuenta la declaración más reciente. Las cantidades se suman dentro de un mismo tipo y unidad de medida:
            personas, vehículos o litros nunca comparten un total.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {resumen.capacidad.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay recursos registrados.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Unidad</th>
                  {catalogos.islas.map((isla) => <th key={isla} className="py-2 pr-3 text-right">{isla}</th>)}
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 text-right">Recursos</th>
                </tr>
              </thead>
              <tbody>
                {resumen.capacidad.map((fila) => (
                  <tr key={`${fila.tipo}|${fila.unidad}`} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{fila.tipo}</td>
                    <td className="py-2 pr-3">{fila.unidad}</td>
                    {catalogos.islas.map((isla) => (
                      <td key={isla} className="py-2 pr-3 text-right tabular-nums">{fila.porIsla[isla] ? numero.format(fila.porIsla[isla]) : "—"}</td>
                    ))}
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{numero.format(fila.total)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{fila.recursos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recursos movilizables por tipo</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {resumen.porTipo.map((fila) => (
              <div key={fila.tipo} className="flex justify-between border-b pb-2 text-sm last:border-0">
                <span>{fila.tipo}</span><span className="font-semibold tabular-nums">{fila.recursos}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recursos movilizables por institución</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {resumen.porInstitucion.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin recursos registrados.</p>
            ) : resumen.porInstitucion.map((fila) => (
              <div key={fila.institucionNombre} className="flex justify-between gap-3 border-b pb-2 text-sm last:border-0">
                <span>{fila.institucionNombre}</span><span className="font-semibold tabular-nums">{fila.recursos}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
