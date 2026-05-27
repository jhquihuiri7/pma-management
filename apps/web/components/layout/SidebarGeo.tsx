"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LayoutDashboard, Map, LogOut, ArrowLeft, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const commonLinks = [
  { href: "/geo/dashboard", label: "Geoportal", icon: LayoutDashboard },
];

export default function SidebarGeo() {
  const pathname = usePathname();
  const { user: session, logout } = useAuth();
  const role = session?.role;

  return (
    <aside className="w-64 h-screen bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0">
      <div className="p-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-teal-600 flex items-center justify-center">
            <Map className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">Geoportal</h1>
            <p className="text-xs text-muted-foreground">Plataforma Ambiental</p>
          </div>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {commonLinks.map((link) => {
          const Icon = link.icon;
          const isActive =
            pathname === link.href ||
            (link.href !== "/geo/dashboard" && pathname.startsWith(link.href));

          return (
            <a
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-teal-50 text-teal-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              {link.label}
            </a>
          );
        })}

        {session && (
          <a
            href="/select-app"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors mt-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Ver todas las apps
          </a>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200">
        {session ? (
          <div className="flex items-center gap-3 px-3">
            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-xs font-medium text-teal-700">
              {session.name?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {role === "ADMIN"
                  ? "Administrador"
                  : role === "REPORTER"
                  ? "Reportero"
                  : "Visualizador"}
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
        ) : (
          <a
            href="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Iniciar sesión
          </a>
        )}
      </div>
    </aside>
  );
}
