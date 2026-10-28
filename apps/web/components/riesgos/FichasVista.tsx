"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api-client";
import { formatoFecha } from "@/lib/riesgos";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiesgosCatalogos, RiesgosFicha, RiesgosFichaResumen } from "@/types";

/** Every institutional ficha, as submitted: they count without a review step. */
export default function FichasVista({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [fichas, setFichas] = useState<RiesgosFichaResumen[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<RiesgosFichaResumen[]>("/riesgos/fichas")
      .then((data) => { if (!cancelled) setFichas(data); })
      .catch((err) => toast.error(apiErrorMessage(err, "No se pudieron cargar las fichas")));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      {fichas && <p className="text-sm text-muted-foreground">{fichas.length} fichas recibidas</p>}

      {!fichas ? <Skeleton className="h-64 w-full" /> : (
        <Card>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Institución</TableHead>
                  <TableHead>Isla</TableHead>
                  <TableHead>Mesa o grupo</TableHead>
                  <TableHead className="text-right">Recursos</TableHead>
                  <TableHead>Recibida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fichas.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Aún no hay fichas registradas.</TableCell></TableRow>
                ) : fichas.map((f) => (
                  <TableRow key={f.id} className="cursor-pointer" onClick={() => setAbierta(f.id)}>
                    <TableCell className="font-mono text-xs">{f.codigo}</TableCell>
                    <TableCell className="whitespace-normal font-medium">{f.institucionNombre}<span className="block text-xs font-normal text-muted-foreground">{f.institucionTipo}</span></TableCell>
                    <TableCell>{f.isla}</TableCell>
                    <TableCell className="max-w-64 truncate" title={f.mesaGrupo}>{f.mesaGrupo}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.recursos}</TableCell>
                    <TableCell>{formatoFecha(f.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={abierta !== null} onOpenChange={(open) => !open && setAbierta(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {abierta && <DetalleFicha id={abierta} catalogos={catalogos} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetalleFicha({ id, catalogos }: { id: string; catalogos: RiesgosCatalogos }) {
  const [ficha, setFicha] = useState<RiesgosFicha | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<RiesgosFicha>(`/riesgos/fichas/${id}`)
      .then((data) => { if (!cancelled) setFicha(data); })
      .catch((err) => toast.error(apiErrorMessage(err, "No se pudo cargar la ficha")));
    return () => { cancelled = true; };
  }, [id]);

  if (!ficha) return <Skeleton className="h-64 w-full" />;

  const contacto = (titulo: string, p: RiesgosFicha["principal"]) => (
    <div>
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">{p.nombre} · {p.cargo}</dd>
      <dd className="text-xs text-muted-foreground">{p.correo} · {p.telefono}</dd>
    </div>
  );

  return (
    <>
      <DialogHeader>
        <p className="text-xs font-semibold tracking-widest text-teal-700">FICHA {ficha.codigo}</p>
        <DialogTitle className="text-lg">{ficha.institucionNombre}</DialogTitle>
      </DialogHeader>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Tipo de institución</dt><dd className="font-medium">{ficha.institucionTipo}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Mesa o grupo</dt><dd className="font-medium">{ficha.mesaGrupo}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Isla</dt><dd className="font-medium">{ficha.isla}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Recibida</dt><dd className="font-medium">{formatoFecha(ficha.createdAt)}</dd></div>
        {contacto("Delegado principal", ficha.principal)}
        {contacto("Delegado alterno", ficha.alterno)}
      </dl>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Recursos declarados ({ficha.detalleRecursos.length})</h3>
        {ficha.detalleRecursos.map((r) => {
          const etiquetas = new Map(catalogos.camposDetalle[r.tipo].map((c) => [c.clave, c.etiqueta]));
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-medium">{r.nombre}</p>
              <p className="text-xs text-muted-foreground">{r.tipo} · {r.ubicacion}</p>
              <p className="mt-1">
                {r.cantidadExistente} existentes · {r.cantidadOperativa} operativos · <strong>{r.cantidadMovilizable} movilizables</strong> ({r.unidad})
              </p>
              <p className="text-xs text-muted-foreground">{r.esTitular ? "Titular" : "Referencia no titular"} · {r.disponibilidad}</p>
              {!r.vigente && (
                <p className="text-xs text-amber-700">La institución lo declaró de nuevo en una ficha posterior; cuenta esa declaración.</p>
              )}
              {Object.entries(r.detalles).map(([clave, valor]) => (
                <p key={clave} className="text-xs text-muted-foreground">{etiquetas.get(clave) ?? clave}: {valor}</p>
              ))}
              {r.restricciones && <p className="text-xs text-muted-foreground">Restricciones: {r.restricciones}</p>}
            </div>
          );
        })}
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Brechas</dt><dd className="whitespace-pre-line">{ficha.brechas || "Sin brechas declaradas"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Observaciones</dt><dd className="whitespace-pre-line">{ficha.observaciones || "Sin observaciones"}</dd></div>
      </dl>
    </>
  );
}
