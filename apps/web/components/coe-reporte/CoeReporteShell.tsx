"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ClipboardList, LayoutDashboard, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// Each section is its own route, so a link or QR code can point at the form.
// Reporte is public; Tablero needs a session (middleware.ts).
const SECCIONES = [
  { href: "/coe-reporte/reporte", etiqueta: "Reporte diario", icono: ClipboardList, publica: true },
  { href: "/coe-reporte/tablero", etiqueta: "Tablero", icono: LayoutDashboard, publica: false },
] as const;

export default function CoeReporteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, status } = useAuth();
  const enTablero = pathname.startsWith("/coe-reporte/tablero");

  return (
    <div className="min-h-screen bg-[#f3f7f9]">
      <header className="border-b border-[#dbe6ed] bg-[#113349] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <div className="rounded-lg bg-white px-2 py-1">
            <Image
              src="/coe-reporte/logo-coe-galapagos.webp"
              alt="Comité de Operaciones de Emergencia Provincial de Galápagos"
              width={168}
              height={70}
              unoptimized
              priority
            />
          </div>
          <div className="min-w-48 flex-1">
            <p className="text-xs font-semibold tracking-widest text-teal-200">COE PROVINCIAL DE GALÁPAGOS</p>
            <h1 className="text-xl font-bold sm:text-2xl">{enTablero ? "Tablero de administración" : "Reporte territorial diario"}</h1>
            <p className="text-sm text-slate-200">Programación (08h00) y resultados (19h00) de las actividades territoriales</p>
          </div>
          {status === "authenticated" && user && (
            <Link
              href="/select-app"
              className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              <ArrowLeft className="size-4" /> Volver a SIGTAR
            </Link>
          )}
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Secciones del módulo">
          {SECCIONES.map((seccion) => {
            const Icono = seccion.icono;
            const activa = pathname === seccion.href || pathname.startsWith(`${seccion.href}/`);
            const className = `inline-flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activa ? "bg-[#f3f7f9] text-[#113349]" : "text-slate-200 hover:bg-white/10 hover:text-white"
            }`;
            const contenido = (
              <>
                <Icono className="size-4" />
                {seccion.etiqueta}
                {!seccion.publica && !user && <Lock className="size-3.5 opacity-70" aria-label="Requiere iniciar sesión" />}
              </>
            );
            // Without a session the protected section is a plain link: a
            // client-side <Link> would cache the middleware's redirect to /login.
            if (!seccion.publica && !user) {
              return <a key={seccion.href} href={seccion.href} className={className}>{contenido}</a>;
            }
            return (
              <Link key={seccion.href} href={seccion.href} prefetch={seccion.publica} aria-current={activa ? "page" : undefined} className={className}>
                {contenido}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-muted-foreground">
        CGREG · Dirección de Gestión del Territorio, Ambiente y Riesgos · COE Provincial de Galápagos
      </footer>
    </div>
  );
}
