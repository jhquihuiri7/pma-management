"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Leaf, Shield, LogOut, Map, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const SUBSYSTEM_APPS = [
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
  {
    key: "geo",
    label: "Geoportal Ambiental",
    description: "Exploración de mapas interactivos y datos geoespaciales.",
    href: "/geo/dashboard",
    icon: Map,
    color: "text-teal-600",
    border: "border-teal-200 hover:border-teal-400",
    bg: "hover:bg-teal-50",
  },
] as const;

const ADMIN_ENTRY = {
  key: "admin",
  label: "Administración",
  description: "Gestión de usuarios y accesos a los subsistemas.",
  href: "/admin/users",
  icon: Users,
  color: "text-slate-700",
  border: "border-slate-200 hover:border-slate-400",
  bg: "hover:bg-slate-50",
};

export default function SelectAppPage() {
  const { user, status, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading" || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const userApps = new Set(user.apps);
  // Admins have implicit access to every subsystem; everyone else sees only their assigned apps.
  const availableApps = user.role === "ADMIN"
    ? [...SUBSYSTEM_APPS]
    : SUBSYSTEM_APPS.filter((a) => userApps.has(a.key));
  const allEntries = user.role === "ADMIN"
    ? [...availableApps, ADMIN_ENTRY]
    : availableApps;

  if (allEntries.length === 1) {
    router.replace(allEntries[0].href);
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">
          Bienvenido, {user.name?.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Selecciona la aplicación a la que deseas acceder.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        {allEntries.map((app) => {
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

      {allEntries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tienes acceso a ninguna aplicación. Contacta a tu administrador.
        </p>
      )}

      <button
        onClick={async () => {
          await logout();
          router.push("/login");
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-700 transition-colors"
      >
        <LogOut className="w-3.5 h-3.5" />
        Cerrar sesión
      </button>
    </div>
  );
}
