import type * as LeafletNS from "leaflet";
import {
  cajaGirada,
  colocarEtiquetas,
  posicionesAlrededor,
  puntoEnLinea,
  type Caja,
  type CandidatoEtiqueta,
} from "@/lib/protocolo-limpieza/colocarEtiquetas";

type LatLng = [number, number];

/** A label of the QGIS style: around a point, along a line or centred in an area. */
export type DefEtiqueta =
  | { id: string; tipo: "punto"; latlng: LatLng; texto: string; clase: string; radio: number; distancia: number }
  | { id: string; tipo: "linea"; linea: LatLng[]; texto: string; clase: string }
  | { id: string; tipo: "area"; latlng: LatLng; texto: string; clase: string; visible?: (map: LeafletNS.Map) => boolean };

export interface CapaEtiquetas {
  /** Replaces the labels of a group. Groups are placed in the order given when the layer is created. */
  fijar(grupo: string, etiquetas: DefEtiqueta[]): void;
  /** Places every label again (after the icons or figures under them change). */
  recolocar(): void;
}

/** Fractions of a line where its label may sit, best first (QGIS centres it, then tries along the line). */
const FRACCIONES_LINEA = [0.5, 0.38, 0.62, 0.25, 0.75];

/**
 * Labels drawn above the routes and under the module's icons, in their own
 * pane. They never cover what `obstaculos` selects (icons, figures, controls):
 * a label with no free position is hidden, as QGIS does. Hidden while Leaflet
 * animates a zoom, placed again when it ends.
 */
export function crearCapaEtiquetas(
  L: typeof LeafletNS,
  map: LeafletNS.Map,
  { grupos, obstaculos }: { grupos: readonly string[]; obstaculos: string },
): CapaEtiquetas {
  const panel = map.getPane("accEtiquetas") ?? map.createPane("accEtiquetas");
  panel.style.zIndex = "580";
  panel.style.pointerEvents = "none";
  const capa = L.DomUtil.create("div", "acc-etiquetas leaflet-zoom-hide", panel);
  const porGrupo = new Map<string, Array<{ def: DefEtiqueta; el: HTMLElement; w: number; h: number }>>();
  let pendiente = 0;

  function recolocar() {
    pendiente = 0;
    // The map was removed (the dashboard closed) after this frame was asked for.
    if (!capa.isConnected) return;
    porGrupo.forEach((etiquetas) => {
      // Measured while the map was hidden: measure again now that it shows.
      for (const e of etiquetas) if (!e.w) { e.el.style.display = ""; e.w = e.el.offsetWidth; e.h = e.el.offsetHeight; }
    });
    const tam = map.getSize();
    const vista: Caja = { x: 0, y: 0, w: tam.x, h: tam.y };
    const raiz = map.getContainer();
    const caja0 = raiz.getBoundingClientRect();
    const ocupado: Caja[] = [];
    (raiz.parentElement ?? raiz).querySelectorAll<HTMLElement>(obstaculos).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) ocupado.push({ x: r.left - caja0.left, y: r.top - caja0.top, w: r.width, h: r.height });
    });

    const candidatos: CandidatoEtiqueta[] = [];
    const angulos = new Map<string, number[]>();
    for (const grupo of grupos) {
      for (const { def, w, h } of porGrupo.get(grupo) ?? []) {
        if (def.tipo === "punto") {
          const p = map.latLngToContainerPoint(def.latlng);
          candidatos.push({ id: def.id, posiciones: posicionesAlrededor(p.x, p.y, w, h, def.radio, def.distancia) });
        } else if (def.tipo === "linea") {
          const pts = def.linea.map((ll) => map.latLngToContainerPoint(ll));
          const lugares = FRACCIONES_LINEA.map((f) => puntoEnLinea(pts, f)).filter((x): x is NonNullable<typeof x> => !!x);
          angulos.set(def.id, lugares.map((l) => l.angulo));
          candidatos.push({ id: def.id, posiciones: lugares.map((l) => cajaGirada(l.x, l.y, w, h, l.angulo)) });
        } else if (!def.visible || def.visible(map)) {
          const p = map.latLngToContainerPoint(def.latlng);
          candidatos.push({ id: def.id, posiciones: [{ x: p.x - w / 2, y: p.y - h / 2, w, h }] });
        }
      }
    }
    const elegidas = colocarEtiquetas(candidatos, ocupado, vista);
    const posiciones = new Map(candidatos.map((c) => [c.id, c.posiciones]));
    const origen = map.containerPointToLayerPoint([0, 0]);
    porGrupo.forEach((etiquetas) => {
      for (const { def, el, w, h } of etiquetas) {
        const i = elegidas.get(def.id);
        if (i === undefined) { el.style.display = "none"; continue; }
        const caja = posiciones.get(def.id)![i];
        el.style.display = "";
        if (def.tipo === "linea") {
          // The box is the rotated label's bounds: the label itself is centred in it and turned.
          const cx = caja.x + caja.w / 2 + origen.x, cy = caja.y + caja.h / 2 + origen.y;
          el.style.transform = `translate(${cx - w / 2}px,${cy - h / 2}px) rotate(${angulos.get(def.id)![i]}deg)`;
        } else {
          el.style.transform = `translate(${caja.x + origen.x}px,${caja.y + origen.y}px)`;
        }
      }
    });
  }

  const programar = () => { if (!pendiente) pendiente = requestAnimationFrame(recolocar); };
  map.on("zoomend moveend resize viewreset", programar);

  return {
    fijar(grupo, etiquetas) {
      for (const { el } of porGrupo.get(grupo) ?? []) el.remove();
      const creadas = etiquetas.map((def) => {
        const el = L.DomUtil.create("span", `acc-etq ${def.clase}`, capa);
        el.textContent = def.texto;
        return { def, el, w: 0, h: 0 };
      });
      // Measured once, unturned: the text does not change while the map moves.
      for (const e of creadas) { e.w = e.el.offsetWidth; e.h = e.el.offsetHeight; }
      porGrupo.set(grupo, creadas);
      programar();
    },
    recolocar: programar,
  };
}
