"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api, apiErrorMessage } from "@/lib/api-client";
import { ESTADO_CORTE, MESES_LARGOS, usePg2030Me } from "@/lib/pg2030";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ResumenPlan from "@/components/pg2030/ResumenPlan";
import {
  CuadroAlineacion,
  CuadroAvanceFisico,
  CuadroCoherencia,
  CuadroCumplimiento,
  CuadroInversion,
  CuadroPlanificacion,
  CuadroPresupuesto,
} from "@/components/pg2030/dashboard/Cuadros";
import InstitucionDetalle from "@/components/pg2030/dashboard/InstitucionDetalle";
import { Building2, CalendarRange, Loader2, Target, TriangleAlert } from "lucide-react";
import { PG2030_INSTITUCION_TIPO_VALUES } from "@/types";
import type { Pg2030Dashboard, Pg2030Institucion, Pg2030InstitucionTipo, Pg2030Trimestre } from "@/types";

const selectClass = "flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm";

type Filtros = {
  anio?: number;
  trimestre?: Pg2030Trimestre;
  ejeId?: string;
  institucionId?: string;
  tipoInstitucion?: Pg2030InstitucionTipo;
};

function InstitucionCard() {
  const { me, error } = usePg2030Me();
  if (error) return null;
  if (!me) return <Skeleton className="h-20 w-full rounded-2xl" />;
  if (me.role !== "REPORTER") return null;

  if (!me.institucion) {
    return (
      <Card className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="flex items-start gap-3 py-5">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">Tu usuario no tiene una institución asignada</p>
            <p className="text-sm text-amber-800">
              Puedes consultar el catálogo, pero no planificar ni reportar hasta que un administrador te asigne tu institución.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <CardContent className="flex items-center gap-3 py-5">
        <Building2 className="h-10 w-10 shrink-0 rounded-xl bg-teal-50 p-2 text-teal-700" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reportas por</p>
          <p className="font-semibold text-slate-900">
            {me.institucion.nombre} <span className="font-mono text-teal-700">({me.institucion.sigla})</span>
          </p>
          {!me.institucion.activa && <p className="text-xs text-amber-700">Esta institución está inactiva.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Which months the figures cover, and whether they can still change. */
function CorteBanner({ d }: { d: Pg2030Dashboard }) {
  const corte = d.corte!;
  const estado = ESTADO_CORTE[corte.estado];
  let texto: string;
  if (!corte.habilitado) texto = "Este corte no está habilitado: sus meses se reportan con el siguiente corte habilitado.";
  else if (corte.hasta === 0) texto = "El corte está en curso y todavía no termina ninguno de sus meses.";
  else if (corte.enCurso) {
    texto = `Corte en curso: acumulado de enero a ${MESES_LARGOS[corte.hasta - 1]}. Las cifras pueden cambiar hasta el cierre.`;
  } else texto = `Acumulado de enero a ${MESES_LARGOS[corte.hasta - 1]}.`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <CalendarRange className="h-4 w-4 text-slate-500" />
      <span className="font-semibold text-slate-900">Corte T{corte.trimestre} {d.anio!.anio}</span>
      <Badge variant="outline" className={estado.className}>{estado.label}</Badge>
      <span>{texto}</span>
    </div>
  );
}

export default function PG2030DashboardPage() {
  const { user: session } = useAuth();
  const esReportero = session?.role === "REPORTER";
  const [filtros, setFiltros] = useState<Filtros>({});
  const [d, setD] = useState<Pg2030Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anios, setAnios] = useState<number[]>([]);
  const [instituciones, setInstituciones] = useState<Pg2030Institucion[]>([]);
  const [detalleId, setDetalleId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Array<{ anio: number }>>("/pg2030/anios")
      .then((rows) => setAnios(rows.map((r) => r.anio).sort((a, b) => b - a)))
      .catch(() => setAnios([]));
  }, []);

  useEffect(() => {
    if (!session || esReportero) return;
    api.get<Pg2030Institucion[]>("/pg2030/instituciones")
      .then(setInstituciones)
      .catch(() => setInstituciones([]));
  }, [session, esReportero]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== "") query.set(k, String(v));
    setLoading(true);
    api.get<Pg2030Dashboard>(`/pg2030/dashboard?${query}`)
      .then((data) => { if (!cancelled) { setD(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "No se pudo cargar el panel")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filtros]);

  const set = (patch: Filtros) => setFiltros((f) => ({ ...f, ...patch }));
  const cortes = d?.anio?.cortes.filter((c) => c.habilitado) ?? [];

  return (
    <div className="-m-8 min-h-screen">
      <div className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-700 px-6 pb-24 pt-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative z-10 mx-auto max-w-7xl">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-6 w-6 text-teal-200" />
            <span className="text-sm font-medium uppercase tracking-widest text-teal-200">
              PG2030
            </span>
          </div>
          <h1 className="mb-2 text-3xl font-bold text-white">Seguimiento al Plan Galápagos 2030</h1>
          <p className="max-w-xl text-base text-teal-100">
            Consulta el avance del Plan Galápagos 2030 en un solo lugar.
            Bienvenido, {session?.name}.
          </p>
        </div>
      </div>

      <div className="relative z-10 mx-auto -mt-12 max-w-7xl space-y-4 px-6 pb-16">
        <InstitucionCard />

        {d ? <ResumenPlan resumen={d.resumenPlan} /> : error ? null : <Skeleton className="h-48 w-full rounded-2xl" />}

        {error && (
          <Card className="rounded-2xl"><CardContent className="py-8 text-center text-sm text-red-600">{error}</CardContent></Card>
        )}

        {d && !d.anio && (
          <Card className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <CardContent className="py-8 text-center text-sm text-slate-600">
              Todavía no hay ningún año abierto: el seguimiento por corte aparecerá cuando{" "}
              {session?.role === "ADMIN"
                ? <Link href="/pg2030/anios" className="font-medium text-teal-700 underline">abras el primero en Años y cortes</Link>
                : "el administrador abra el primero"}.
            </CardContent>
          </Card>
        )}

        {d?.anio && d.corte && (
          <>
            <Card className="rounded-2xl border border-slate-100 bg-white shadow-sm">
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                  <select className={`${selectClass} lg:w-28`} aria-label="Año" value={d.anio.anio}
                    onChange={(e) => set({ anio: Number(e.target.value), trimestre: undefined })}>
                    {(anios.length ? anios : [d.anio.anio]).map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select className={`${selectClass} lg:w-44`} aria-label="Corte" value={d.corte.trimestre}
                    onChange={(e) => set({ trimestre: Number(e.target.value) as Pg2030Trimestre })}>
                    {cortes.map((c) => (
                      <option key={c.trimestre} value={c.trimestre}>T{c.trimestre} · {ESTADO_CORTE[c.estado].label}</option>
                    ))}
                  </select>
                  <select className={`${selectClass} lg:w-64`} aria-label="Eje" value={filtros.ejeId ?? ""}
                    onChange={(e) => set({ ejeId: e.target.value || undefined })}>
                    <option value="">Todos los ejes</option>
                    {d.ejes.map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
                  </select>
                  {!esReportero && (
                    <>
                      <select className={`${selectClass} lg:w-72`} aria-label="Institución" value={filtros.institucionId ?? ""}
                        onChange={(e) => set({ institucionId: e.target.value || undefined })}>
                        <option value="">Todas las instituciones</option>
                        {instituciones.map((i) => <option key={i.id} value={i.id}>{i.sigla} — {i.nombre}</option>)}
                      </select>
                      <select className={`${selectClass} lg:w-48`} aria-label="Tipo de institución" value={filtros.tipoInstitucion ?? ""}
                        onChange={(e) => set({ tipoInstitucion: (e.target.value || undefined) as Pg2030InstitucionTipo | undefined })}>
                        <option value="">Todos los tipos</option>
                        {PG2030_INSTITUCION_TIPO_VALUES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </>
                  )}
                  {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Cargando" />}
                </div>
                <CorteBanner d={d} />
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <CuadroPlanificacion d={d} />
              <CuadroCumplimiento d={d} onSelect={setDetalleId} />
            </div>
            <CuadroAlineacion d={d} />
            <CuadroAvanceFisico d={d} onSelect={setDetalleId} />
            <CuadroPresupuesto d={d} />
            <CuadroCoherencia d={d} onSelect={setDetalleId} />
            <CuadroInversion d={d} />

            <InstitucionDetalle d={d} institucionId={detalleId} onClose={() => setDetalleId(null)} />
          </>
        )}
      </div>
    </div>
  );
}
