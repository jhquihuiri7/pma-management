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
          api.get<Plan[]>("/rgdp/plans"),
          isReporter ? api.get<unknown[]>("/rgdp/evidences?mine=true") : Promise.resolve([]),
        ]);
        const statsData: Stats = {
          plans: plans.length,
          reporters: 0,
          evidences: evidences.length,
        };

        if (isAdmin) {
          statsData.reporters = (await api.get<unknown[]>("/rgdp/users")).length;
        }

        const chartResults = await Promise.all(
          plans.map(async (plan) => {
            const [items, complianceRecords] = await Promise.all([
              api.get<PlanItem[]>(`/rgdp/plans/${plan.id}/items`),
              api.get<PeriodCompliance[]>(`/rgdp/plans/${plan.id}/period-compliance`),
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
          const message = apiErrorMessage(error, "No se pudo cargar el panel RGDP");
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
    <div className="space-y-8">
      {dashboardError && <p className="text-sm text-red-600" role="alert">{dashboardError}</p>}
      <div>
        <h1 className="text-2xl font-bold mb-1">Panel Principal</h1>
        <p className="text-muted-foreground mb-6">
          Bienvenido, {session?.name}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isAdmin ? "Total de Proyectos" : "Proyectos Asignados"}
              </CardTitle>
              <FileText className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.plans}</div>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Usuarios
                </CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.reporters}</div>
              </CardContent>
            </Card>
          )}

          {!isAdmin && !isViewer && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Mis Evidencias
                </CardTitle>
                <Upload className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.evidences}</div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Compliance charts */}
      <div>
        {/* Tab headers */}
        <div className="flex items-center gap-0 mb-4 border-b border-border">
          <button
            onClick={() => setActiveTab("por-plan")}
            className={`px-4 pb-2 text-lg font-semibold transition-colors duration-200 border-b-2 -mb-px ${
              activeTab === "por-plan"
                ? "text-black border-black"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            Cumplimiento por Proyecto
          </button>
          <div className="self-stretch w-px bg-border mx-1 mb-px" />
          <button
            onClick={() => setActiveTab("general")}
            className={`px-4 pb-2 text-lg font-semibold transition-colors duration-200 border-b-2 -mb-px ${
              activeTab === "general"
                ? "text-black border-black"
                : "text-muted-foreground border-transparent hover:text-foreground"
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
                <Card key={i} className="animate-pulse">
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
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No hay proyectos disponibles.
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
                  periodMode="monthly"
                />
              ))}
            </div>
          )
        )}

        {activeTab === "general" && (
          chartsLoading ? (
            <Card className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-3/4" />
              </CardHeader>
              <CardContent>
                <div className="h-[200px] bg-muted rounded" />
              </CardContent>
            </Card>
          ) : (
            <GeneralComplianceChart planCharts={planCharts} periodMode="monthly" />
          )
        )}
      </div>
    </div>
  );
}
