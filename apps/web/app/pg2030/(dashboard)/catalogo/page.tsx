"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Search, TriangleAlert } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatUsd } from "@/lib/pg2030";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import ResumenPlan from "@/components/pg2030/ResumenPlan";
import ProyectoDialog from "@/components/pg2030/ProyectoDialog";
import TextoNivelDialog, { type NivelEditable } from "@/components/pg2030/TextoNivelDialog";
import type { Pg2030Catalogo, Pg2030Eje, Pg2030MetaPlan, Pg2030Proyecto } from "@/types";

/** Case- and accent-insensitive: "habitat" finds "HÁBITAT". */
function normalize(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function hasPendingConflict(p: Pg2030Proyecto): boolean {
  return p.conflictos.some((c) => !c.revisado);
}

type Filters = { query: string; ejeId: string; soloConflictos: boolean };

/**
 * Prune the tree to what the filters let through. A match on a level's own
 * code or text keeps its whole subtree; otherwise only matching projects (and
 * their ancestors) survive.
 */
function filterTree(ejes: Pg2030Eje[], { query, ejeId, soloConflictos }: Filters): Pg2030Eje[] {
  const q = normalize(query.trim());
  const matches = (...values: Array<string | null>) => q !== "" && values.some((v) => normalize(v).includes(q));
  const keepProyecto = (p: Pg2030Proyecto, ancestorMatched: boolean) =>
    (!soloConflictos || hasPendingConflict(p)) &&
    (q === "" || ancestorMatched ||
      matches(p.codigo, p.nombre, p.entidadesEjecutoras, p.responsablesPlan, p.hito2023, p.hito2030));

  return ejes
    .filter((eje) => ejeId === "todos" || eje.id === ejeId)
    .map((eje) => {
      const ejeHit = matches(eje.codigo, eje.nombre);
      const objetivos = eje.objetivos.map((objetivo) => {
        const objetivoHit = ejeHit || matches(objetivo.codigo, objetivo.texto);
        const politicas = objetivo.politicas.map((politica) => {
          const politicaHit = objetivoHit || matches(politica.codigo, politica.texto);
          const estrategias = politica.estrategias.map((estrategia) => {
            const estrategiaHit = politicaHit || matches(estrategia.codigo, estrategia.texto);
            const metas = estrategia.metas.map((meta) => {
              const metaHit = estrategiaHit || matches(meta.codigo, meta.texto);
              return { ...meta, proyectos: meta.proyectos.filter((p) => keepProyecto(p, metaHit)) };
            }).filter((meta) => meta.proyectos.length > 0);
            return { ...estrategia, metas };
          }).filter((estrategia) => estrategia.metas.length > 0);
          return { ...politica, estrategias };
        }).filter((politica) => politica.estrategias.length > 0);
        return { ...objetivo, politicas };
      }).filter((objetivo) => objetivo.politicas.length > 0);
      return { ...eje, objetivos };
    })
    .filter((eje) => eje.objetivos.length > 0);
}

function countProyectos(eje: Pg2030Eje): number {
  return eje.objetivos.reduce((n, o) => n + o.politicas.reduce((m, p) => m + p.estrategias.reduce(
    (k, s) => k + s.metas.reduce((j, meta) => j + meta.proyectos.length, 0), 0), 0), 0);
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon-xs" className="shrink-0 text-slate-400 hover:text-slate-700" title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}>
      <Pencil />
    </Button>
  );
}

function ProyectoRow({ proyecto, onOpen }: { proyecto: Pg2030Proyecto; onOpen: () => void }) {
  const pendiente = hasPendingConflict(proyecto);
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-teal-50">
      <span className="mt-0.5 font-mono text-xs font-semibold text-teal-700">{proyecto.codigo}</span>
      <span className="flex-1 text-sm text-slate-700 line-clamp-2">{proyecto.nombre}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {pendiente && (
          <span title="Diferencias del Excel pendientes de revisión">
            <TriangleAlert className="h-4 w-4 text-amber-500" />
          </span>
        )}
        <Badge variant="outline" className="hidden sm:inline-flex">{proyecto.tipo}</Badge>
        <span className="hidden w-32 text-right text-xs text-slate-500 md:inline">
          {proyecto.presupuestoReferencial !== null ? formatUsd(proyecto.presupuestoReferencial) : proyecto.presupuestoEstado}
        </span>
      </span>
    </button>
  );
}

export default function Pg2030CatalogoPage() {
  const { user: session } = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const [catalogo, setCatalogo] = useState<Pg2030Catalogo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ query: "", ejeId: "todos", soloConflictos: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textoTarget, setTextoTarget] = useState<NivelEditable | null>(null);

  const load = useCallback(async () => {
    try {
      setCatalogo(await api.get<Pg2030Catalogo>("/pg2030/catalogo"));
      setLoadError(null);
    } catch (error) {
      const message = apiErrorMessage(error, "No se pudo cargar el catálogo");
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtering = filters.query.trim() !== "" || filters.ejeId !== "todos" || filters.soloConflictos;
  const ejes = useMemo(() => (catalogo ? filterTree(catalogo.ejes, filters) : []), [catalogo, filters]);

  // Look the selection up on every render so a reload hands the dialog fresh data.
  const selected = useMemo(() => {
    if (!catalogo || !selectedId) return null;
    for (const eje of catalogo.ejes)
      for (const objetivo of eje.objetivos)
        for (const politica of objetivo.politicas)
          for (const estrategia of politica.estrategias)
            for (const meta of estrategia.metas) {
              const proyecto = meta.proyectos.find((p) => p.id === selectedId);
              if (proyecto) return { proyecto, meta: meta as Pg2030MetaPlan };
            }
    return null;
  }, [catalogo, selectedId]);

  const visibleProyectos = ejes.reduce((n, eje) => n + countProyectos(eje), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Catálogo del Plan Galápagos 2030</h1>
        <p className="text-muted-foreground">
          Ejes, objetivos, políticas, estrategias, metas y los 139 proyectos y acciones sobre los que planifican las instituciones.
        </p>
      </div>

      {!catalogo ? (
        loadError ? (
          <Card><CardContent className="py-10 text-center text-sm text-red-600">{loadError}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )
      ) : (
        <>
          <ResumenPlan resumen={catalogo.resumen} />

          {isAdmin && catalogo.resumen.conflictosPendientes > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-amber-900">
                <TriangleAlert className="h-4 w-4" />
                {catalogo.resumen.conflictosPendientes} diferencia(s) del Excel original esperan tu revisión.
              </p>
              <Button size="sm" variant="outline"
                onClick={() => setFilters((f) => ({ ...f, soloConflictos: !f.soloConflictos }))}>
                {filters.soloConflictos ? "Ver todos los proyectos" : "Ver solo esos proyectos"}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder="Buscar por código, proyecto, entidad, hito o texto de la meta…"
                value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} />
            </div>
            <select className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-72"
              value={filters.ejeId} onChange={(e) => setFilters((f) => ({ ...f, ejeId: e.target.value }))}>
              <option value="todos">Todos los ejes</option>
              {catalogo.ejes.map((eje) => <option key={eje.id} value={eje.id}>{eje.nombre}</option>)}
            </select>
          </div>

          {filtering && (
            <p className="text-sm text-slate-500">
              {visibleProyectos} de {catalogo.resumen.proyectos} proyectos coinciden con el filtro.
            </p>
          )}

          {ejes.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-slate-500">Ningún proyecto coincide con el filtro.</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {ejes.map((eje, index) => (
                <details key={`${eje.id}-${filtering}`} open={filtering || index === 0}
                  className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
                    <Badge className="bg-teal-600 text-white">{eje.codigo}</Badge>
                    <span className="flex-1 font-semibold text-slate-900">{eje.nombre}</span>
                    {isAdmin && (
                      <EditButton label="Corregir el nombre del eje"
                        onClick={() => setTextoTarget({ nivel: "ejes", id: eje.id, codigo: eje.codigo, texto: eje.nombre })} />
                    )}
                    <span className="text-xs text-slate-500">
                      {countProyectos(eje)} {countProyectos(eje) === 1 ? "proyecto" : "proyectos"}
                    </span>
                  </summary>
                  <div className="space-y-5 border-t border-slate-100 px-5 py-4">
                    {eje.objetivos.map((objetivo) => (
                      <div key={objetivo.id} className="space-y-4">
                        <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                          <p className="flex-1 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">Objetivo {objetivo.codigo}: </span>
                            {objetivo.texto}
                          </p>
                          {isAdmin && (
                            <EditButton label="Corregir el objetivo"
                              onClick={() => setTextoTarget({ nivel: "objetivos", id: objetivo.id, codigo: objetivo.codigo, texto: objetivo.texto })} />
                          )}
                        </div>
                        {objetivo.politicas.map((politica) => (
                          <div key={politica.id} className="space-y-3">
                            <div className="flex items-start gap-2">
                              <h3 className="flex-1 text-sm font-semibold text-slate-900">
                                <span className="mr-2 font-mono text-teal-700">{politica.codigo}</span>
                                {politica.texto}
                              </h3>
                              {isAdmin && (
                                <EditButton label="Corregir la política"
                                  onClick={() => setTextoTarget({ nivel: "politicas", id: politica.id, codigo: politica.codigo, texto: politica.texto })} />
                              )}
                            </div>
                            {politica.estrategias.map((estrategia) => (
                              <div key={estrategia.id} className="ml-3 space-y-2 border-l-2 border-teal-100 pl-4">
                                <div className="flex items-start gap-2">
                                  <h4 className="flex-1 text-sm font-medium text-slate-800">
                                    <span className="mr-2 font-mono text-teal-700">{estrategia.codigo}</span>
                                    {estrategia.texto}
                                  </h4>
                                  {isAdmin && (
                                    <EditButton label="Corregir la estrategia"
                                      onClick={() => setTextoTarget({ nivel: "estrategias", id: estrategia.id, codigo: estrategia.codigo, texto: estrategia.texto })} />
                                  )}
                                </div>
                                {estrategia.metas.map((meta) => (
                                  <div key={meta.id} className="rounded-xl border border-slate-200">
                                    <div className="flex items-start gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                                      <p className="flex-1 text-sm text-slate-700">
                                        <span className="mr-2 font-mono text-xs font-semibold text-slate-900">{meta.codigo}</span>
                                        {meta.texto}
                                      </p>
                                      {meta.cuantificable && <Badge variant="secondary">Cuantificable</Badge>}
                                      {isAdmin && (
                                        <EditButton label="Corregir la meta"
                                          onClick={() => setTextoTarget({ nivel: "metas", id: meta.id, codigo: meta.codigo, texto: meta.texto, cuantificable: meta.cuantificable })} />
                                      )}
                                    </div>
                                    <div className="divide-y divide-slate-100 p-1">
                                      {meta.proyectos.map((proyecto) => (
                                        <ProyectoRow key={proyecto.id} proyecto={proyecto} onOpen={() => setSelectedId(proyecto.id)} />
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}

      <ProyectoDialog
        proyecto={selected?.proyecto ?? null}
        meta={selected?.meta ?? null}
        isAdmin={isAdmin}
        onClose={() => setSelectedId(null)}
        onChanged={load}
      />
      <TextoNivelDialog target={textoTarget} onClose={() => setTextoTarget(null)} onChanged={load} />
    </div>
  );
}
