"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
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
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";
  const [stats, setStats] = useState<Stats>({ plans: 0, reporters: 0, evidences: 0 });
  const [planCharts, setPlanCharts] = useState<PlanChartData[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"por-plan" | "general">("por-plan");

  useEffect(() => {
    async function loadStats() {
      const requests: Promise<Response>[] = [fetch("/rgdp/api/plans")];
      if (!isAdmin) requests.push(fetch("/rgdp/api/evidences"));
      const [plansRes, evidencesRes] = await Promise.all(requests);
      const plans: Plan[] = plansRes.ok ? await plansRes.json() : [];
      const evidences = evidencesRes?.ok ? await evidencesRes.json() : [];

      const statsData: Stats = {
        plans: Array.isArray(plans) ? plans.length : 0,
        reporters: 0,
        evidences: Array.isArray(evidences) ? evidences.length : 0,
      };

      if (isAdmin) {
        const usersRes = await fetch("/rgdp/api/users");
        if (usersRes.ok) {
          const users = await usersRes.json();
          statsData.reporters = Array.isArray(users) ? users.length : 0;
        }
      }

      setStats(statsData);

      // Load chart data for each plan in parallel
      if (Array.isArray(plans) && plans.length > 0) {
        setChartsLoading(true);
        try {
          const chartResults = await Promise.all(
            plans.map(async (plan) => {
              const [itemsRes, complianceRes] = await Promise.all([
                fetch(`/rgdp/api/plans/${plan.id}/items`),
                fetch(`/rgdp/api/plans/${plan.id}/period-compliance`),
              ]);
              const items: PlanItem[] = itemsRes.ok ? await itemsRes.json() : [];
              const complianceRecords: PeriodCompliance[] = complianceRes.ok
                ? await complianceRes.json()
                : [];

              const counts = new Map<string, number>();
              for (const it of Array.isArray(items) ? items : []) {
                const raw = typeof it?.direccion === "string" ? it.direccion : "";
                const key = raw.trim() || "Sin dirección";
                counts.set(key, (counts.get(key) ?? 0) + 1);
              }
              const directionCounts = Array.from(counts.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

              return {
                plan,
                itemCount: Array.isArray(items) ? items.length : 0,
                directionCounts,
                items: (Array.isArray(items) ? items : []).map((it) => ({
                  id: it.id,
                  direccion: it.direccion,
                })),
                complianceRecords,
              };
            })
          );
          setPlanCharts(chartResults);
        } finally {
          setChartsLoading(false);
        }
      }
    }

    if (session) loadStats();
  }, [session, isAdmin]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Panel Principal</h1>
        <p className="text-muted-foreground mb-6">
          Bienvenido, {session?.user?.name}
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
            <GeneralComplianceChart planCharts={planCharts} />
          )
        )}
      </div>
    </div>
  );
}
