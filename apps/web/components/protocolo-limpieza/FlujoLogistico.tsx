"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MapPin, Ship } from "lucide-react";
import { extremosRuta, routes, type RutaLimpieza } from "@pma/types/protocolo-limpieza";
import type { EstadoAcumulacion } from "@/lib/protocolo-limpieza/acumulacion";
import { flowMain, flowZones, pctText, qtyText, traspasos, type TipoTraspaso } from "@/lib/protocolo-limpieza/tablero";
import { RouteIcon } from "./RutaIcono";

// Flujo logístico: cada nodo es una ruta del protocolo, unidos por líneas continuas; R2.1 se
// deriva del acopio temporal. Entre cada ruta se muestra cuánto pasó a la siguiente y qué
// porcentaje es de lo que entró a la anterior; en pantallas angostas el dato va dentro de cada ruta.
// Una ruta en ejecución (con registros hoy) lleva, como en el mapa, el punto verde y la escena animada.

interface Geometria {
  viewBox: string;
  main: string[];
  branch: string;
  junction: { x: string; y: string };
  stacked: boolean;
  passes: Partial<Record<RutaLimpieza, { left: string; top: string; anchor: "top" | "left" }>>;
}

const n = (v: number) => v.toFixed(1);

/** false while the system asks for reduced motion: the still scene is shown then. */
function useMovimiento(): boolean {
  const [movimiento, setMovimiento] = useState(false);
  useEffect(() => {
    const consulta = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!consulta) {
      setMovimiento(true);
      return;
    }
    const actualizar = () => setMovimiento(!consulta.matches);
    actualizar();
    consulta.addEventListener("change", actualizar);
    return () => consulta.removeEventListener("change", actualizar);
  }, []);
  return movimiento;
}

// Traza las conexiones según la posición real de los iconos (horizontal en escritorio, vertical en móvil).
function medir(flow: HTMLDivElement): Geometria | null {
  const box = flow.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const at = (route: string) => {
    const r = flow.querySelector(`[data-flow-icon="${route}"]`)!.getBoundingClientRect();
    const l = r.left - box.left, t = r.top - box.top;
    return { l, t, r: l + r.width, b: t + r.height, cx: l + r.width / 2, cy: t + r.height / 2 };
  };
  type Caja = ReturnType<typeof at>;
  const gap = 9, bend = 16;
  const sameRow = (a: Caja, b: Caja) => Math.abs(a.cy - b.cy) < 8;
  const link = (a: Caja, b: Caja) => (sameRow(a, b) ? `M${n(a.r + gap)} ${n(a.cy)}H${n(b.l - gap)}` : `M${n(a.cx)} ${n(a.b + gap)}V${n(b.t - gap)}`);
  const main = flowMain.map(at), [r1, r2] = main, r21 = at("R2.1");
  const j = sameRow(r1, r2) ? { x: (r1.r + r2.l) / 2, y: r1.cy } : { x: r1.cx, y: r1.b + gap + 8 };
  const branch = `M${n(j.x)} ${n(j.y)}V${n(r21.cy - bend)}Q${n(j.x)} ${n(r21.cy)} ${n(j.x + bend)} ${n(r21.cy)}H${n(r21.l - gap)}`;
  // Traspasos: sobre cada conexión en escritorio; dentro de cada ruta cuando el flujo se apila.
  const stacked = !sameRow(r1, r2);
  const passes: Geometria["passes"] = {};
  if (!stacked) {
    main.slice(1).forEach((b, i) => { passes[flowMain[i + 1]] = { left: `${n((main[i].r + b.l) / 2)}px`, top: `${n(main[i].cy - 10)}px`, anchor: "top" }; });
    passes["R2.1"] = { left: `${n(j.x - 12)}px`, top: `${n(r21.cy - bend - 24)}px`, anchor: "left" };
  }
  return {
    viewBox: `0 0 ${n(box.width)} ${n(box.height)}`,
    main: main.slice(1).map((b, i) => link(main[i], b)),
    branch,
    junction: { x: n(j.x), y: n(j.y) },
    stacked,
    passes,
  };
}

function Linea({ d, kind }: { d: string; kind: TipoTraspaso }) {
  return (
    <>
      <path className={`flow-track is-${kind}`} d={d} />
      <path className={`flow-dash is-${kind}`} d={d} markerEnd={`url(#flow-arrow-${kind})`} />
    </>
  );
}

export default function FlujoLogistico({ estado, onRoute }: { estado: EstadoAcumulacion; onRoute(route: RutaLimpieza): void }) {
  const flowRef = useRef<HTMLDivElement>(null);
  const [geometria, setGeometria] = useState<Geometria | null>(null);
  const pases = useMemo(() => traspasos(estado), [estado]);
  const movimiento = useMovimiento();

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    let anterior = "";
    const dibujar = () => {
      const siguiente = medir(flow);
      const clave = JSON.stringify(siguiente);
      if (clave === anterior) return;
      anterior = clave;
      setGeometria(siguiente);
    };
    const observer = new ResizeObserver(dibujar);
    observer.observe(flow);
    dibujar();
    return () => observer.disconnect();
  }, []);

  const datoDe = (route: RutaLimpieza) => {
    if (route === "R1") return <span className="flow-total">Ingresó {qtyText(estado.moved.R1, estado.unit)}</span>;
    const pase = pases.find((p) => p.to === route);
    if (!pase) return null;
    return (
      <span className={`flow-in is-${pase.kind}${pase.amount > 0 ? "" : " is-zero"}`}>
        Pasó {qtyText(pase.amount, estado.unit)} · {pctText(pase.share)} de {pase.from}
      </span>
    );
  };

  return (
    <div id="flow" ref={flowRef} className={`flow${geometria?.stacked ? " is-stacked" : ""}`} aria-label="Rutas del protocolo logístico">
      {flowZones.map(([key, name, symbol]) => (
        <div key={key} className={`flow-zone is-${key}`} aria-hidden="true">
          <span>{symbol === "ship" ? <Ship className="ico" /> : <MapPin className="ico" />}{name}</span>
        </div>
      ))}
      <svg className="flow-lines" aria-hidden="true" viewBox={geometria?.viewBox}>
        {geometria && (
          <>
            <defs>
              {(["main", "branch"] as const).map((kind) => (
                <marker key={kind} id={`flow-arrow-${kind}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
                  <path className={`flow-arrow is-${kind}`} d="M1 1.2 8.6 5 1 8.8z" />
                </marker>
              ))}
            </defs>
            {geometria.main.map((d, i) => <Linea key={i} d={d} kind="main" />)}
            <Linea d={geometria.branch} kind="branch" />
            <circle className="flow-junction" cx={geometria.junction.x} cy={geometria.junction.y} r="5" />
          </>
        )}
      </svg>
      {(["R1", "R2.1", ...flowMain.slice(1)] as RutaLimpieza[]).map((route) => {
        const [from, to] = extremosRuta(route), enEjecucion = estado.active.has(route);
        return (
          <button
            key={route}
            type="button"
            className="flow-node"
            data-step-route={route}
            aria-label={`${route} · ${routes[route][0]}${enEjecucion ? " · en ejecución" : ""}. Ver registros de la ruta`}
            onClick={() => onRoute(route)}
          >
            <span className="flow-icon" data-flow-icon={route}>
              <RouteIcon route={route} size={64} enEjecucion={enEjecucion} animado={enEjecucion && movimiento} />
            </span>
            <span className="flow-text">
              <span className="tag">{route}</span>
              <span className="flow-from">{from}&nbsp;→</span>
              <strong className="flow-to">{to}</strong>
              <span className="flow-data" data-route-data={route}>{datoDe(route)}</span>
            </span>
          </button>
        );
      })}
      {pases.map((pase) => {
        const posicion = geometria?.passes[pase.to];
        return (
          <div
            key={pase.to}
            className={`flow-pass is-${pase.kind}${pase.amount > 0 ? "" : " is-zero"}`}
            data-pass={pase.to}
            data-anchor={posicion?.anchor}
            title={pase.label}
            hidden={!posicion}
            style={posicion ? { left: posicion.left, top: posicion.top } : undefined}
          >
            <span className="flow-pass-row"><b>{qtyText(pase.amount, estado.unit)}</b><em>{pctText(pase.share)}</em></span>
            <i style={{ "--p": `${Math.min(100, pase.share * 100).toFixed(1)}%` } as CSSProperties} />
            <span className="sr-only">{pase.label}</span>
          </div>
        );
      })}
      <div className="flow-legend" aria-hidden="true">
        <span><i className="is-main" />Ruta principal hacia Guayaquil</span>
        <span><i className="is-branch" />Derivación local · relleno sanitario</span>
        <span><i className="is-live" />En ejecución: hubo registros hoy</span>
      </div>
    </div>
  );
}
