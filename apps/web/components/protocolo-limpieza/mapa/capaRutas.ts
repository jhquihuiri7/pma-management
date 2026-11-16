import type * as LeafletNS from "leaflet";
import { routes, type RutaLimpieza } from "@pma/types/protocolo-limpieza";
import {
  ANILLOS_PUNTO,
  CAPAS_RUTAS,
  colorPunto,
  ESTILO_TRAMOS,
  ETIQUETA_PUNTO,
  simboloTramo,
  type DatosRutas,
} from "@/lib/protocolo-limpieza/rutasGeoportal";
import type { DefEtiqueta } from "./etiquetas";

type LatLng = [number, number];

/** Pane of the point symbols: over the routes (400), under the module's icons (600) and the labels (580). */
const PANEL_ANILLOS = "accAnillos";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const km = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });

export interface CapaRutas {
  /** One visible line per route segment, to mark the routes with movement today. */
  lineas: Array<{ route: string; line: LeafletNS.Polyline }>;
  /** Point names first, then route codes: the order QGIS gives the top layer. */
  etiquetas: DefEtiqueta[];
  quitar(): void;
}

/**
 * Draws the Geoportal's route segments and points with the style of their
 * .qml: the dashed line of each rule, the three-disc point symbols and their
 * labels (placed by etiquetas.ts). A segment no rule matches is not drawn, as in QGIS.
 */
export function dibujarRutas(L: typeof LeafletNS, map: LeafletNS.Map, datos: DatosRutas): CapaRutas {
  const panel = map.getPane(PANEL_ANILLOS) ?? map.createPane(PANEL_ANILLOS);
  panel.style.zIndex = "550";
  const grupo = L.layerGroup().addTo(map);
  const lineas: CapaRutas["lineas"] = [];
  const etiquetasTramos: DefEtiqueta[] = [];
  const etiquetasPuntos: DefEtiqueta[] = [];

  datos.tramos.features.forEach((f, i) => {
    const simbolo = simboloTramo(f.properties);
    if (!simbolo || !f.geometry) return;
    const estilo = ESTILO_TRAMOS[simbolo];
    const ruta = String(f.properties?.ruta ?? "").trim();
    const linea = f.geometry.coordinates.map(([lon, lat]) => [lat, lon] as LatLng);
    const visible = L.polyline(linea, {
      className: `acc-ruta is-${simbolo}`,
      color: estilo.color,
      weight: estilo.ancho,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
      dashArray: estilo.guiones.join(" "),
      interactive: false,
    }).addTo(grupo);
    // One dash period, for the flow of a route with movement today (protocolo-limpieza.css).
    (visible.getElement() as SVGElement | undefined)?.style.setProperty("--periodo", `${estilo.guiones.reduce((a, b) => a + b, 0)}px`);
    // The .qml's 2.4 mm transparent line: draws nothing, here it is where the pointer finds the route.
    const trayecto = routes[ruta as RutaLimpieza]?.[0] ?? String(f.properties?.nombre ?? "");
    const largo = Number(f.properties?.km_red);
    L.polyline(linea, { className: "acc-ruta-toque", color: "#ffffff", opacity: 0, weight: 14 })
      .bindTooltip(
        `<strong>${esc(ruta)}</strong> · ${esc(trayecto)}<br>${esc(f.properties?.modo ?? "")}${Number.isFinite(largo) ? ` · ${km.format(largo)} km` : ""}<br><small>${esc(estilo.leyenda)}</small>`,
        { sticky: true, className: "acc-tip" },
      )
      .addTo(grupo);
    lineas.push({ route: ruta, line: visible });
    if (ruta) etiquetasTramos.push({ id: `tramo-${i}`, tipo: "linea", linea, texto: ruta, clase: "acc-etq-tramo" });
  });

  datos.puntos.features.forEach((f, i) => {
    if (!f.geometry) return;
    const [lon, lat] = f.geometry.coordinates;
    const nombre = String(f.properties?.[CAPAS_RUTAS.campoNombre] ?? "").trim();
    const tam = ANILLOS_PUNTO.exterior;
    L.marker([lat, lon], {
      pane: PANEL_ANILLOS,
      keyboard: false,
      icon: L.divIcon({
        className: "acc-anillo-marker",
        html: `<span class="acc-anillo" style="--c:${colorPunto(nombre)};--disco:${ANILLOS_PUNTO.color}px;--centro:${ANILLOS_PUNTO.centro}px"><i></i></span>`,
        iconSize: [tam, tam],
        iconAnchor: [tam / 2, tam / 2],
      }),
    })
      .bindTooltip(`<strong>${esc(nombre)}</strong>`, { direction: "top", offset: [0, -tam / 2], className: "acc-tip" })
      .addTo(grupo);
    if (nombre) {
      etiquetasPuntos.push({
        id: `punto-${i}`, tipo: "punto", latlng: [lat, lon], texto: nombre, clase: "acc-etq-punto",
        radio: tam / 2, distancia: ETIQUETA_PUNTO.distancia,
      });
    }
  });

  return {
    lineas,
    etiquetas: [...etiquetasPuntos, ...etiquetasTramos],
    quitar() { map.removeLayer(grupo); },
  };
}
