"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, Upload } from "lucide-react";

interface Stats {
  plans: number;
  reporters: number;
  evidences: number;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";
  const [stats, setStats] = useState<Stats>({ plans: 0, reporters: 0, evidences: 0 });

  useEffect(() => {
    async function loadStats() {
      const [plansRes, evidencesRes] = await Promise.all([
        fetch("/api/plans"),
        fetch("/api/evidences" + (isAdmin ? "" : "")),
      ]);
      const plans = await plansRes.json();
      const evidences = await evidencesRes.json();

      const statsData: Stats = {
        plans: Array.isArray(plans) ? plans.length : 0,
        reporters: 0,
        evidences: Array.isArray(evidences) ? evidences.length : 0,
      };

      if (isAdmin) {
        const usersRes = await fetch("/api/users");
        if (usersRes.ok) {
          const users = await usersRes.json();
          statsData.reporters = Array.isArray(users) ? users.length : 0;
        }
      }

      setStats(statsData);
    }
    if (session) loadStats();
  }, [session, isAdmin]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Panel Principal</h1>
      <p className="text-muted-foreground mb-6">
        Bienvenido, {session?.user?.name}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {isAdmin ? "Total de Planes" : "Planes Asignados"}
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

        {!isViewer && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isAdmin ? "Total de Evidencias" : "Mis Evidencias"}
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
  );
}
