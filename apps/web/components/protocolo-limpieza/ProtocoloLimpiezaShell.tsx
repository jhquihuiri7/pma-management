"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardList, LayoutGrid, Leaf, List, LogOut, Plus, Rotate3d } from "lucide-react";
import { barrios as barriosProtocolo, type OperacionLimpieza, type RegistroLimpieza } from "@pma/types/protocolo-limpieza";
import { fetchLayerData, fetchLayers } from "@/components/geo/gis/persistence";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import type { Unidad } from "@/lib/protocolo-limpieza/acumulacion";
import { listarRegistros } from "@/lib/protocolo-limpieza/api";
import { cargarBarrios, nombresBarrios as nombresDeLaCapa, type EstadoBarrios } from "@/lib/protocolo-limpieza/barrios";
import { heroCopy, UNIDADES, type VistaLimpieza } from "@/lib/protocolo-limpieza/tablero";
import { ContextoLimpieza, type ContextoProtocoloLimpieza } from "./contexto";
import DialogoDetalle from "./DialogoDetalle";
import DialogoReporte from "./DialogoReporte";
import "./protocolo-limpieza.css";

const BASE = "/protocolo-limpieza";

// The standalone app switched views inside one page; here each view is a
// route, so a link can point at one, like the other SIGTAR modules.
const VISTAS = [
  { vista: "dashboard", href: BASE, etiqueta: "Tablero", Icono: LayoutGrid },
  { vista: "history", href: `${BASE}/registros`, etiqueta: "Registros", Icono: List },
  { vista: "protocol", href: `${BASE}/protocolo`, etiqueta: "Protocolo", Icono: ClipboardList },
  { vista: "nubes", href: `${BASE}/visualizacion-3d`, etiqueta: "Visualización 3D", Icono: Rotate3d },
] as const;

const ROLES: Record<string, string> = { ADMIN: "Administrador", REPORTER: "Reportero", VIEWER: "Visualizador" };

// Consulta automática cada 10 segundos mientras el tablero está visible.
const REFRESCO_MS = 10_000;

function vistaDe(pathname: string | null): VistaLimpieza {
  if (pathname?.startsWith(`${BASE}/registros`)) return "history";
  if (pathname?.startsWith(`${BASE}/protocolo`)) return "protocol";
  if (pathname?.startsWith(`${BASE}/visualizacion-3d`)) return "nubes";
  return "dashboard";
}

function motivoSinSincronizar(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Tu sesión terminó. Vuelve a iniciar sesión para sincronizar.";
  if (error instanceof ApiError && error.status === 403) {
    return "Tu usuario no tiene acceso al Protocolo de limpieza. Pide al administrador que te lo asigne.";
  }
  return "No se pudo sincronizar. El tablero conserva la última lectura disponible.";
}

interface EstadoReporte {
  abierto: boolean;
  apertura: number;
  row: RegistroLimpieza | null;
  kind: OperacionLimpieza;
}

export default function ProtocoloLimpiezaShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, logoutPending } = useAuth();
  const vista = vistaDe(pathname);

  const [records, setRecords] = useState<RegistroLimpieza[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [unit, setUnit] = useState<Unidad>("t");
  const [reporte, setReporte] = useState<EstadoReporte>({ abierto: false, apertura: 0, row: null, kind: "recoleccion" });
  const [detalle, setDetalle] = useState<RegistroLimpieza | null>(null);
  const [barrios, setBarrios] = useState<EstadoBarrios | null>(null);
  const guardando = useRef(false);
  const lectura = useRef(0);
  const montado = useRef(true);

  // Only the latest read may land: a slow answer never overwrites a newer one.
  const refresh = useCallback(async () => {
    const turno = ++lectura.current;
    try {
      const data = await listarRegistros();
      if (!montado.current || turno !== lectura.current) return;
      setRecords(data);
      setStatus("");
    } catch (error) {
      if (!montado.current || turno !== lectura.current) return;
      setStatus(motivoSinSincronizar(error));
    } finally {
      if (montado.current && turno === lectura.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden && !guardando.current) void refresh(); }, REFRESCO_MS);
    const alVolver = () => { if (!guardando.current) void refresh(); };
    window.addEventListener("focus", alVolver);
    return () => {
      montado.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", alVolver);
    };
  }, [refresh]);

  // The neighbourhoods, read once through the Geoportal's own client (and its visibility rules).
  useEffect(() => {
    let vigente = true;
    void cargarBarrios({ fetchLayers, fetchLayerData }).then((estado) => { if (vigente) setBarrios(estado); });
    return () => { vigente = false; };
  }, []);
  const nombresBarrios = useMemo(
    () => (barrios?.estado === "lista" ? nombresDeLaCapa(barrios.datos) : [...barriosProtocolo]),
    [barrios],
  );

  const openReport = useCallback((kind: OperacionLimpieza = "recoleccion", row: RegistroLimpieza | null = null) => {
    setReporte((prev) => ({ abierto: true, apertura: prev.apertura + 1, row, kind: row?.kind ?? kind }));
  }, []);
  const cerrarReporte = useCallback(() => setReporte((prev) => (prev.abierto ? { ...prev, abierto: false } : prev)), []);
  const cerrarDetalle = useCallback(() => setDetalle(null), []);
  const showRouteRecords = useCallback(
    (route: string) => {
      router.push(`${BASE}/registros?ruta=${encodeURIComponent(route)}`);
      window.scrollTo(0, 0);
    },
    [router],
  );

  const contexto = useMemo<ContextoProtocoloLimpieza>(
    () => ({ records, loaded, status, unit, setUnit, barrios, nombresBarrios, refresh, openReport, showDetail: setDetalle, showRouteRecords }),
    [records, loaded, status, unit, barrios, nombresBarrios, refresh, openReport, showRouteRecords],
  );

  const [titulo, texto] = heroCopy[vista];

  return (
    <ContextoLimpieza.Provider value={contexto}>
      <div className="protocolo-limpieza">
        <div className="app-shell">
          <aside className="side">
            <div className="brand">
              <div className="mark" aria-hidden="true"><Leaf className="ico" /></div>
              <div><strong>Protocolo de limpieza</strong><small>Santa Cruz · Gestión de residuos</small></div>
            </div>
            <nav className="tabs" aria-label="Vistas">
              <p className="side-caption">Operación</p>
              {VISTAS.map(({ vista: destino, href, etiqueta, Icono }) => (
                <Link key={href} href={href} className={vista === destino ? "active" : undefined} aria-current={vista === destino ? "page" : undefined}>
                  <Icono className="ico" />{etiqueta}
                </Link>
              ))}
            </nav>
            <div className="side-bottom">
              {user && (
                <div className="side-place">
                  <span className="side-avatar" aria-hidden="true">{user.name?.[0]?.toUpperCase() ?? "?"}</span>
                  <div><strong>{user.name}</strong><small>{ROLES[user.role] ?? user.role}</small></div>
                </div>
              )}
              <Link href="/select-app" className="side-logout" aria-label="Ver todas las apps">
                <ArrowLeft className="ico" /><span>Ver todas las apps</span>
              </Link>
              <button type="button" className="side-logout" onClick={() => void logout()} disabled={logoutPending} aria-busy={logoutPending} aria-label="Cerrar sesión">
                <LogOut className="ico" /><span>Cerrar sesión</span>
              </button>
            </div>
          </aside>
          <main>
            <header className="hero">
              <div className="hero-inner">
                <div className="hero-top">
                  <div>
                    <p className="eyebrow"><Leaf className="ico" />Santa Cruz · Galápagos</p>
                    <h1 id="hero-title">{titulo}</h1>
                    <p className="hero-text" id="hero-text">{texto}</p>
                  </div>
                  <div className="hero-buttons">
                    <div className={`mode${status ? " is-offline" : ""}`} id="mode" role="status">{status ? "Sin conexión" : "En línea"}</div>
                    <button type="button" className="button hero-primary" id="add" onClick={() => openReport()}>
                      <Plus className="ico" />Reportar
                    </button>
                  </div>
                </div>
                {vista === "dashboard" && (
                  <div className="hero-filters">
                    <label>
                      Unidad
                      <select id="unit" value={unit} onChange={(e) => setUnit(e.target.value as Unidad)}>
                        {UNIDADES.map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </header>
            <div className="page">
              {status && <div id="banner" className="banner">{status}</div>}
              {children}
              <footer className="page-footer">Santa Cruz · Protocolo logístico de residuos</footer>
            </div>
          </main>
        </div>
        <DialogoReporte
          abierto={reporte.abierto}
          apertura={reporte.apertura}
          row={reporte.row}
          kind={reporte.kind}
          records={records}
          nombresBarrios={nombresBarrios}
          onClose={cerrarReporte}
          onRefresh={refresh}
          onSavingChange={(value) => { guardando.current = value; }}
        />
        <DialogoDetalle row={detalle} onClose={cerrarDetalle} />
      </div>
    </ContextoLimpieza.Provider>
  );
}
