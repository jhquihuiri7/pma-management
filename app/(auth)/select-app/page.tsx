"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import { Leaf, Shield, LogOut } from "lucide-react";

const APPS = [
  {
    key: "pma",
    label: "Plan de Manejo Ambiental",
    description: "Gestión de planes, evidencias y reportes ambientales.",
    href: "/pma/dashboard",
    icon: Leaf,
    color: "text-green-600",
    border: "border-green-200 hover:border-green-400",
    bg: "hover:bg-green-50",
  },
  {
    key: "rgdp",
    label: "Gestión de Riesgos",
    description: "Seguimiento de planes, usuarios y evidencias de riesgo.",
    href: "/rgdp/dashboard",
    icon: Shield,
    color: "text-blue-600",
    border: "border-blue-200 hover:border-blue-400",
    bg: "hover:bg-blue-50",
  },
] as const;

export default function SelectAppPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const userApps = session.user.apps ?? [];
  const availableApps = APPS.filter((a) => userApps.includes(a.key));

  if (availableApps.length === 1) {
    router.replace(availableApps[0].href);
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Bienvenido, {session.user.name?.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground mt-1">Selecciona la aplicación a la que deseas acceder.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xl">
        {availableApps.map((app) => {
          const Icon = app.icon;
          return (
            <Card
              key={app.key}
              className={`flex-1 cursor-pointer border-2 transition-all ${app.border} ${app.bg}`}
              onClick={() => router.push(app.href)}
            >
              <CardContent className="flex flex-col items-center text-center gap-3 py-8 px-6">
                <div className={`p-3 rounded-full bg-white shadow-sm border ${app.border}`}>
                  <Icon className={`w-7 h-7 ${app.color}`} />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-800 text-base">{app.label}</h2>
                  <p className="text-xs text-muted-foreground mt-1">{app.description}</p>
                </div>
                <Button className="w-full mt-1" size="sm">
                  Ingresar
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {availableApps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tienes acceso a ninguna aplicación. Contacta a tu administrador.
        </p>
      )}

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-700 transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
        Cerrar sesión
      </button>
    </div>
  );
}
