"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api, apiErrorMessage } from "@/lib/api-client";
import { usePg2030Me } from "@/lib/pg2030";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ResumenPlan from "@/components/pg2030/ResumenPlan";
import { ArrowRight, Building2, Target, TriangleAlert } from "lucide-react";
import type { Pg2030Catalogo } from "@/types";

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

export default function PG2030DashboardPage() {
  const { user: session } = useAuth();
  const [catalogo, setCatalogo] = useState<Pg2030Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Pg2030Catalogo>("/pg2030/catalogo")
      .then((data) => { if (!cancelled) setCatalogo(data); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "No se pudo cargar el resumen del Plan")); });
    return () => { cancelled = true; };
  }, []);

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

        {catalogo ? (
          <ResumenPlan resumen={catalogo.resumen} />
        ) : error ? (
          <Card className="rounded-2xl"><CardContent className="py-8 text-center text-sm text-red-600">{error}</CardContent></Card>
        ) : (
          <Skeleton className="h-48 w-full rounded-2xl" />
        )}

        <Card className="rounded-2xl border border-slate-100 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              La planificación, el reporte mensual y el tablero de cumplimiento por corte llegan en las próximas fases.
            </p>
            <Link href="/pg2030/catalogo"
              className="flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-900">
              Ver el catálogo del Plan
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
