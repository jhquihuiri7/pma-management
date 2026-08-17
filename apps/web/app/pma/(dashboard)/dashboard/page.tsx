"use client";

import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, Upload } from "lucide-react";
import { Plan, PeriodCompliance, PlanItem } from "@/types";
import PlanComplianceChart from "@/components/PlanComplianceChart";
import GeneralComplianceChart from "@/components/GeneralComplianceChart";

interface Stats {
  plans: number;
  reporters: number;
  evidences: number;
}

interface PlanChartData {
  plan: Plan;
  itemCount: number;
  directionCounts: { name: string; value: number }[];
  items: Pick<PlanItem, "id" | "direccion">[];
  complianceRecords: PeriodCompliance[];
}

export default function DashboardPage() {
  const { user: session} = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const isViewer = session?.role === "VIEWER";
  const isReporter = session?.role === "REPORTER";
  const [stats, setStats] = useState<Stats>({ plans: 0, reporters: 0, evidences: 0 });
  const [planCharts, setPlanCharts] = useState<PlanChartData[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"por-plan" | "general">("por-plan");

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      setChartsLoading(true);
      setDashboardError(null);
      try {
        const [plans, evidences] = await Promise.all([
          api.get<Plan[]>("/pma/plans"),
          isReporter ? api.get<unknown[]>("/pma/evidences?mine=true") : Promise.resolve([]),
        ]);
        const statsData: Stats = {
          plans: plans.length,
          reporters: 0,
          evidences: evidences.length,
        };

        if (isAdmin) {
          statsData.reporters = (await api.get<unknown[]>("/pma/users")).length;
        }

        const chartResults = await Promise.all(
          plans.map(async (plan) => {
            const [items, complianceRecords] = await Promise.all([
              api.get<PlanItem[]>(`/pma/plans/${plan.id}/items`),
              api.get<PeriodCompliance[]>(`/pma/plans/${plan.id}/period-compliance`),
            ]);
            const counts = new Map<string, number>();
            for (const item of items) {
              const key = (typeof item.direccion === "string" ? item.direccion.trim() : "") || "Sin dirección";
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
            return {
              plan,
              itemCount: items.length,
              directionCounts: Array.from(counts.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
              items: items.map(({ id, direccion }) => ({ id, direccion })),
              complianceRecords,
            };
          })
        );

        if (!cancelled) {
          setStats(statsData);
          setPlanCharts(chartResults);
        }
      } catch (error) {
        if (!cancelled) {
          const message = apiErrorMessage(error, "No se pudo cargar el panel PMA");
          setDashboardError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setChartsLoading(false);
      }
    }

    if (session) void loadStats();
    return () => { cancelled = true; };
  }, [session, isAdmin, isReporter]);

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
            <FileText className="h-6 w-6 text-teal-200" />
            <span className="text-sm font-medium uppercase tracking-widest text-teal-200">
              Plan de Manejo Ambiental
            </span>
          </div>
          <h1 className="mb-2 text-3xl font-bold text-white">Panel de Cumplimiento</h1>
          <p className="max-w-xl text-base text-teal-100">
            Consulta el avance de los planes, sus evidencias y el cumplimiento ambiental
            en un solo lugar. Bienvenido, {session?.name}.
          </p>
        </div>
      </div>

      <div className="relative z-10 mx-auto -mt-12 max-w-7xl space-y-8 px-6 pb-16">
        {dashboardError && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm" role="alert">
            {dashboardError}
          </p>
        )}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xl ring-0">
            <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                {isAdmin ? "Total de Planes" : "Planes Asignados"}
              </CardTitle>
              <FileText className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 p-3 text-white shadow-sm" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="text-3xl font-bold text-slate-900">{stats.plans}</div>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xl ring-0">
              <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Usuarios
                </CardTitle>
                <Users className="h-12 w-12 rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 p-3 text-white shadow-sm" />
              </CardHeader>
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-slate-900">{stats.reporters}</div>
              </CardContent>
            </Card>
          )}

          {!isAdmin && !isViewer && (
            <Card className="rounded-2xl border border-slate-100 bg-white p-5 shadow-xl ring-0">
              <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Mis Evidencias
                </CardTitle>
                <Upload className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-400 to-violet-600 p-3 text-white shadow-sm" />
              </CardHeader>
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-slate-900">{stats.evidences}</div>
              </CardContent>
            </Card>
          )}
        </div>

      {/* Compliance charts */}
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-xl">
        {/* Tab headers */}
        <div className="mb-6 flex w-fit items-center rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab("por-plan")}
            className={`rounded-lg px-4 py-2 text-sm transition-all duration-200 ${
              activeTab === "por-plan"
                ? "bg-white font-semibold text-teal-700 shadow-sm"
                : "font-medium text-slate-500 hover:text-slate-800"
            }`}
          >
            Cumplimiento por Plan
          </button>
          <button
            onClick={() => setActiveTab("general")}
            className={`rounded-lg px-4 py-2 text-sm transition-all duration-200 ${
              activeTab === "general"
                ? "bg-white font-semibold text-teal-700 shadow-sm"
                : "font-medium text-slate-500 hover:text-slate-800"
            }`}
          >
            Cumplimiento General
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "por-plan" && (
          chartsLoading ? (
            <div className="grid grid-cols-1 gap-6">
              {Array.from({ length: Math.max(stats.plans, 1) }).map((_, i) => (
                <Card key={i} className="animate-pulse rounded-2xl border border-slate-100 shadow-sm ring-0">
                  <CardHeader className="pb-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px] bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : planCharts.length === 0 ? (
            <Card className="rounded-2xl border border-slate-100 shadow-sm ring-0">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No hay planes disponibles.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {planCharts.map(({ plan, itemCount, directionCounts, items, complianceRecords }) => (
                <PlanComplianceChart
                  key={plan.id}
                  plan={plan}
                  itemCount={itemCount}
                  directionCounts={directionCounts}
                  items={items}
                  complianceRecords={complianceRecords}
                />
              ))}
            </div>
          )
        )}

        {activeTab === "general" && (
          chartsLoading ? (
            <Card className="animate-pulse rounded-2xl border border-slate-100 shadow-sm ring-0">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-3/4" />
              </CardHeader>
              <CardContent>
                <div className="h-[200px] bg-muted rounded" />
              </CardContent>
            </Card>
          ) : (
            <GeneralComplianceChart planCharts={planCharts} />
          )
        )}
        </div>
      </div>
    </div>
  );
}
