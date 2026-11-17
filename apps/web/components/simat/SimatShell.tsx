"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, TriangleAlert, TowerControl, RefreshCw, Waves } from "lucide-react";
import "./simat.css";
import { SimatProvider, useSimat } from "./contexto";
import { fmtReloj, hace } from "@/lib/simat/formato";

const NAV = [
  { href: "/simat", label: "Vista general", icon: LayoutDashboard },
  { href: "/simat/riesgo", label: "Riesgo y nivel del mar", icon: TriangleAlert },
  { href: "/simat/fuentes", label: "Estaciones y fuentes", icon: TowerControl },
];

function Reloj() {
  const [hora, setHora] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setHora(fmtReloj.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums" title="Hora de Galápagos (UTC−6)">{hora}</span>;
}

function Marco({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { error, sincronizadoEn, auto, setAuto, refrescar, cargando } = useSimat();
  const enLinea = !error;

  return (
    <div className="simat min-h-screen flex text-slate-800">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-slate-900 text-slate-100">
        <Link href="/simat" className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600">
            <Waves className="w-5 h-5 text-white" />
          </span>
          <span className="leading-tight">
            <strong className="block text-sm">SIMAT-GAL</strong>
            <small className="text-[11px] text-slate-400">Alerta temprana</small>
          </span>
        </Link>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">Monitoreo</p>
          {NAV.map(({ href, label, icon: Icon }) => {
            const activo = href === "/simat" ? pathname === "/simat" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  activo ? "bg-teal-600 text-white" : "text-slate-300 hover:bg-white/10"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <span className="simat-live-dot" data-off={!enLinea} />
            {enLinea ? "Datos en línea" : "Sin conexión"}
          </span>
          <p className="mt-1">Sistema Provincial de Monitoreo Hidrometeorológico de Galápagos</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-3 border-b bg-white/90 backdrop-blur px-4 sm:px-6 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
            <span className="hidden sm:inline">SIMAT-GAL</span>
            <span className="hidden sm:inline text-slate-300">/</span>
            <strong className="text-slate-800 truncate">
              {NAV.find((n) => (n.href === "/simat" ? pathname === "/simat" : pathname.startsWith(n.href)))?.label ?? "Vista general"}
            </strong>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-slate-600">
              <span className="simat-live-dot" data-off={!enLinea} />
              <Reloj />
            </span>
            <button
              type="button"
              onClick={() => void refrescar()}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              title={sincronizadoEn ? `Actualizado ${hace(new Date(sincronizadoEn).toISOString())}` : "Actualizar"}
            >
              <RefreshCw className={`w-4 h-4 ${cargando ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none" title="Actualizar cada 60 s">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-teal-600" />
              Auto
            </label>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

export default function SimatShell({ children }: { children: React.ReactNode }) {
  return (
    <SimatProvider>
      <Marco>{children}</Marco>
    </SimatProvider>
  );
}
