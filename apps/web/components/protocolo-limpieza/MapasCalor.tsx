"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import { Map as MapIcon, Maximize2, Minimize2, Minus, Plus, RotateCcw, SquareDashed } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { balanceGestion, type EstadoAcumulacion } from "@/lib/protocolo-limpieza/acumulacion";
import { gradienteLimpieza } from "@/lib/protocolo-limpieza/barrios";
import type { LimpiezaBarrio } from "@/lib/protocolo-limpieza/tablero";
import { useProtocoloLimpieza } from "./contexto";
import { agregarCapaBarrios, type CapaBarrios } from "./mapa/capaBarrios";
import { createAccumulationMaps, gradienteCalor, type MapasAcumulacion, type VistaMapa } from "./mapa/mapasCalor";

/**
 * Mapa de calor de residuos: una tarjeta de Santa Cruz y otra del tramo marítimo y Guayaquil.
 * Leaflet only runs in the browser, so it is loaded here, after the page mounts. The Santa
 * Cruz map also gets the Geoportal's neighbourhoods (read once by the module's layout, under
 * the Geoportal's visibility rules), coloured by their latest cleaning percentage.
 */
/** "56 %": the share of what must reach Guayaquil. */
const porcentaje = (parte: number) => `${Math.round(parte * 100)} %`;

export default function MapasCalor({ estado, limpieza }: { estado: EstadoAcumulacion; limpieza: ReadonlyMap<string, LimpiezaBarrio> }) {
  const { barrios } = useProtocoloLimpieza();
  const balance = balanceGestion(estado);
  const islaRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const mapasRef = useRef<MapasAcumulacion | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const capaRef = useRef<CapaBarrios | null>(null);
  const estadoRef = useRef(estado);
  const limpiezaRef = useRef(limpieza);
  const [listos, setListos] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [calor, setCalor] = useState(true);
  // The Santa Cruz card can grow to fill the screen; collapsing brings back the view it had.
  const [expandido, setExpandido] = useState(false);
  const [seleccionando, setSeleccionando] = useState(false);
  const vistaAntesRef = useRef<VistaMapa | null>(null);
  const cancelarSeleccionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let descartado = false;
    let mapas: MapasAcumulacion | null = null;
    (async () => {
      try {
        const modulo = await import("leaflet");
        const L = (modulo as unknown as { default?: typeof modulo }).default ?? modulo;
        // Registers `L.maplibreGL`, for the Geoportal's light basemap (it reaches for the DOM on load).
        await import("@maplibre/maplibre-gl-leaflet");
        if (descartado || !islaRef.current || !regionRef.current) return;
        const sinMovimiento = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        mapas = createAccumulationMaps(L, { island: islaRef.current, region: regionRef.current }, { motion: !sinMovimiento });
        mapasRef.current = mapas;
        leafletRef.current = L;
        mapas.update(estadoRef.current);
        setListos(true);
      } catch (error) {
        console.error(error);
        if (!descartado) setFallo(true);
      }
    })();
    return () => {
      descartado = true;
      mapas?.destroy();
      mapasRef.current = null;
      capaRef.current = null;
    };
  }, []);

  // The neighbourhoods go on once both the maps and the layer are ready.
  useEffect(() => {
    if (!listos || capaRef.current || barrios?.estado !== "lista" || !mapasRef.current || !leafletRef.current) return;
    capaRef.current = agregarCapaBarrios(leafletRef.current, mapasRef.current.islandMap, barrios.datos);
    capaRef.current.pintar(limpiezaRef.current);
  }, [listos, barrios]);

  useEffect(() => {
    estadoRef.current = estado;
    mapasRef.current?.update(estado);
  }, [estado]);

  useEffect(() => {
    limpiezaRef.current = limpieza;
    capaRef.current?.pintar(limpieza);
  }, [limpieza]);

  useEffect(() => {
    if (listos) mapasRef.current?.mostrarCalor(calor);
  }, [listos, calor]);

  // Zoom to an area: the button toggles the mode; the drag itself is mapa/seleccionArea.ts.
  const alternarSeleccion = useCallback(() => {
    if (cancelarSeleccionRef.current) {
      cancelarSeleccionRef.current();
      return;
    }
    const mapas = mapasRef.current;
    if (!mapas) return;
    setSeleccionando(true);
    cancelarSeleccionRef.current = mapas.seleccionarArea(() => {
      cancelarSeleccionRef.current = null;
      setSeleccionando(false);
    });
  }, []);

  const alternarExpandido = useCallback(() => {
    cancelarSeleccionRef.current?.();
    setExpandido((antes) => {
      if (!antes) vistaAntesRef.current = mapasRef.current?.vistaIsla() ?? null;
      return !antes;
    });
  }, []);

  // Once the card has its new size: same view while expanded, the earlier one when collapsed.
  const primerAjuste = useRef(true);
  useLayoutEffect(() => {
    if (primerAjuste.current) {
      primerAjuste.current = false;
      return;
    }
    mapasRef.current?.ajustarIsla({ expandido, vista: vistaAntesRef.current ?? undefined });
    if (!expandido) vistaAntesRef.current = null;
  }, [expandido]);

  // Escape cancels the area first, then collapses. Registered once and read through refs, so a
  // key pressed right after a click (before React re-renders) is not lost.
  const expandidoRef = useRef(expandido);
  expandidoRef.current = expandido;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cancelarSeleccionRef.current) cancelarSeleccionRef.current();
      else if (expandidoRef.current) setExpandido(false);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);
  // Expanded, the page behind does not scroll.
  useEffect(() => {
    if (!expandido) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [expandido]);
  useEffect(() => () => cancelarSeleccionRef.current?.(), []);

  const mapa = (id: string, ref: React.RefObject<HTMLDivElement>, etiqueta: string) =>
    fallo ? (
      <div className="acc-map"><p className="empty">No se pudo cargar el mapa.</p></div>
    ) : (
      <div id={id} ref={ref} className="acc-map" role="region" aria-label={etiqueta} />
    );

  return (
    <section className="panel acc-panel">
      <div className="panel-heading"><h2><MapIcon className="ico" />Mapa de calor de residuos</h2></div>
      <div className="acc-maps">
        {expandido && <div className="acc-fondo" aria-hidden="true" onClick={alternarExpandido} />}
        <figure className={`acc-card${expandido ? " is-expandida" : ""}`}>
          <figcaption>
            <div>
              <strong>Santa Cruz</strong>
              {barrios && barrios.estado !== "lista" && <small className="acc-note" title={barrios.motivo}>Barrios no disponibles</small>}
            </div>
            <div className="acc-acciones">
              {barrios?.estado === "lista" && (
                // The heat lies over the neighbourhoods: hiding it shows their cleaning colour.
                <button type="button" className="acc-fit" aria-pressed={!calor} onClick={() => setCalor((v) => !v)}>
                  {calor ? "Ocultar calor" : "Mostrar calor"}
                </button>
              )}
            </div>
          </figcaption>
          <div className="acc-map-wrap">
            {mapa("acc-island", islaRef, "Mapa de Santa Cruz con la concentración de residuos por ruta y la limpieza de cada barrio")}
            {listos && (
              <div className="acc-controles" role="toolbar" aria-label="Controles del mapa de Santa Cruz">
                <div className="acc-controles-zoom">
                  <button type="button" title="Acercar" aria-label="Acercar" onClick={() => mapasRef.current?.acercar(1)}><Plus /></button>
                  <button type="button" title="Alejar" aria-label="Alejar" onClick={() => mapasRef.current?.acercar(-1)}><Minus /></button>
                </div>
                <button
                  type="button"
                  title="Restablecer la vista"
                  aria-label="Restablecer la vista"
                  onClick={() => {
                    cancelarSeleccionRef.current?.();
                    mapasRef.current?.fit("island");
                  }}
                >
                  <RotateCcw />
                </button>
                <button
                  type="button"
                  className="acc-control-area"
                  title="Seleccionar un área para acercar"
                  aria-label="Seleccionar un área para acercar"
                  aria-pressed={seleccionando}
                  onClick={alternarSeleccion}
                >
                  <SquareDashed />
                </button>
                <button
                  type="button"
                  className="acc-control-expandir"
                  title={expandido ? "Contraer el mapa" : "Expandir el mapa"}
                  aria-label={expandido ? "Contraer el mapa" : "Expandir el mapa"}
                  aria-expanded={expandido}
                  onClick={alternarExpandido}
                >
                  {expandido ? <Minimize2 /> : <Maximize2 />}
                </button>
              </div>
            )}
            {seleccionando && <p className="acc-seleccion-ayuda" role="status">Arrastra sobre el mapa para marcar el área · Esc cancela</p>}
          </div>
        </figure>
        <figure className="acc-card">
          <figcaption>
            <div>
              <strong>Tramo marítimo y Guayaquil</strong>
              {balance.base > 0 && (
                <small className="acc-gestion">
                  <span><i className="is-rojo" />Por sacar de Galápagos {porcentaje(balance.partePorSacar)}</span>
                  <span><i className="is-verde" />Gestionado en Guayaquil {porcentaje(balance.parteGestionada)}</span>
                </small>
              )}
            </div>
            <button type="button" className="acc-fit" onClick={() => mapasRef.current?.fit("region")}>Centrar</button>
          </figcaption>
          {mapa("acc-region", regionRef, "Mapa del tramo marítimo de Baltra a Guayaquil: lo que falta sacar de Santa Cruz en rojo y lo gestionado en Guayaquil en verde")}
        </figure>
      </div>
      <p className="acc-legend">
        <span className="acc-heat-legend">Acumulación en Santa Cruz: menor<i className="acc-heat-scale" style={{ background: gradienteCalor("rojo") }} />mayor</span>
        <span className="acc-heat-legend">Hacia Guayaquil: por sacar<i className="acc-heat-scale" style={{ background: gradienteCalor("rojo") }} />· gestionado<i className="acc-heat-scale" style={{ background: gradienteCalor("verde") }} /></span>
        {barrios?.estado === "lista" && (
          <>
            <span className="acc-heat-legend">Limpieza del barrio: 0 %<i className="acc-limpieza-scale" style={{ background: gradienteLimpieza() }} />100 %</span>
            <span><i className="is-barrio" />Barrio sin reporte</span>
          </>
        )}
      </p>
    </section>
  );
}
