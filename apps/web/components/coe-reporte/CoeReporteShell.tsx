"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ClipboardList, LayoutDashboard, Lock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth-context";

// Same frame as the other modules (SidebarPG2030, Sidebar): a white sidebar
// with teal accents. Reporting is public and done from phones, so below lg
// the sidebar becomes a top bar instead of hiding the content.
// Reporte is public; Tablero needs a session (middleware.ts).
const SECCIONES = [
  { href: "/coe-reporte/reporte", etiqueta: "Reporte diario", icono: ClipboardList, publica: true },
  { href: "/coe-reporte/tablero", etiqueta: "Tablero", icono: LayoutDashboard, publica: false },
] as const;

const ROLES = { ADMIN: "Administrador", REPORTER: "Reportero", VIEWER: "Visualizador" } as const;

function Enlace({
  seccion,
  conSesion,
  activa,
  className,
}: {
  seccion: (typeof SECCIONES)[number];
  conSesion: boolean;
  activa: boolean;
  className: string;
}) {
  const Icono = seccion.icono;
  const contenido = (
    <>
      <Icono className="h-4 w-4" />
      {seccion.etiqueta}
      {!seccion.publica && !conSesion && <Lock className="h-3.5 w-3.5 opacity-60" aria-label="Requiere iniciar sesión" />}
    </>
  );
  // Without a session the protected section is a plain link: a client-side
  // <Link> would cache the middleware's redirect to /login.
  if (!seccion.publica && !conSesion) return <a href={seccion.href} className={className}>{contenido}</a>;
  return (
    <Link href={seccion.href} prefetch={seccion.publica} aria-current={activa ? "page" : undefined} className={className}>
      {contenido}
    </Link>
  );
}

export default function CoeReporteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, logoutPending } = useAuth();
  const activa = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="p-6">
          <h1 className="text-lg font-bold text-slate-900">Reporte territorial COE</h1>
          <p className="mt-1 text-xs text-muted-foreground">COE Provincial de Galápagos · cortes 08h00 y 19h00</p>
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label="Secciones del módulo">
          {SECCIONES.map((seccion) => (
            <Enlace
              key={seccion.href}
              seccion={seccion}
              conSesion={Boolean(user)}
              activa={activa(seccion.href)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activa(seccion.href) ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            />
          ))}
          {user && (
            <Link
              href="/select-app"
              className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Ver todas las apps
            </Link>
          )}
        </nav>

        <div className="border-t border-slate-200 p-4">
          {user ? (
            <div className="flex items-center gap-3 px-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-medium">
                {user.name?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{ROLES[user.role]}</p>
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
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <a
              href="/login?next=/coe-reporte/tablero"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <LogIn className="h-4 w-4" />
              Iniciar sesión
            </a>
          )}
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">Reporte territorial COE</p>
            <p className="truncate text-xs text-muted-foreground">COE Provincial de Galápagos</p>
          </div>
          {user && (
            <Link href="/select-app" className="text-xs font-medium text-slate-500 hover:text-slate-900">
              Ver apps
            </Link>
          )}
        </div>
        <nav className="flex gap-1 px-2 pb-2" aria-label="Secciones del módulo">
          {SECCIONES.map((seccion) => (
            <Enlace
              key={seccion.href}
              seccion={seccion}
              conSesion={Boolean(user)}
              activa={activa(seccion.href)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                activa(seccion.href) ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-50"
              }`}
            />
          ))}
        </nav>
      </header>

      <div className="min-h-screen lg:ml-64">
        <main>{children}</main>
      </div>
    </div>
  );
}
