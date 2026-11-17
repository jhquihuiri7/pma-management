"use client";

// Piezas compartidas por las vistas de SIMAT-GAL, equivalentes a los helpers de
// la vista previa (ui.js: head, cardHead, empty, pill, table, statMini, filtros,
// modal) y al dial de riesgo de graficos.js.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { apiErrorMessage } from "@/lib/api-client";
import { dialSegments, unmount } from "@/lib/simat/graficos";
import { Icono, type NombreIcono } from "./iconos";
import { TODAS_LAS_ISLAS, useSimat } from "./contexto";

/** Cabecera de página: hero con foto, velo teal y trama de puntos. */
export function Cabecera({ titulo, descripcion, icono, acciones }: { titulo: string; descripcion: string; icono: NombreIcono; acciones?: ReactNode }) {
  return (
    <section className="hero hero-photo">
      <div className="hero-inner">
        <div className="hero-text">
          <div className="eyebrow">
            <Icono nombre={icono} />
            Vigilancia hidrometeorológica
          </div>
          <h1>{titulo}</h1>
          <p>{descripcion}</p>
        </div>
        {acciones ? <div className="hero-actions">{acciones}</div> : null}
      </div>
    </section>
  );
}

export function CardHead({ titulo, descripcion, extra, icono }: { titulo: ReactNode; descripcion?: ReactNode; extra?: ReactNode; icono?: NombreIcono }) {
  return (
    <div className="card-head">
      <div>
        <h2>
          {icono ? <Icono nombre={icono} /> : null}
          {titulo}
        </h2>
        {descripcion ? <p className="meta">{descripcion}</p> : null}
      </div>
      {extra ? <div className="head-tools">{extra}</div> : null}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Pill({ children, color = "", punto = false, className = "" }: { children: ReactNode; color?: string; punto?: boolean; className?: string }) {
  return (
    <span className={`pill ${color} ${className}`.trim()}>
      {punto ? <span className="pd" /> : null}
      {children}
    </span>
  );
}

export function Tabla({ cabeceras, filas }: { cabeceras: ReactNode[]; filas: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cabeceras.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i}>
              {fila.map((celda, j) => (
                <td key={j}>{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatMini({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="stat-mini">
      <small>{etiqueta}</small>
      <strong>{children}</strong>
    </div>
  );
}

export function FiltroIsla() {
  const { estado, isla, setIsla } = useSimat();
  return (
    <label>
      Ámbito territorial
      <select value={isla} onChange={(e) => setIsla(e.target.value)}>
        {[TODAS_LAS_ISLAS, ...(estado?.islas ?? [])].map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FiltroEstacion() {
  const { estacionesAmbito, estacionId, setEstacionId } = useSimat();
  return (
    <label>
      Estación
      <select value={estacionId ?? ""} onChange={(e) => setEstacionId(e.target.value)} disabled={!estacionesAmbito.length}>
        {estacionesAmbito.length ? (
          estacionesAmbito.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre} · {s.id}
            </option>
          ))
        ) : (
          <option value="">Sin estación disponible</option>
        )}
      </select>
    </label>
  );
}

/** Dial de nivel de riesgo (ordinal, 4 estados). `nivel` = −1 sin evaluación. */
export function Dial({ nivel }: { nivel: number }) {
  const { segments, needle } = dialSegments(nivel);
  return (
    <svg className="dial" viewBox="0 0 200 112" aria-hidden="true">
      {segments.map((s, i) => (
        <path key={i} d={s.d} fill={s.fill} opacity={s.opacity} />
      ))}
      {needle ? (
        <>
          <line x1={100} y1={100} x2={needle.x2} y2={needle.y2} stroke="#0f172a" strokeWidth={4} strokeLinecap="round" />
          <circle cx={100} cy={100} r={8} fill="#0f172a" />
          <circle cx={100} cy={100} r={3} fill="#fff" />
        </>
      ) : (
        <circle cx={100} cy={100} r={6} fill="#cbd5e1" />
      )}
    </svg>
  );
}

/**
 * Contenedor de un gráfico SVG de lib/simat/graficos. Redibuja cuando cambia
 * `clave` (la identidad de los datos) y libera el observador al desmontar.
 */
export function Grafico({ dibujar, clave, id, className = "chart" }: { dibujar: (el: HTMLElement) => void; clave: string; id?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fn = useRef(dibujar);
  fn.current = dibujar;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fn.current(el);
    return () => unmount(el);
  }, [clave]);
  return <div ref={ref} id={id} className={className} />;
}

/** Diálogo modal con formulario, como modal() de la vista previa. */
export function Modal({
  titulo,
  boton = "Guardar",
  onEnviar,
  onCerrar,
  children,
}: {
  titulo: string;
  boton?: string;
  onEnviar: (datos: FormData) => Promise<void>;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEnviando(true);
    setError("");
    try {
      await onEnviar(new FormData(e.currentTarget));
      ref.current?.close();
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo guardar."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <dialog ref={ref} onClose={onCerrar} aria-labelledby="modal-title">
      <div className="modal-head">
        <h2 id="modal-title">{titulo}</h2>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={() => ref.current?.close()}>
          <Icono nombre="close" />
        </button>
      </div>
      <form id="form" onSubmit={enviar}>
        <div className="stack">
          {children}
          <div className="form-error" role="alert">
            {error}
          </div>
          <button className="button" disabled={enviando}>
            {boton}
          </button>
        </div>
      </form>
    </dialog>
  );
}
