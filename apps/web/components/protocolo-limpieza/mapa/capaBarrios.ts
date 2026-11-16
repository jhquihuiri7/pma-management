import type * as LeafletNS from "leaflet";
import type { FeatureCollection } from "geojson";
import { barrios as barriosProtocolo } from "@pma/types/protocolo-limpieza";
import { claveBarrio, colorLimpieza, nombreBarrio } from "@/lib/protocolo-limpieza/barrios";
import { escalaMapa, ESTILO_BARRIO_ZIP, ETIQUETA_BARRIO } from "@/lib/protocolo-limpieza/rutasGeoportal";
import { number, type LimpiezaBarrio } from "@/lib/protocolo-limpieza/tablero";
import type { CapaEtiquetas } from "./etiquetas";

/**
 * Panes stack the basemap tiles at 200, the heat spots at 350 (the module's
 * own "accHeat" pane, see mapasCalor.ts), the legs at 400, the points at 600
 * and the tooltips at 650. A pane at 300 keeps the neighbourhoods over the
 * basemap and under every heat spot and point, whatever order the layers are
 * added in.
 */
export const PANEL_BARRIOS = "protocoloLimpiezaBarrios";
export const Z_PANEL_BARRIOS = 300;

// A neighbourhood without a report: the style of barrios.qml (capas_residuos_scx_shapefile.zip),
// a mint fill with a green outline at 75 %. A reported one keeps the outline and takes its
// cleaning colour as fill.
const ESTILO_BARRIO: LeafletNS.PathOptions = {
  color: ESTILO_BARRIO_ZIP.borde,
  weight: ESTILO_BARRIO_ZIP.bordeAncho,
  opacity: ESTILO_BARRIO_ZIP.opacidad,
  fillColor: ESTILO_BARRIO_ZIP.relleno,
  fillOpacity: ESTILO_BARRIO_ZIP.opacidad,
};
// The label reads as the protocol writes the name ("Las Orquídeas"), else as the layer does.
const NOMBRE_PROTOCOLO = new Map(barriosProtocolo.map((n) => [claveBarrio(n), n]));
const etiquetaVisible = (map: LeafletNS.Map) => escalaMapa(map.getCenter().lat, map.getZoom()) <= ETIQUETA_BARRIO.escalaMaxima;

// Hover only strengthens the outline, so the cleaning colour stays readable.
const ESTILO_BARRIO_RESALTADO: LeafletNS.PathOptions = { weight: 2.2, opacity: 0.95 };

export interface CapaBarrios {
  /** Colours each neighbourhood by its latest cleaning percentage (by claveBarrio). */
  pintar(limpieza: ReadonlyMap<string, LimpiezaBarrio>): void;
}

/**
 * Draws the neighbourhoods in their own pane, with the name (and cleaning) on hover and, close
 * enough (1:60.000), the name as a label of the .qml style.
 */
export function agregarCapaBarrios(L: typeof LeafletNS, map: LeafletNS.Map, datos: FeatureCollection, etiquetas?: CapaEtiquetas): CapaBarrios {
  const panel = map.getPane(PANEL_BARRIOS) ?? map.createPane(PANEL_BARRIOS);
  panel.style.zIndex = String(Z_PANEL_BARRIOS);

  const barrios: Array<{ capa: LeafletNS.Path; nombre: string | null; estilo: LeafletNS.PathOptions }> = [];
  L.geoJSON(datos, {
    pane: PANEL_BARRIOS,
    style: () => ESTILO_BARRIO,
    onEachFeature: (feature, layer) => {
      const barrio = { capa: layer as LeafletNS.Path, nombre: nombreBarrio(feature.properties), estilo: ESTILO_BARRIO };
      barrios.push(barrio);
      if (barrio.nombre) layer.bindTooltip(barrio.nombre, { sticky: true, direction: "top", opacity: 0.95 });
      layer.on({
        mouseover: () => barrio.capa.setStyle(ESTILO_BARRIO_RESALTADO),
        mouseout: () => barrio.capa.setStyle(barrio.estilo),
      });
    },
  }).addTo(map);

  etiquetas?.fijar(
    "barrios",
    barrios
      .filter((b) => b.nombre && typeof (b.capa as LeafletNS.Polygon).getCenter === "function")
      .map((b, i) => {
        const c = (b.capa as LeafletNS.Polygon).getCenter();
        return {
          id: `barrio-${i}`, tipo: "area" as const, latlng: [c.lat, c.lng] as [number, number],
          texto: NOMBRE_PROTOCOLO.get(claveBarrio(b.nombre)) ?? b.nombre!, clase: "acc-etq-barrio", visible: etiquetaVisible,
        };
      }),
  );

  return {
    pintar(limpieza) {
      for (const barrio of barrios) {
        const dato = barrio.nombre ? limpieza.get(claveBarrio(barrio.nombre)) : undefined;
        // Red at 0 %, lime at 100 %, through orange and yellow.
        barrio.estilo = dato ? { ...ESTILO_BARRIO, ...colorLimpieza(dato.avance) } : ESTILO_BARRIO;
        barrio.capa.setStyle(barrio.estilo);
        if (barrio.nombre) {
          barrio.capa.setTooltipContent(dato ? `${barrio.nombre} · limpieza ${number(dato.avance)} %` : `${barrio.nombre} · sin reporte`);
        }
      }
    },
  };
}
