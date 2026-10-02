"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { LayoutDashboard, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const links = [
  { href: "/pg2030/dashboard", label: "Panel Principal", icon: LayoutDashboard },
];

export default function SidebarPG2030() {
  const pathname = usePathname();
  const { user: session, logout, logoutPending } = useAuth();

  return (
    <aside className="w-64 h-screen bg-white border-r border-slate-200 flex flex-col fixed left-0 top-0">
      <div className="p-6">
        <h1 className="text-lg font-bold text-slate-900">PG2030</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Seguimiento al Plan Galápagos 2030
        </p>
      </div>

      <Separator />

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive =
            pathname === link.href ||
            (link.href !== "/pg2030/dashboard" && pathname.startsWith(link.href));

          return (
            <Link
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
            </Link>
          );
        })}

        <Link
          href="/select-app"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors mt-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Ver todas las apps
        </Link>
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
            disabled={logoutPending}
            aria-busy={logoutPending}
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
