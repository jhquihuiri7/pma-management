"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, CircleSlash, RotateCcw } from "lucide-react";
import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { CLASE_ESTADO, ETIQUETA_ESTADO, formatoFecha } from "@/lib/riesgos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { selectClass, textareaClass } from "./campos";
import type { RiesgosCatalogos, RiesgosEstado, RiesgosFicha, RiesgosFichaResumen } from "@/types";

/** Institutional fichas waiting for, or past, the coordinator's review. */
export default function FichasVista({ catalogos, esAdmin }: { catalogos: RiesgosCatalogos; esAdmin: boolean }) {
  const [estado, setEstado] = useState("");
  const [fichas, setFichas] = useState<RiesgosFichaResumen[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFichas(await api.get<RiesgosFichaResumen[]>(`/riesgos/fichas${estado ? `?estado=${estado}` : ""}`));
    } catch (err) {
      toast.error(apiErrorMessage(err, "No se pudieron cargar las fichas"));
    }
  }, [estado]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filtrar por estado" className={`${selectClass} sm:w-56`} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todas las fichas</option>
          {(["pendiente", "validado", "excluido"] as const).map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}s</option>)}
        </select>
        {fichas && <span className="text-sm text-muted-foreground">{fichas.length} fichas</span>}
      </div>

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
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fichas.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Aún no hay fichas registradas.</TableCell></TableRow>
                ) : fichas.map((f) => (
                  <TableRow key={f.id} className="cursor-pointer" onClick={() => setAbierta(f.id)}>
                    <TableCell className="font-mono text-xs">{f.codigo}</TableCell>
                    <TableCell className="whitespace-normal font-medium">{f.institucionNombre}<span className="block text-xs font-normal text-muted-foreground">{f.institucionTipo}</span></TableCell>
                    <TableCell>{f.isla}</TableCell>
                    <TableCell className="max-w-64 truncate" title={f.mesaGrupo}>{f.mesaGrupo}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.recursos}</TableCell>
                    <TableCell>{formatoFecha(f.createdAt)}</TableCell>
                    <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASE_ESTADO[f.estado]}`}>{ETIQUETA_ESTADO[f.estado]}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={abierta !== null} onOpenChange={(open) => !open && setAbierta(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {abierta && (
            <DetalleFicha
              id={abierta}
              catalogos={catalogos}
              esAdmin={esAdmin}
              onRevisada={() => { setAbierta(null); void cargar(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetalleFicha({
  id,
  catalogos,
  esAdmin,
  onRevisada,
}: {
  id: string;
  catalogos: RiesgosCatalogos;
  esAdmin: boolean;
  onRevisada: () => void;
}) {
  const [ficha, setFicha] = useState<RiesgosFicha | null>(null);
  const [nota, setNota] = useState("");
  const [pendiente, setPendiente] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<RiesgosFicha>(`/riesgos/fichas/${id}`)
      .then((data) => { if (!cancelled) { setFicha(data); setNota(data.notaRevision); } })
      .catch((err) => toast.error(apiErrorMessage(err, "No se pudo cargar la ficha")));
    return () => { cancelled = true; };
  }, [id]);

  async function revisar(estado: RiesgosEstado) {
    setPendiente(true);
    try {
      const revisada = await api.put<RiesgosFicha>(`/riesgos/fichas/${id}/revision`, { estado, nota });
      requirePersistedEntity(revisada, "El servidor no confirmó la revisión");
      toast.success(`Ficha de ${revisada.institucionNombre}: ${ETIQUETA_ESTADO[estado].toLowerCase()}`);
      onRevisada();
    } catch (err) {
      toast.error(apiErrorMessage(err, "No se pudo guardar la revisión"));
    } finally {
      setPendiente(false);
    }
  }

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
        <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${CLASE_ESTADO[ficha.estado]}`}>{ETIQUETA_ESTADO[ficha.estado]}</span>
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
              <p className="text-xs text-muted-foreground">{r.tipo} · {r.isla} · {r.ubicacion}</p>
              <p className="mt-1">
                {r.cantidadExistente} existentes · {r.cantidadOperativa} operativos · <strong>{r.cantidadMovilizable} movilizables</strong> ({r.unidad})
              </p>
              <p className="text-xs text-muted-foreground">{r.esTitular ? "Titular" : "Referencia no titular"} · {r.disponibilidad}</p>
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

      {ficha.revisadoAt && (
        <p className="text-xs text-muted-foreground">
          Última revisión: {formatoFecha(ficha.revisadoAt)}{ficha.revisadoPorNombre ? ` por ${ficha.revisadoPorNombre}` : ""}
        </p>
      )}

      {esAdmin ? (
        <div className="space-y-3 border-t pt-4">
          <label htmlFor="nota-revision" className="text-sm font-medium">Nota de revisión</label>
          <textarea id="nota-revision" className={textareaClass} value={nota} maxLength={1000}
            placeholder="Motivo de la validación o de la exclusión" onChange={(e) => setNota(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={pendiente} onClick={() => revisar("excluido")}>
              <CircleSlash /> Excluir ficha
            </Button>
            <Button type="button" variant="outline" disabled={pendiente} onClick={() => revisar("pendiente")}>
              <RotateCcw /> Dejar pendiente
            </Button>
            <Button type="button" disabled={pendiente} onClick={() => revisar("validado")}>
              <Check /> Validar ficha
            </Button>
          </div>
        </div>
      ) : ficha.notaRevision ? (
        <p className="border-t pt-4 text-sm"><span className="text-muted-foreground">Nota de revisión:</span> {ficha.notaRevision}</p>
      ) : null}
    </>
  );
}
