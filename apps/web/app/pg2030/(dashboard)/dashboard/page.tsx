"use client";

import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Target } from "lucide-react";

export default function PG2030DashboardPage() {
  const { user: session } = useAuth();

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

      <div className="relative z-10 mx-auto -mt-12 max-w-7xl px-6 pb-16">
        <Card className="rounded-2xl border border-slate-100 bg-white shadow-xl ring-0">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Target className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 p-3 text-white shadow-sm" />
            <h2 className="text-base font-semibold text-slate-800">Módulo en construcción</h2>
            <p className="max-w-md text-sm text-slate-500">
              Las pantallas de seguimiento del plan aparecerán aquí.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
