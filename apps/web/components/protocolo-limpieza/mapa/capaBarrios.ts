import type * as LeafletNS from "leaflet";
import type { FeatureCollection } from "geojson";
import { claveBarrio, colorLimpieza, nombreBarrio } from "@/lib/protocolo-limpieza/barrios";
import { number, type LimpiezaBarrio } from "@/lib/protocolo-limpieza/tablero";

/**
 * Panes stack the basemap tiles at 200, the heat spots at 350 (the module's
 * own "accHeat" pane, see mapasCalor.ts), the legs at 400, the points at 600
 * and the tooltips at 650. A pane at 300 keeps the neighbourhoods over the
 * basemap and under every heat spot and point, whatever order the layers are
 * added in.
 */
export const PANEL_BARRIOS = "protocoloLimpiezaBarrios";
export const Z_PANEL_BARRIOS = 300;

// A neighbourhood without a report: a soft outline, the map shows through.
const ESTILO_BARRIO: LeafletNS.PathOptions = {
  color: "#475569",
  weight: 1,
  opacity: 0.55,
  fillColor: "#94a3b8",
  fillOpacity: 0.06,
};

// Hover only strengthens the outline, so the cleaning colour stays readable.
const ESTILO_BARRIO_RESALTADO: LeafletNS.PathOptions = { weight: 2.2, opacity: 0.95 };

export interface CapaBarrios {
  /** Colours each neighbourhood by its latest cleaning percentage (by claveBarrio). */
  pintar(limpieza: ReadonlyMap<string, LimpiezaBarrio>): void;
}

/** Draws the neighbourhoods in their own pane, with the name (and cleaning) on hover. */
export function agregarCapaBarrios(L: typeof LeafletNS, map: LeafletNS.Map, datos: FeatureCollection): CapaBarrios {
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
