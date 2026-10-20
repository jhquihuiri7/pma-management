"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { CLASE_ESTADO, ETIQUETA_ESTADO_RECURSO } from "@/lib/riesgos";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import BotonesExportar from "./BotonesExportar";
import { selectClass } from "./campos";
import type { RiesgosCatalogos, RiesgosFichaResumen, RiesgosRecurso } from "@/types";

type Filtros = { isla: string; tipo: string; institucion: string; estado: string; q: string };

/** The provincial matrix: every declared resource, filtered on the server. */
export default function RecursosVista({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [filtros, setFiltros] = useState<Filtros>({ isla: "", tipo: "", institucion: "", estado: "", q: "" });
  const [busqueda, setBusqueda] = useState("");
  const [recursos, setRecursos] = useState<RiesgosRecurso[] | null>(null);
  const [instituciones, setInstituciones] = useState<Array<[string, string]>>([]);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString(), [filtros]);

  useEffect(() => {
    api.get<RiesgosFichaResumen[]>("/riesgos/fichas")
      .then((fichas) => {
        const mapa = new Map(fichas.map((f) => [f.institucionClave, f.institucionNombre]));
        setInstituciones(Array.from(mapa.entries()).sort((a, b) => a[1].localeCompare(b[1], "es")));
      })
      .catch(() => setInstituciones([]));
  }, []);

  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setFiltros((f) => (f.q === busqueda.trim() ? f : { ...f, q: busqueda.trim() })), 350);
    return () => clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    let cancelled = false;
    setRecursos(null);
    api.get<RiesgosRecurso[]>(`/riesgos/recursos${query ? `?${query}` : ""}`)
      .then((data) => { if (!cancelled) { setRecursos(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "No se pudieron cargar los recursos")); });
    return () => { cancelled = true; };
  }, [query]);

  const filtro = (campo: keyof Filtros, etiqueta: string, opciones: Array<[string, string]>) => (
    <select aria-label={etiqueta} className={`${selectClass} sm:w-auto`} value={filtros[campo]}
      onChange={(e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }))}>
      <option value="">{etiqueta}</option>
      {opciones.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filtro("isla", "Todas las islas", catalogos.islas.map((i) => [i, i]))}
        {filtro("tipo", "Todos los tipos", catalogos.tiposRecurso.map((t) => [t, t]))}
        {filtro("institucion", "Todas las instituciones", instituciones)}
        {filtro("estado", "Todos los estados", (["pendiente", "validado", "excluido"] as const).map((e) => [e, ETIQUETA_ESTADO_RECURSO[e]]))}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Buscar recurso o institución" placeholder="Buscar recurso o institución" className="pl-8"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <BotonesExportar ruta={`/riesgos/exportar/recursos${query ? `?${query}` : ""}`} nombre="Matriz_recursos_COE" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!recursos && !error ? (
        <Skeleton className="h-64 w-full" />
      ) : recursos && (
        <Card>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recurso</TableHead>
                  <TableHead>Institución</TableHead>
                  <TableHead>Isla</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Existente</TableHead>
                  <TableHead className="text-right">Operativo</TableHead>
                  <TableHead className="text-right">Movilizable</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recursos.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No hay recursos con estos filtros.</TableCell></TableRow>
                ) : recursos.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="font-medium">{r.nombre}</span>
                      <span className="block text-xs text-muted-foreground">{r.ubicacion} · {r.unidad}{r.esTitular ? "" : " · no titular"}</span>
                    </TableCell>
                    <TableCell className="whitespace-normal">{r.institucionNombre}</TableCell>
                    <TableCell>{r.isla}</TableCell>
                    <TableCell>{r.tipo}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.cantidadExistente}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.cantidadOperativa}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold">{r.movilizableConsolidado}</span>
                      <span className="block text-xs text-muted-foreground">declarado: {r.cantidadMovilizable}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASE_ESTADO[r.estado]}`}>{ETIQUETA_ESTADO_RECURSO[r.estado]}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Movilizable consolidado = cantidad declarada de recursos validados y de titularidad institucional. Compare
        cantidades solo dentro de un mismo tipo y unidad.
      </p>
    </div>
  );
}
