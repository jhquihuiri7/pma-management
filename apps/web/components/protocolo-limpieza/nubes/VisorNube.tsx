"use client";

import { useEffect, useRef, useState } from "react";
import type { Calidad, EstadoCarga, ModoColor, NubeEnVisor, VisorNubes } from "./visor/escena";

interface Props {
  nube: NubeEnVisor | null;
  modo: ModoColor;
  calidad: Calidad;
  clases: ReadonlySet<number> | null;
  tamaño: number;
  realce: boolean;
  /** Changes on every "restablecer vista" press. */
  restablecer: number;
  etiqueta: string;
}

const conWebGL2 = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

/**
 * The Giro3D viewer inside React. The engine (visor/escena.ts) is loaded here,
 * after the page mounts: three.js and Giro3D never reach the other tabs.
 */
export default function VisorNube({ nube, modo, calidad, clases, tamaño, realce, restablecer, etiqueta }: Props) {
  const lienzoRef = useRef<HTMLDivElement>(null);
  const visorRef = useRef<VisorNubes | null>(null);
  const [listo, setListo] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [carga, setCarga] = useState<EstadoCarga>({ cargando: false, progreso: 1, puntosEnPantalla: 0 });
  const ajustesRef = useRef({ modo, calidad, clases, tamaño, realce });
  ajustesRef.current = { modo, calidad, clases, tamaño, realce };

  useEffect(() => {
    let descartado = false;
    let visor: VisorNubes | null = null;
    if (!conWebGL2()) {
      setFallo("Este navegador no puede mostrar gráficos 3D (WebGL 2). Usa una versión reciente de Chrome, Edge o Firefox.");
      return;
    }
    (async () => {
      try {
        const { crearVisorNubes } = await import("./visor/escena");
        if (descartado || !lienzoRef.current) return;
        let ultimo = 0;
        visor = crearVisorNubes(lienzoRef.current, (estado) => {
          // At most a few updates a second: the engine reports every frame.
          const ahora = performance.now();
          if (estado.cargando && ahora - ultimo < 250) return;
          ultimo = ahora;
          setCarga(estado);
        });
        const a = ajustesRef.current;
        visor.colorear(a.modo);
        visor.calidad(a.calidad);
        visor.clasesVisibles(a.clases);
        visor.tamañoPunto(a.tamaño);
        visor.realce(a.realce);
        visorRef.current = visor;
        setListo(true);
      } catch (error) {
        console.error(error);
        if (!descartado) setFallo("No se pudo iniciar el visor 3D.");
      }
    })();
    return () => {
      descartado = true;
      visor?.destruir();
      visorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!listo || !nube) return;
    setCarga((c) => ({ ...c, cargando: true, progreso: 0 }));
    visorRef.current?.mostrar(nube).catch((error) => {
      console.error(error);
      setFallo("No se pudo leer la nube de puntos. Recarga la página o vuelve a intentarlo más tarde.");
    });
  }, [listo, nube]);

  useEffect(() => { if (listo) visorRef.current?.colorear(modo); }, [listo, modo]);
  useEffect(() => { if (listo) visorRef.current?.calidad(calidad); }, [listo, calidad]);
  useEffect(() => { if (listo) visorRef.current?.clasesVisibles(clases); }, [listo, clases]);
  useEffect(() => { if (listo) visorRef.current?.tamañoPunto(tamaño); }, [listo, tamaño]);
  useEffect(() => { if (listo) visorRef.current?.realce(realce); }, [listo, realce]);
  useEffect(() => { if (listo && restablecer > 0) visorRef.current?.restablecerVista(); }, [listo, restablecer]);

  return (
    <div className="nubes-lienzo-wrap">
      {/* Giro3D owns this element's content. */}
      <div ref={lienzoRef} className="nubes-lienzo" role="img" aria-label={etiqueta} />
      {fallo && <p className="nubes-aviso is-error">{fallo}</p>}
      {!fallo && (!listo || (carga.cargando && carga.progreso < 1)) && (
        <div className="nubes-carga" role="status" aria-live="polite">
          <span>{listo ? `Cargando puntos… ${Math.round(carga.progreso * 100)} %` : "Preparando el visor 3D…"}</span>
          <i style={{ width: `${Math.round((listo ? carga.progreso : 0) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
