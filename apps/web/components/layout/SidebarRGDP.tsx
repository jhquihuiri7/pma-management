"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  FileText,
  Users,
  LogOut,
  LayoutTemplate,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const adminLinks = [
  { href: "/rgdp/dashboard", label: "Panel Principal", icon: LayoutDashboard },
  { href: "/rgdp/plans", label: "Proyectos", icon: FileText },
  { href: "/rgdp/users", label: "Usuarios", icon: Users },
];

const reporterLinks = [
  { href: "/rgdp/dashboard", label: "Panel Principal", icon: LayoutDashboard },
  { href: "/rgdp/plans", label: "Mis Proyectos", icon: FileText },
];

const viewerLinks = [
  { href: "/rgdp/dashboard", label: "Panel Principal", icon: LayoutDashboard },
  { href: "/rgdp/plans", label: "Mis Proyectos", icon: FileText },
];

export default function SidebarRGDP() {
  const pathname = usePathname();
  const { user: session, logout } = useAuth();
  const role = session?.role;
  const links =
    role === "ADMIN" ? adminLinks : role === "VIEWER" ? viewerLinks : reporterLinks;

  return (
    <aside className="w-64 h-screen bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0">
      <div className="p-6">
        <h1 className="text-lg font-bold text-slate-900">Registro Generador de Desechos Peligrosos</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Plataforma Ambiental
        </p>
      </div>

      <Separator />

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive =
            pathname === link.href ||
            (link.href !== "/rgdp/dashboard" && pathname.startsWith(link.href));

          return (
            <a
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              {link.label}
            </a>
          );
        })}

        {role === "ADMIN" && (
          <>
            <div className="pt-4 pb-1">
              <p className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Configuración
              </p>
            </div>
            <a
              href="/rgdp/formatos"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/rgdp/formatos" || pathname.startsWith("/rgdp/formatos")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <LayoutTemplate className="w-4 h-4" />
              Formatos
            </a>
            <a
              href="/admin/users"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith("/admin/users")
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <UserCog className="w-4 h-4" />
              Gestión de Usuarios
            </a>
          </>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200">
        <div className="flex items-center gap-3 px-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium">
            {session?.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {session?.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {session?.role === "ADMIN" ? "Administrador" : session?.role === "REPORTER" ? "Reportero" : "Visualizador"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-900"
            onClick={() => logout()}
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
