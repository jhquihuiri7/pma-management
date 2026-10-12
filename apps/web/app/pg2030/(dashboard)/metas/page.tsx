"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
import { api, apiErrorMessage, requireOkReceipt } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { ESTADO_CORTE, formatFecha } from "@/lib/pg2030";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import MetaCard from "@/components/pg2030/MetaCard";
import MetaDialog, { type MetaDialogModo, type ProyectoOpcion } from "@/components/pg2030/MetaDialog";
import PlanificacionDialog from "@/components/pg2030/PlanificacionDialog";
import EjecucionDialog from "@/components/pg2030/EjecucionDialog";
import type { Pg2030Anio, Pg2030Catalogo, Pg2030Institucion, Pg2030MetasPayload } from "@/types";

const selectClass = "flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm";

/** The 139 projects, in catalog order, with the code of the Plan's meta they hang from. */
function proyectosDelCatalogo(catalogo: Pg2030Catalogo): ProyectoOpcion[] {
  const out: ProyectoOpcion[] = [];
  for (const eje of catalogo.ejes)
    for (const objetivo of eje.objetivos)
      for (const politica of objetivo.politicas)
        for (const estrategia of politica.estrategias)
          for (const meta of estrategia.metas)
            for (const p of meta.proyectos) out.push({ id: p.id, codigo: p.codigo, nombre: p.nombre, metaPlanCodigo: meta.codigo });
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export default function Pg2030MetasPage() {
  const { user: session } = useAuth();
  const esReportero = session?.role === "REPORTER";

  const [anios, setAnios] = useState<Pg2030Anio[] | null>(null);
  const [instituciones, setInstituciones] = useState<Pg2030Institucion[]>([]);
  const [proyectos, setProyectos] = useState<ProyectoOpcion[]>([]);
  const [anio, setAnio] = useState<number | null>(null);
  const [institucionId, setInstitucionId] = useState<string>("");
  const [payload, setPayload] = useState<Pg2030MetasPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const [metaDialog, setMetaDialog] = useState<MetaDialogModo | null>(null);
  const [planificandoId, setPlanificandoId] = useState<string | null>(null);
  const [reporte, setReporte] = useState<{ metaId: string; mes: number } | null>(null);
  const [pending, setPending] = useState(false);

  // Years, institutions and the catalog's projects load once.
  useEffect(() => {
    api.get<Pg2030Anio[]>("/pg2030/anios")
      .then((list) => {
        setAnios(list);
        if (list.length > 0) setAnio(list[0].anio);
      })
      .catch((error) => toast.error(apiErrorMessage(error, "No se pudieron cargar los años")));
    api.get<Pg2030Catalogo>("/pg2030/catalogo")
      .then((catalogo) => setProyectos(proyectosDelCatalogo(catalogo)))
      .catch((error) => toast.error(apiErrorMessage(error, "No se pudo cargar el catálogo")));
    if (!esReportero) {
      api.get<Pg2030Institucion[]>("/pg2030/instituciones")
        .then((list) => {
          setInstituciones(list);
          const first = list.find((i) => i.activa) ?? list[0];
          if (first) setInstitucionId(first.id);
        })
        .catch((error) => toast.error(apiErrorMessage(error, "No se pudieron cargar las instituciones")));
    }
  }, [esReportero]);

  const load = useCallback(async () => {
    if (anio === null || (!esReportero && !institucionId)) return;
    setLoading(true);
    try {
      const query = esReportero ? `anio=${anio}` : `anio=${anio}&institucionId=${institucionId}`;
      setPayload(await api.get<Pg2030MetasPayload>(`/pg2030/metas?${query}`));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar las metas"));
    } finally {
      setLoading(false);
    }
  }, [anio, institucionId, esReportero]);

  useEffect(() => { void load(); }, [load]);

  const planificando = payload?.metas.find((m) => m.id === planificandoId) ?? null;
  const reporteMeta = reporte ? payload?.metas.find((m) => m.id === reporte.metaId) ?? null : null;

  /**
   * Months a new goal cannot plan: those of closed cutoffs. An existing goal
   * already carries the institution's own locks (reopenings included).
   */
  const bloqueadosNuevaMeta = useMemo(() => {
    if (!payload) return Array(12).fill(false) as boolean[];
    if (payload.metas.length > 0) return payload.metas[0].meses.map((m) => m.bloqueado);
    return Array.from({ length: 12 }, (_, i) => {
      const corte = Math.max(Math.ceil((i + 1) / 3), payload.anio.primerCorte);
      return payload.anio.cortes[corte - 1].estado === "cerrado";
    });
  }, [payload]);

  async function toggleSinAcciones(declarada: boolean) {
    if (!payload?.institucion) return;
    setPending(true);
    try {
      requireOkReceipt(
        await api.put<unknown>(`/pg2030/anios/${payload.anio.anio}/sin-acciones/${payload.institucion.id}`, { declarada }),
        "El servidor no confirmó la declaración",
      );
      toast.success(declarada ? "Declaración registrada" : "Declaración retirada");
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo cambiar la declaración"));
    } finally {
      setPending(false);
    }
  }

  async function eliminar(metaId: string, nombre: string) {
    if (!confirm(`¿Eliminar la meta "${nombre}" con toda su planificación y sus reportes?`)) return;
    setPending(true);
    try {
      requireOkReceipt(await api.delete<unknown>(`/pg2030/metas/${metaId}`), "El servidor no confirmó la eliminación");
      toast.success("Meta eliminada");
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo eliminar la meta"));
    } finally {
      setPending(false);
    }
  }

  const institucion = payload?.institucion ?? null;
  const puedeCrear = Boolean(payload?.puedeEditar && institucion?.activa && !payload?.sinAcciones);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Planificación y reporte</h1>
        <p className="text-muted-foreground">
          Metas institucionales por proyecto del Plan: lo planificado mes a mes y lo ejecutado.
        </p>
      </div>

      {anios && anios.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Todavía no hay ningún año abierto.{" "}
            {session?.role === "ADMIN"
              ? <Link href="/pg2030/anios" className="font-medium text-teal-700 underline">Abre el primero en Años y cortes.</Link>
              : "El administrador debe abrir el año."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select className={`${selectClass} sm:w-40`} value={anio ?? ""} onChange={(e) => setAnio(Number(e.target.value))}
              aria-label="Año">
              {(anios ?? []).map((a) => <option key={a.anio} value={a.anio}>{a.anio}</option>)}
            </select>
            {!esReportero && (
              <select className={`${selectClass} sm:w-96`} value={institucionId} onChange={(e) => setInstitucionId(e.target.value)}
                aria-label="Institución">
                {instituciones.map((i) => (
                  <option key={i.id} value={i.id}>{i.sigla} — {i.nombre}{i.activa ? "" : " (inactiva)"}</option>
                ))}
              </select>
            )}
          </div>

          {payload && (
            <div className="flex flex-wrap gap-2">
              {payload.anio.cortes.map((c) => (
                <span key={c.trimestre} className={`rounded-md border px-2 py-1 text-xs ${ESTADO_CORTE[c.estado].className}`}>
                  <span className="font-semibold">T{c.trimestre}</span> · {ESTADO_CORTE[c.estado].label}
                  {c.habilitado && <> · hasta el {formatFecha(c.plazoCierre)}</>}
                </span>
              ))}
            </div>
          )}

          {!payload || loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !institucion ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-3 py-5 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                Tu usuario no tiene una institución asignada. Pide al administrador que te la asigne para planificar y reportar.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-900">
                    {institucion.nombre} <span className="font-mono text-teal-700">({institucion.sigla})</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    {payload.metas.length} meta(s) en {payload.anio.anio}
                    {payload.sinAcciones && ` · declaró no tener acciones vinculadas (${payload.sinAcciones.declaradoPorNombre})`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {payload.puedeEditar && payload.metas.length === 0 && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => toggleSinAcciones(!payload.sinAcciones)}>
                      {payload.sinAcciones ? "Retirar declaración" : "Declarar sin acciones vinculadas"}
                    </Button>
                  )}
                  {puedeCrear && (
                    <Button size="sm" onClick={() => setMetaDialog({
                      tipo: "crear", anio: payload.anio.anio, institucionId: institucion.id, bloqueados: bloqueadosNuevaMeta,
                    })}>
                      <Plus className="mr-1 h-4 w-4" />
                      Nueva meta
                    </Button>
                  )}
                </div>
              </div>

              {payload.metas.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-slate-500">
                    {payload.sinAcciones
                      ? "Sin metas: la institución declaró que no tiene acciones vinculadas al Plan este año."
                      : "Aún no hay metas para este año."}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {payload.metas.map((meta) => (
                    <MetaCard key={meta.id} meta={meta} puedeEditar={payload.puedeEditar}
                      onReportar={(mes) => setReporte({ metaId: meta.id, mes })}
                      onEditar={() => setMetaDialog({ tipo: "editar", meta })}
                      onPlanificar={() => setPlanificandoId(meta.id)}
                      onEliminar={() => eliminar(meta.id, meta.nombre)} />
                  ))}
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge variant="outline">Clic en un mes</Badge> para reportarlo o ver su reporte.
                    El candado indica un mes cerrado; el visto, un mes reportado.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      <MetaDialog modo={metaDialog} proyectos={proyectos} onClose={() => setMetaDialog(null)} onSaved={load} />
      <PlanificacionDialog meta={planificando} onClose={() => setPlanificandoId(null)} onSaved={load} />
      <EjecucionDialog meta={reporteMeta} mes={reporte?.mes ?? null} onClose={() => setReporte(null)} onSaved={load} />
    </div>
  );
}
