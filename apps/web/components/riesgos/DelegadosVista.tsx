"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatoFecha } from "@/lib/riesgos";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import BotonesExportar from "./BotonesExportar";
import { selectClass } from "./campos";
import type { RiesgosCatalogos, RiesgosContacto, RiesgosDelegacion, RiesgosDelegado } from "@/types";

/** Every designation of delegates to the COE Provincial. */
export default function DelegadosVista({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [isla, setIsla] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<RiesgosDelegacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => new URLSearchParams(Object.entries({ isla, q }).filter(([, v]) => v)).toString(), [isla, q]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(busqueda.trim()), 350);
    return () => clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    let cancelled = false;
    setFilas(null);
    api.get<RiesgosDelegacion[]>(`/riesgos/delegaciones${query ? `?${query}` : ""}`)
      .then((data) => { if (!cancelled) { setFilas(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "No se pudieron cargar los delegados")); });
    return () => { cancelled = true; };
  }, [query]);

  const persona = (p: RiesgosContacto | RiesgosDelegado) => (
    <>
      <span className="font-medium">{p.nombre}</span>
      <span className="block text-xs text-muted-foreground">{p.cargo}</span>
      <span className="block text-xs text-muted-foreground">{p.correo} · {p.telefono}</span>
      {"documento" in p && p.documento && <span className="block text-xs text-muted-foreground">Identificación: {p.documento}</span>}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filtrar por isla" className={`${selectClass} sm:w-48`} value={isla} onChange={(e) => setIsla(e.target.value)}>
          <option value="">Todas las islas</option>
          {catalogos.islas.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Buscar delegados" placeholder="Institución, reportante, delegado o mesa" className="pl-8"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <BotonesExportar ruta={`/riesgos/exportar/delegaciones${query ? `?${query}` : ""}`} nombre="Delegados_COE_Provincial" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!filas && !error ? <Skeleton className="h-64 w-full" /> : filas && (
        <Card>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Institución</TableHead>
                  <TableHead>Isla / Mesa</TableHead>
                  <TableHead>Persona que reporta</TableHead>
                  <TableHead>Delegado principal</TableHead>
                  <TableHead>Delegado alterno</TableHead>
                  <TableHead>Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No hay designaciones con estos filtros.</TableCell></TableRow>
                ) : filas.map((d) => (
                  <TableRow key={d.id} className="align-top">
                    <TableCell className="whitespace-normal"><span className="font-medium">{d.institucionNombre}</span><span className="block text-xs text-muted-foreground">{d.institucionTipo}</span></TableCell>
                    <TableCell className="max-w-56 whitespace-normal">{d.isla}<span className="block text-xs text-muted-foreground">{d.mesaGrupo}</span></TableCell>
                    <TableCell className="whitespace-normal">{persona(d.reporta)}</TableCell>
                    <TableCell className="whitespace-normal">{persona(d.principal)}</TableCell>
                    <TableCell className="whitespace-normal">{persona(d.alterno)}</TableCell>
                    <TableCell>{formatoFecha(d.createdAt)}<span className="block font-mono text-xs text-muted-foreground">{d.codigo}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
