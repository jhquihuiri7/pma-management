"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Users, LogOut, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const APP_LABELS: Record<string, { label: string; href: string }> = {
  pma: { label: "PMA", href: "/pma/dashboard" },
  rgdp: { label: "RGDP", href: "/rgdp/dashboard" },
  pglp: { label: "Plan Galápagos", href: "/pg/dashboard" },
  geo: { label: "Geoportal", href: "/geo/dashboard" },
};

export default function SidebarAdmin() {
  const pathname = usePathname();
  const { user: session, logout } = useAuth();
  const userApps = session?.apps ?? [];

  return (
    <aside className="w-64 h-screen bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0">
      <div className="p-6">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Administración
        </p>
        <h1 className="text-lg font-bold text-slate-900">Gestión de Usuarios</h1>
        <p className="text-xs text-muted-foreground mt-1">Plataforma Ambiental</p>
      </div>

      <Separator />

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        <Link
          href="/admin/users"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            pathname.startsWith("/admin/users")
              ? "bg-slate-100 text-slate-900"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          <Users className="w-4 h-4" />
          Usuarios
        </Link>

        {userApps.length > 0 && (
          <>
            <div className="pt-4 pb-1">
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Mis aplicaciones
              </p>
            </div>
            {userApps.map((appKey) => {
              const app = APP_LABELS[appKey];
              if (!app) return null;
              return (
                <Link
                  key={appKey}
                  href={app.href}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  {app.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200">
        <div className="flex items-center gap-3 mb-3 px-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium">
            {session?.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session?.name}</p>
            <p className="text-xs text-muted-foreground truncate">Administrador</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-600"
          onClick={() => logout()}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Cerrar sesión
        </Button>
      </div>
    </aside>
  );
}
