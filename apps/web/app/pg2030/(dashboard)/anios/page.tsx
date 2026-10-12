"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, LockOpen } from "lucide-react";
import { api, apiErrorMessage, requireOkReceipt } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { ESTADO_CORTE, ESTADO_INSTITUCION, MESES_CORTOS, formatFecha } from "@/lib/pg2030";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  Pg2030Anio,
  Pg2030BitacoraEntrada,
  Pg2030InstitucionAnio,
  Pg2030Reapertura,
  Pg2030Trimestre,
} from "@/types";

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

const ACCIONES: Record<string, string> = {
  reapertura: "Reapertura",
  mes_modificado: "Mes modificado",
  meta_modificada: "Meta modificada",
  meta_eliminada: "Meta eliminada",
};

function detalleBitacora(entrada: Pg2030BitacoraEntrada): string {
  const d = entrada.detalle as Record<string, unknown>;
  switch (entrada.accion) {
    case "reapertura":
      return `Hasta el ${formatFecha(String(d.fechaLimite))}: ${String(d.motivo ?? "")}`;
    case "mes_modificado": {
      const meses = Array.isArray(d.meses) ? (d.meses as Array<{ mes: number }>).map((m) => MESES_CORTOS[m.mes - 1]) : [];
      return `Meses: ${meses.join(", ")}`;
    }
    case "meta_modificada":
      return `Campos: ${Object.keys((d.cambios as Record<string, unknown>) ?? {}).join(", ")}`;
    case "meta_eliminada":
      return `${String(d.proyecto ?? "")} · ${String(d.nombre ?? "")}`;
    default:
      return "";
  }
}

const mesesDe = (t: Pg2030Trimestre) => `${MESES_CORTOS[3 * t - 3]}–${MESES_CORTOS[3 * t - 1]}`;

export default function Pg2030AniosPage() {
  const { user: session } = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const [anios, setAnios] = useState<Pg2030Anio[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  const [instituciones, setInstituciones] = useState<Pg2030InstitucionAnio[] | null>(null);
  const [reaperturas, setReaperturas] = useState<Pg2030Reapertura[]>([]);
  const [bitacora, setBitacora] = useState<Pg2030BitacoraEntrada[]>([]);
  const [pending, setPending] = useState(false);

  const [abrirOpen, setAbrirOpen] = useState(false);
  const [abrirForm, setAbrirForm] = useState({ anio: String(new Date().getFullYear()), primerCorte: "1", fechaLimiteCarga: "" });
  const [cargaOpen, setCargaOpen] = useState(false);
  const [nuevaCarga, setNuevaCarga] = useState("");
  const [reabrirOpen, setReabrirOpen] = useState(false);
  const [reabrirForm, setReabrirForm] = useState({ institucionId: "", trimestre: "", fechaLimite: "", motivo: "" });

  const loadAnios = useCallback(async () => {
    try {
      const list = await api.get<Pg2030Anio[]>("/pg2030/anios");
      setAnios(list);
      setSeleccionado((current) => current ?? list[0]?.anio ?? null);
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar los años"));
    }
  }, []);

  const loadDetalle = useCallback(async () => {
    if (seleccionado === null) return;
    try {
      const [inst, reap, bit] = await Promise.all([
        api.get<Pg2030InstitucionAnio[]>(`/pg2030/anios/${seleccionado}/instituciones`),
        api.get<Pg2030Reapertura[]>(`/pg2030/anios/${seleccionado}/reaperturas`),
        api.get<Pg2030BitacoraEntrada[]>(`/pg2030/anios/${seleccionado}/bitacora`),
      ]);
      setInstituciones(inst);
      setReaperturas(reap);
      setBitacora(bit);
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo cargar el detalle del año"));
    }
  }, [seleccionado]);

  useEffect(() => { void loadAnios(); }, [loadAnios]);
  useEffect(() => { void loadDetalle(); }, [loadDetalle]);

  const anio = anios?.find((a) => a.anio === seleccionado) ?? null;

  async function run(operation: () => Promise<unknown>, ok: string, fallback: string) {
    setPending(true);
    try {
      await operation();
      toast.success(ok);
      await Promise.all([loadAnios(), loadDetalle()]);
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, fallback));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    const numero = Number(abrirForm.anio);
    const done = await run(
      () => api.post<unknown>("/pg2030/anios", {
        anio: numero,
        primerCorte: Number(abrirForm.primerCorte),
        fechaLimiteCarga: abrirForm.fechaLimiteCarga || null,
      }),
      `Año ${numero} abierto`,
      "No se pudo abrir el año",
    );
    if (done) {
      setAbrirOpen(false);
      setSeleccionado(numero);
    }
  }

  async function ampliar(e: React.FormEvent) {
    e.preventDefault();
    if (!anio) return;
    const done = await run(
      () => api.patch<unknown>(`/pg2030/anios/${anio.anio}`, { fechaLimiteCarga: nuevaCarga }),
      "Carga inicial ampliada",
      "No se pudo ampliar la carga",
    );
    if (done) setCargaOpen(false);
  }

  async function reabrir(e: React.FormEvent) {
    e.preventDefault();
    if (!anio) return;
    const done = await run(
      () => api.post<unknown>(`/pg2030/anios/${anio.anio}/reaperturas`, {
        institucionId: reabrirForm.institucionId,
        trimestre: Number(reabrirForm.trimestre),
        fechaLimite: reabrirForm.fechaLimite,
        motivo: reabrirForm.motivo,
      }),
      "Corte reabierto",
      "No se pudo reabrir el corte",
    );
    if (done) setReabrirOpen(false);
  }

  const cortesCerrados = anio?.cortes.filter((c) => c.estado === "cerrado") ?? [];
  const cargaVigente = anio?.cortes.some((c) => c.estado === "en_carga") ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Años y cortes</h1>
          <p className="text-muted-foreground">
            Cada año se abre una vez; sus cortes trimestrales se cierran solos al vencer el plazo.
          </p>
        </div>
        <div className="flex gap-2">
          {anios && anios.length > 0 && (
            <select className={`${selectClass} w-32`} value={seleccionado ?? ""} aria-label="Año"
              onChange={(e) => setSeleccionado(Number(e.target.value))}>
              {anios.map((a) => <option key={a.anio} value={a.anio}>{a.anio}</option>)}
            </select>
          )}
          {isAdmin && (
            <Button onClick={() => setAbrirOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              Abrir año
            </Button>
          )}
        </div>
      </div>

      {!anios ? (
        <Skeleton className="h-40 w-full" />
      ) : !anio ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Todavía no hay ningún año abierto.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Cortes de {anio.anio}</CardTitle>
              <p className="text-xs text-slate-500">Abierto por {anio.abiertoPorNombre}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corte</TableHead>
                    <TableHead>Meses</TableHead>
                    <TableHead>Plazo base</TableHead>
                    <TableHead>Cierre</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anio.cortes.map((c) => (
                    <TableRow key={c.trimestre}>
                      <TableCell className="font-semibold">T{c.trimestre}</TableCell>
                      <TableCell>{mesesDe(c.trimestre)}</TableCell>
                      <TableCell>{formatFecha(c.plazoBase)}</TableCell>
                      <TableCell>{c.habilitado ? formatFecha(c.plazoCierre) : `con T${anio.primerCorte}`}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ESTADO_CORTE[c.estado].className}>{ESTADO_CORTE[c.estado].label}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {anio.fechaLimiteCarga && (
                <div className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    Carga inicial hasta el <span className="font-semibold">{formatFecha(anio.fechaLimiteCarga)}</span>.
                    Mientras dure, se editan todos los meses de sus cortes y el administrador puede reportar por las instituciones.
                  </p>
                  {isAdmin && cargaVigente && (
                    <Button size="sm" variant="outline" onClick={() => { setNuevaCarga(""); setCargaOpen(true); }}>
                      Ampliar
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Instituciones en {anio.anio}</CardTitle>
            </CardHeader>
            <CardContent>
              {!instituciones ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sigla</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Convocada</TableHead>
                      <TableHead>Metas</TableHead>
                      <TableHead>Estado</TableHead>
                      {isAdmin && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {instituciones.map((fila) => (
                      <TableRow key={fila.institucion.id}>
                        <TableCell className="font-mono font-semibold">{fila.institucion.sigla}</TableCell>
                        <TableCell className="whitespace-normal">{fila.institucion.nombre}</TableCell>
                        <TableCell>{fila.institucion.tipo}</TableCell>
                        <TableCell>
                          <input type="checkbox" checked={fila.convocada} disabled={!isAdmin || pending}
                            aria-label={`Convocar a ${fila.institucion.sigla}`}
                            onChange={(e) => run(
                              () => api.put<unknown>(`/pg2030/anios/${anio.anio}/convocatoria/${fila.institucion.id}`, { convocada: e.target.checked })
                                .then((r) => requireOkReceipt(r, "El servidor no confirmó el cambio")),
                              e.target.checked ? `${fila.institucion.sigla} convocada` : `${fila.institucion.sigla} sin convocar`,
                              "No se pudo cambiar la convocatoria",
                            )} />
                        </TableCell>
                        <TableCell>{fila.metas}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={ESTADO_INSTITUCION[fila.estado].className}>
                            {ESTADO_INSTITUCION[fila.estado].label}
                          </Badge>
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            {fila.metas === 0 && (
                              <Button size="xs" variant="ghost" disabled={pending}
                                onClick={() => run(
                                  () => api.put<unknown>(`/pg2030/anios/${anio.anio}/sin-acciones/${fila.institucion.id}`, { declarada: !fila.sinAcciones })
                                    .then((r) => requireOkReceipt(r, "El servidor no confirmó la declaración")),
                                  fila.sinAcciones ? "Declaración retirada" : "Declaración registrada",
                                  "No se pudo cambiar la declaración",
                                )}>
                                {fila.sinAcciones ? "Retirar «sin acciones»" : "Registrar «sin acciones»"}
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Reaperturas</CardTitle>
              {isAdmin && cortesCerrados.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => {
                  setReabrirForm({ institucionId: "", trimestre: String(cortesCerrados[cortesCerrados.length - 1].trimestre), fechaLimite: "", motivo: "" });
                  setReabrirOpen(true);
                }}>
                  <LockOpen className="mr-1 h-4 w-4" />
                  Reabrir corte
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {reaperturas.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">Sin reaperturas.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Institución</TableHead>
                      <TableHead>Corte</TableHead>
                      <TableHead>Hasta</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Por</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reaperturas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.institucion.sigla}</TableCell>
                        <TableCell>T{r.trimestre}</TableCell>
                        <TableCell>
                          {formatFecha(r.fechaLimite)}{" "}
                          {r.vigente && <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">vigente</Badge>}
                        </TableCell>
                        <TableCell className="whitespace-normal">{r.motivo}</TableCell>
                        <TableCell>{r.creadoPorNombre}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bitácora</CardTitle>
              <p className="text-xs text-slate-500">Reaperturas y todo cambio hecho después del cierre de un corte.</p>
            </CardHeader>
            <CardContent>
              {bitacora.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">Sin movimientos.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Institución</TableHead>
                      <TableHead>Corte</TableHead>
                      <TableHead>Acción</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead>Usuario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bitacora.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="whitespace-nowrap">{new Date(b.createdAt).toLocaleString("es-EC")}</TableCell>
                        <TableCell className="font-mono">{b.institucion.sigla}</TableCell>
                        <TableCell>T{b.trimestre}</TableCell>
                        <TableCell>{ACCIONES[b.accion] ?? b.accion}</TableCell>
                        <TableCell className="whitespace-normal text-xs">{detalleBitacora(b)}</TableCell>
                        <TableCell>{b.usuarioNombre}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={abrirOpen} onOpenChange={setAbrirOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Abrir año</DialogTitle></DialogHeader>
          <form onSubmit={abrir} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="anio-numero">Año</Label>
                <Input id="anio-numero" type="number" min={2020} max={2100} required value={abrirForm.anio}
                  onChange={(e) => setAbrirForm({ ...abrirForm, anio: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="anio-primer">Primer corte habilitado</Label>
                <select id="anio-primer" className={selectClass} value={abrirForm.primerCorte}
                  onChange={(e) => setAbrirForm({ ...abrirForm, primerCorte: e.target.value })}>
                  {[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="anio-carga">Fecha límite de carga inicial</Label>
              <Input id="anio-carga" type="date" value={abrirForm.fechaLimiteCarga}
                onChange={(e) => setAbrirForm({ ...abrirForm, fechaLimiteCarga: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                Solo si el plazo de algún corte habilitado ya venció (p. ej. 2026 desde el T2). Hasta esa fecha se editan
                todos sus meses, también los de cortes anteriores.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>{pending ? "Abriendo..." : "Abrir año"}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cargaOpen} onOpenChange={setCargaOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Ampliar carga inicial</DialogTitle></DialogHeader>
          <form onSubmit={ampliar} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="carga-nueva">Nueva fecha límite</Label>
              <Input id="carga-nueva" type="date" required value={nuevaCarga} onChange={(e) => setNuevaCarga(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>Ampliar</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={reabrirOpen} onOpenChange={setReabrirOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Reabrir corte</DialogTitle></DialogHeader>
          <form onSubmit={reabrir} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="reab-inst">Institución</Label>
              <select id="reab-inst" required className={selectClass} value={reabrirForm.institucionId}
                onChange={(e) => setReabrirForm({ ...reabrirForm, institucionId: e.target.value })}>
                <option value="">Elige la institución…</option>
                {(instituciones ?? []).map((f) => (
                  <option key={f.institucion.id} value={f.institucion.id}>{f.institucion.sigla} — {f.institucion.nombre}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="reab-corte">Corte</Label>
                <select id="reab-corte" className={selectClass} value={reabrirForm.trimestre}
                  onChange={(e) => setReabrirForm({ ...reabrirForm, trimestre: e.target.value })}>
                  {cortesCerrados.map((c) => <option key={c.trimestre} value={c.trimestre}>T{c.trimestre}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reab-fecha">Hasta</Label>
                <Input id="reab-fecha" type="date" required value={reabrirForm.fechaLimite}
                  onChange={(e) => setReabrirForm({ ...reabrirForm, fechaLimite: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reab-motivo">Motivo</Label>
              <textarea id="reab-motivo" required className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={reabrirForm.motivo} onChange={(e) => setReabrirForm({ ...reabrirForm, motivo: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>Reabrir</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
