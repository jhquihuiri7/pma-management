"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import "./simat.css";
import "./simat-extra.css";
import { SimatProvider, useSimat } from "./contexto";
import { Icono, type NombreIcono } from "./iconos";
import { fmtReloj, hace } from "@/lib/simat/formato";

const NAV: { href: string; label: string; icono: NombreIcono }[] = [{ href: "/simat", label: "Panel de vigilancia", icono: "layout" }];

/** Secciones del panel único, para saltar dentro de la página. */
const SECCIONES: { id: string; label: string; icono: NombreIcono }[] = [
  { id: "resumen", label: "Resumen", icono: "gauge" },
  { id: "riesgo-sector", label: "Riesgo por sector", icono: "alert" },
  { id: "rain-history", label: "Lluvia y marea", icono: "rain" },
  { id: "mareas", label: "Predicciones de marea", icono: "activity" },
  { id: "estaciones", label: "Lluvia acumulada y estaciones", icono: "tower" },
];

function activa(href: string, pathname: string) {
  return href === "/simat" ? pathname === "/simat" : pathname.startsWith(href);
}

/** Reloj de Galápagos y «Actualizado hace…», al ritmo de un segundo. */
function useTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function Reloj() {
  const [hora, setHora] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setHora(fmtReloj.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="live-clock" id="clock" title="Hora de Galápagos (UTC−6)">
      {hora}
    </span>
  );
}

function BotonSincronizar() {
  const { refrescar, cargando, sincronizadoEn } = useSimat();
  useTick();
  return (
    <button type="button" className={`sync-button ${cargando ? "is-loading" : ""}`} id="sync" title="Actualizar datos" onClick={() => void refrescar()}>
      <Icono nombre="refresh" />
      <span id="synced">{sincronizadoEn ? `Actualizado ${hace(new Date(sincronizadoEn).toISOString())}` : "Actualizar"}</span>
    </button>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { enLinea, auto, setAuto, aviso } = useSimat();
  const [menu, setMenu] = useState(false);
  const actual = NAV.find((n) => activa(n.href, pathname))?.label ?? NAV[0].label;
  const off = enLinea === false;

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    document.title = `${actual} · SIMAT-GAL`;
  }, [actual]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className={`simat${menu ? " nav-open" : ""}`}>
      <a
        className="skip-link"
        href="#view"
        onClick={(e) => {
          e.preventDefault();
          const view = document.getElementById("view");
          view?.setAttribute("tabindex", "-1");
          view?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <aside className="sidebar" id="sidebar" aria-label="Menú principal">
        <Link href="/simat" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icono nombre="waves" />
          </span>
          <span className="brand-text">
            <strong>SIMAT-GAL</strong>
            <small>Vigilancia territorial</small>
          </span>
        </Link>
        <nav aria-label="Navegación principal">
          <p className="nav-caption">Monitoreo</p>
          {NAV.map(({ href, label, icono }) => {
            const on = activa(href, pathname);
            return (
              <Link key={href} href={href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
                <Icono nombre={icono} />
                {label}
              </Link>
            );
          })}
          <p className="nav-caption">En esta página</p>
          {SECCIONES.map(({ id, label, icono }) => (
            <a key={id} href={`#${id}`} className="nav-seccion" onClick={() => setMenu(false)}>
              <Icono nombre={icono} />
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="scrim" id="scrim" hidden={!menu} onClick={() => setMenu(false)} />
      <main>
        <header className="topbar">
          <button
            type="button"
            className="topbar-menu"
            id="menu"
            aria-label="Abrir menú"
            aria-controls="sidebar"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Icono nombre="menu" />
          </button>
          <div className="crumbs">
            <span>SIMAT-GAL</span>
            <span className="slash" aria-hidden="true">
              /
            </span>
            <strong id="crumb">{actual}</strong>
          </div>
          <div className="topbar-tools">
            <div className={`live-chip${off ? " is-off" : ""}${!off && auto ? " is-live" : ""}`} id="live-chip">
              <span className="live-dot" aria-hidden="true" />
              <span id="live-label">{off ? "Sin conexión" : auto ? "En vivo" : "En línea"}</span>
              <Reloj />
            </div>
            <BotonSincronizar />
            <label className="auto-toggle" title="Actualizar los datos cada 60 segundos">
              <input type="checkbox" id="auto" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span className="switch" aria-hidden="true" />
              <span>Auto</span>
            </label>
          </div>
        </header>
        <section id="view" className="content" aria-live="polite">
          {children}
        </section>
      </main>
      {aviso ? (
        <div id="toast" role="status" key={aviso.id} className={aviso.tono ? `is-${aviso.tono}` : undefined}>
          {aviso.mensaje}
        </div>
      ) : null}
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
