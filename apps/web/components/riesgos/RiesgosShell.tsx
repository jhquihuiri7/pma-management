"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Boxes, LayoutDashboard, Lock, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// Each tab is its own route, so a link or QR code can point at one form.
// The two forms are public; Administración needs a session (middleware.ts).
const PESTANAS = [
  { href: "/riesgos/recursos", etiqueta: "Recursos", icono: Boxes, publica: true },
  { href: "/riesgos/delegados", etiqueta: "Delegados al COE", icono: Users, publica: true },
  { href: "/riesgos/admin", etiqueta: "Administración", icono: LayoutDashboard, publica: false },
] as const;

export default function RiesgosShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, status } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header
        className="relative bg-[#173f4d] bg-cover bg-center text-white"
        style={{ backgroundImage: "linear-gradient(90deg, rgba(10,38,48,.94) 30%, rgba(10,38,48,.55)), url(/riesgos/portada-galapagos.jpg)" }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <Image
            src="/riesgos/emblema-coe.png"
            alt="Emblema del COE Provincial de Galápagos"
            width={64}
            height={64}
            unoptimized
            priority
            className="rounded-lg bg-white p-1"
          />
          <div className="min-w-48 flex-1">
            <p className="text-xs font-semibold tracking-widest text-teal-200">COE PROVINCIAL DE GALÁPAGOS</p>
            <h1 className="text-xl font-bold sm:text-2xl">Gestión de Riesgos</h1>
            <p className="text-sm text-slate-200">Sistema interinstitucional para el COE y el Comité Territorial</p>
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
          {PESTANAS.map((pestana) => {
            const Icono = pestana.icono;
            const activa = pathname === pestana.href || pathname.startsWith(`${pestana.href}/`);
            const className = `inline-flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activa ? "bg-slate-50 text-slate-900" : "text-slate-200 hover:bg-white/10 hover:text-white"
            }`;
            const contenido = (
              <>
                <Icono className="size-4" />
                {pestana.etiqueta}
                {!pestana.publica && !user && <Lock className="size-3.5 opacity-70" aria-label="Requiere iniciar sesión" />}
              </>
            );
            // Without a session the protected tab is a plain link. A client-side
            // <Link> would cache the middleware's redirect to /login, and the
            // login form's push back to /riesgos/admin would replay it.
            if (!pestana.publica && !user) {
              return <a key={pestana.href} href={pestana.href} className={className}>{contenido}</a>;
            }
            return (
              <Link key={pestana.href} href={pestana.href} prefetch={pestana.publica} aria-current={activa ? "page" : undefined} className={className}>
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
