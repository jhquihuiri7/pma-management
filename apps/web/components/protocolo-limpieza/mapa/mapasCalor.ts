// Mapa de calor de residuos sobre cartografía real, con Leaflet y OpenStreetMap.
// Cada ruta pinta en su punto lo que entró a ella menos lo que ya pasó a la siguiente: el área y la
// intensidad crecen con su parte del total, así que cuando el material avanza un punto se apaga y el siguiente se enciende.
//
// Ported from lib/accumulation-map.js of the standalone app. The only changes are the asset paths
// (public/protocolo-limpieza/), the basemap constant (lib/basemaps.ts) and `islandMap`, which lets
// the view add the Geoportal's neighbourhoods under the heat.
import type * as LeafletNS from "leaflet";
import { extremosRuta, routes } from "@pma/types/protocolo-limpieza";
import { OPENFREEMAP_ATTRIBUTION, OPENFREEMAP_STYLES } from "@/lib/basemaps";
import {
  balanceGestion,
  destination,
  legs,
  points,
  seaRoute,
  type EstadoAcumulacion,
  type PuntoRuta,
  type Viaje,
  type ZonaPunto,
} from "@/lib/protocolo-limpieza/acumulacion";
import { unitSymbol } from "@/lib/protocolo-limpieza/tablero";
import { guiaIcono, iconosApartados } from "@/lib/protocolo-limpieza/acomodoIconos";
import { ANILLOS_PUNTO, lineaDeRuta, ubicacionesDePuntos, type DatosRutas } from "@/lib/protocolo-limpieza/rutasGeoportal";
import { dibujarRutas, type CapaRutas } from "./capaRutas";
import { crearCapaEtiquetas, type CapaEtiquetas } from "./etiquetas";
import { iniciarSeleccionArea } from "./seleccionArea";

type Leaflet = typeof LeafletNS;
type LatLng = [number, number];

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });
const qty = (v: number, unit: string) => `${fmt.format(v)} ${unitSymbol(unit)}`;
const pct = (v: number) => `${fmt.format(Math.round(v * 1000) / 10)} %`;
const share = (v: number, state: EstadoAcumulacion) => (state.total > 0 ? v / state.total : 0);
const scenePath = (scene: string, animated: boolean) => `/protocolo-limpieza/mapa/${scene}${animated ? "-animado" : ""}.svg`;

// Grupos que se muestran juntos cuando el mapa está alejado.
const zones: Record<ZonaPunto, { name: string; label: "right" | "left" }> = {
  sc: { name: "Santa Cruz", label: "right" },
  gye: { name: "Guayaquil", label: "left" },
};
const DETAIL_ZOOM = 8.5;

// Paletas del calor, de transparente (poco) a intenso (mucho):
// - rojo: residuos acumulados (Santa Cruz; y en el tramo a Guayaquil, lo que falta sacar);
// - verde: lo gestionado en Guayaquil.
export type Tono = "rojo" | "verde";
const PALETAS: Record<Tono, ReadonlyArray<readonly [number, string]>> = {
  rojo: [[0, "rgba(254,202,202,0)"], [0.3, "#fca5a5"], [0.65, "#ef4444"], [1, "#b91c1c"]],
  verde: [[0, "rgba(187,247,208,0)"], [0.3, "#86efac"], [0.65, "#22c55e"], [1, "#15803d"]],
};
/** The legend's CSS gradient of a palette. */
export const gradienteCalor = (tono: Tono) =>
  `linear-gradient(90deg,${PALETAS[tono].map(([o, c]) => `${c} ${o * 100}%`).join(",")})`;
const paletas = new Map<Tono, Uint8ClampedArray>();
function palette(tono: Tono): Uint8ClampedArray {
  const guardada = paletas.get(tono);
  if (guardada) return guardada;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1;
  const ctx = c.getContext("2d")!, g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const [o, color] of PALETAS[tono]) g.addColorStop(o, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 1);
  const datos = ctx.getImageData(0, 0, 256, 1).data;
  paletas.set(tono, datos);
  return datos;
}

// Tamaño de la mancha en el terreno: radio en metros para el 100 % del total (el área crece con
// la parte del total). Es menor que la distancia entre puntos, así que al acercar se separan.
// Con la isla completa se usa un mínimo en pantalla para que el color asome alrededor del ícono
// del punto (44 px), y al acercar mucho un máximo para no tapar el mapa.
const HEAT_METERS = 1500, HEAT_MIN_PX = 14, HEAT_MIN_PX_SHARE = 16, HEAT_MAX_PX = 110;
// Con el mapa muy alejado se pinta una mancha por zona (18 km para el 100 %),
// para que quede sobre Santa Cruz y no cubra el resto de Galápagos.
const ZONE_METERS = 18000, ZONE_MIN_PX = 6, ZONE_MIN_PX_SHARE = 4;
// Bajo este zoom los íconos de los puntos se achican para que se vea el color de la mancha.
const NEAR_ZOOM = 12;
const metersPerPixel = (lat: number, zoom: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8);

interface PuntoCalor { latlng: LatLng; share: number; tono: Tono }
interface PuntosCalor { detail: PuntoCalor[]; zones: PuntoCalor[] }
interface CapaCalor extends LeafletNS.Layer { setPoints(pts: PuntosCalor): void }
// The management spots of the sea map are sized on screen: at the scale of the Pacific a spot
// sized in metres would stay a few pixels wide and its growth would not show.
const PANTALLA_MIN_PX = 5, PANTALLA_MAX_PX = 16;

// Capa de calor: dibuja una mancha por punto (radio e intensidad según su parte del total),
// las suma y colorea la densidad resultante con la paleta de su tono (rojo o verde). Con el
// mapa muy alejado pinta una mancha por zona, igual que las etiquetas agrupadas.
function heatLayer(L: Leaflet): new (opciones?: { pantalla?: boolean }) => CapaCalor {
  type This = CapaCalor & {
    _map: LeafletNS.Map; _points: PuntosCalor; _canvas: HTMLCanvasElement; _buffer: HTMLCanvasElement; _pantalla: boolean; _draw(): void;
  };
  return (L.Layer as unknown as { extend(props: object): new (opciones?: { pantalla?: boolean }) => CapaCalor }).extend({
    initialize(this: This, opciones?: { pantalla?: boolean }) {
      this._points = { detail: [], zones: [] };
      this._pantalla = !!opciones?.pantalla;
    },
    setPoints(this: This, pts: PuntosCalor) { this._points = pts; if (this._map) this._draw(); },
    onAdd(this: This, map: LeafletNS.Map) {
      this._canvas = L.DomUtil.create("canvas", "acc-heat leaflet-zoom-hide", map.getPane("accHeat"));
      map.on("moveend zoomend resize viewreset", this._draw, this);
      this._draw();
      return this;
    },
    onRemove(this: This, map: LeafletNS.Map) {
      map.off("moveend zoomend resize viewreset", this._draw, this);
      this._canvas.remove();
      return this;
    },
    _draw(this: This) {
      const map = this._map, c = this._canvas, { x: w, y: h } = map.getSize();
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      const zoom = map.getZoom(), detail = zoom >= DETAIL_ZOOM;
      const pts = detail ? this._points.detail : this._points.zones;
      if (!w || !h || !pts.length) return;
      // Each tone is drawn apart (its spots add up only with each other), then laid on the map.
      const b = (this._buffer ??= document.createElement("canvas"));
      if (b.width !== w || b.height !== h) { b.width = w; b.height = h; }
      const bctx = b.getContext("2d", { willReadFrequently: true })!;
      for (const tono of Object.keys(PALETAS) as Tono[]) {
        const delTono = pts.filter((p) => p.tono === tono);
        if (!delTono.length) continue;
        bctx.clearRect(0, 0, w, h);
        for (const p of delTono) {
          const { x, y } = map.latLngToContainerPoint(p.latlng), f = Math.sqrt(p.share);
          const mpp = metersPerPixel(p.latlng[0], zoom);
          const r = this._pantalla
            ? PANTALLA_MIN_PX + (PANTALLA_MAX_PX - PANTALLA_MIN_PX) * f
            : detail
              ? Math.min(HEAT_MAX_PX, Math.max(HEAT_MIN_PX + HEAT_MIN_PX_SHARE * f, (HEAT_METERS * f) / mpp))
              : Math.min(HEAT_MAX_PX, Math.max(ZONE_MIN_PX + ZONE_MIN_PX_SHARE * f, (ZONE_METERS * f) / mpp));
          const a = 0.3 + 0.7 * f;
          const g = bctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.5, `rgba(0,0,0,${a * 0.85})`);
          g.addColorStop(0.8, `rgba(0,0,0,${a * 0.45})`); g.addColorStop(1, "rgba(0,0,0,0)");
          bctx.fillStyle = g; bctx.beginPath(); bctx.arc(x, y, r, 0, Math.PI * 2); bctx.fill();
        }
        const img = bctx.getImageData(0, 0, w, h), px = img.data, colors = palette(tono);
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (!a) continue;
          px[i] = colors[a * 4]; px[i + 1] = colors[a * 4 + 1]; px[i + 2] = colors[a * 4 + 2];
          px[i + 3] = Math.min(220, a * 1.5);
        }
        bctx.putImageData(img, 0, 0);
        ctx.drawImage(b, 0, 0);
      }
    },
  });
}

// Tramo terrestre como curva suave entre dos puntos [lat, lon].
function arc(a: LatLng, b: LatLng, bend = 0.14): LatLng[] {
  const [dy, dx] = [b[0] - a[0], b[1] - a[1]];
  const c: LatLng = [(a[0] + b[0]) / 2 + dx * bend, (a[1] + b[1]) / 2 - dy * bend];
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
}

// El trayecto marítimo del R4 y la posición a lo largo de él (f de 0 a 1): el esquemático de
// acumulacion.ts, o la línea del Geoportal cuando llega.
interface Recorrido { linea: LatLng[]; inicio: LatLng; fin: LatLng; en(f: number): LatLng }
function recorrido(linea: LatLng[]): Recorrido {
  const largos = linea.slice(1).map((p, i) => Math.hypot(p[0] - linea[i][0], p[1] - linea[i][1]));
  const total = largos.reduce((a, b) => a + b, 0);
  return {
    linea, inicio: linea[0], fin: linea[linea.length - 1],
    en(f) {
      let d = f * total;
      for (let i = 0; i < largos.length; i++) {
        if (d <= largos[i] || i === largos.length - 1) {
          const t = largos[i] ? Math.min(1, d / largos[i]) : 0, [a, b] = [linea[i], linea[i + 1]];
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        d -= largos[i];
      }
      return linea[linea.length - 1];
    },
  };
}

// With the Geoportal's points on the map, an icon sits on its point while it has room. When it
// would touch another icon (acomodoIconos.ts) it slides this far aside (pixels: x right, y down)
// and a leader joins it to its point: zoomed out, the urban zone (R1), the temporary storage (R2)
// and the Santa Cruz container yard (R3), a few hundred metres apart, would pile up.
const DESPLAZAMIENTO: Record<string, readonly [number, number]> = {
  R1: [44, 30], R2: [-42, -40], "R2.1": [-46, 0], R3: [-48, 34], R4: [46, -6], R5: [-42, -36], R6: [42, 36],
};
// The figures then go on the outer side of their icon, away from the neighbouring ones.
const LADO_CIFRA: Partial<Record<string, PuntoRuta["label"]>> = { R1: "right", R3: "left" };

// With the Geoportal's routes each icon carries a leader, drawn only while the icon is aside: its
// place, length and angle are CSS variables of the marker (moverIcono), so they survive the icon's
// redraws and slide. A point the Geoportal does not have (R1's urban zone) gets a dot at its end.
interface OpcionesIcono { lado?: PuntoRuta["label"]; guiaConPunto: boolean }

function pointHtml(p: PuntoRuta, state: EstadoAcumulacion, motion: boolean, guia?: OpcionesIcono) {
  const v = state.stock[p.id], active = state.active.has(p.id);
  const scene = scenePath(p.scene, active && motion);
  const lado = guia?.lado ?? p.label;
  return `<div class="acc-pin is-${lado}${active ? " is-active" : ""}${v > 0 ? " has-stock" : ""}" style="--c:${p.color}">${guia ? `<span class="acc-pin-guia${guia.guiaConPunto ? " con-punto" : ""}"></span>` : ""}
<span class="acc-pin-disc" style="background-image:url(${scene})"></span>${active ? '<span class="acc-pin-live"></span>' : ""}
<span class="acc-pin-label"><b>${p.code ?? p.route}</b><span>${esc(qty(v, state.unit))}</span><small>${pct(share(v, state))}</small></span></div>`;
}
const pointTip = (p: PuntoRuta, state: EstadoAcumulacion) => {
  const q = (v: number) => esc(qty(v, state.unit));
  return `<strong>${p.route} · ${esc(p.name)}</strong><br>${esc(p.note)}<br>Entró ${q(state.moved[p.id])}${state.passed[p.id] ? ` · pasó ${q(state.passed[p.id])}` : ""} · <strong>queda ${q(state.stock[p.id])}</strong> (${pct(share(state.stock[p.id], state))} del total)${state.boxes[p.id] ? `<br>${state.boxes[p.id]} contenedor${state.boxes[p.id] === 1 ? "" : "es"}` : ""}${state.active.has(p.id) ? "<br><em>Movimiento registrado hoy</em>" : ""}`;
};

function zoneValue(zone: ZonaPunto, state: EstadoAcumulacion) {
  return points.filter((p) => p.zone === zone).reduce((s, p) => s + state.stock[p.id], 0);
}
function zoneCenter(zone: ZonaPunto, pos: (id: string) => LatLng): LatLng {
  const ps = points.filter((p) => p.zone === zone).map((p) => pos(p.id));
  return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
}
function clusterHtml(zone: ZonaPunto, state: EstadoAcumulacion) {
  const v = zoneValue(zone, state), active = points.some((p) => p.zone === zone && state.active.has(p.id));
  return `<div class="acc-zone is-${zones[zone].label}"><span class="acc-zone-dot"></span><div class="acc-cluster${active ? " is-active" : ""}"><strong>${zones[zone].name}</strong><b>${esc(qty(v, state.unit))}</b><small>${pct(share(v, state))}</small>${active ? '<span class="acc-pin-live"></span>' : ""}</div></div>`;
}

const shipSvg = `<svg viewBox="-26 -15 52 30" width="52" height="30" aria-hidden="true">
<path d="M-17 2H17L13 10Q12 11.5 10 11.5H-11Q-13 11.5-14 10Z" fill="#0a2c40"/><path d="M-15.4 7.5H15.5L13 10Q12 11.5 10 11.5H-11Q-13 11.5-14 10Z" fill="#ef4444"/>
<rect x="-8" y="-6" width="6" height="8" rx=".8" fill="#fbbf24"/><rect x="-1.5" y="-6" width="6" height="8" rx=".8" fill="#34d399"/><rect x="-4.8" y="-12" width="6" height="6" rx=".8" fill="#fb923c"/>
<rect x="8" y="-9" width="6" height="11" rx="1" fill="#fff"/><rect x="9" y="-7.5" width="4" height="2" rx=".5" fill="#1e3a8a"/>
<path d="M-24 12q4-3 8 0t8 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/></svg>`;
// Barco de un viaje del R4. Su carga ya está pintada en R4; el barco solo la muestra.
const shortDate = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const longDate = (d: string) => d.split("-").reverse().join("/");
const voyageStatus = (v: Viaje) =>
  v.status === "programado" ? `Programado · sale ${shortDate(v.salida)}`
    : v.status === "arribado" ? `Arribado · ${shortDate(v.llegada)}` : `Navegando · ${Math.round(v.progress * 100)} %`;
function voyageHtml(v: Viaje, unit: string) {
  return `<div class="acc-ship is-${v.status}">${v.status === "navegando" ? '<span class="acc-ship-wake"><i></i><i></i></span>' : ""}${shipSvg}<span class="acc-ship-tag"><span><b>${esc(v.buque)}</b> · ${esc(qty(v.amount, unit))}</span><small>${voyageStatus(v)}</small></span></div>`;
}
// R4 as the protocol writes it (Muelle de Itabaca → Puerto GYE).
const [ORIGEN_R4, DESTINO_R4] = extremosRuta("R4");
const voyageTip = (v: Viaje, unit: string) =>
  `<strong>${esc(v.buque)}</strong> · R4 ${ORIGEN_R4} → ${DESTINO_R4}<br>Salida: ${longDate(v.salida)}, 00:00 (hora de Galápagos)<br>Llegada estimada: ${longDate(v.llegada)}, 23:59 (hora de Guayaquil)<br>${v.status === "navegando" ? `Navegando · ${Math.round(v.progress * 100)} % del trayecto` : v.status === "programado" ? `Programado: espera en ${ORIGEN_R4}` : "Arribado: espera el traslado al patio (R5)"}<br>${v.containers} contenedor${v.containers === 1 ? "" : "es"} · ${esc(qty(v.amount, unit))}`;

// The Geoportal's light basemap ("Claro": OpenFreeMap positron, vector), drawn by MapLibre
// inside Leaflet like in the Geoportal and in Previene. It sits in Leaflet's tilePane, under
// the neighbourhoods, the heat and the points. MapasCalor.tsx registers `L.maplibreGL` first.
function fondoClaro(L: Leaflet): LeafletNS.Layer {
  return L.maplibreGL({
    style: OPENFREEMAP_STYLES.light,
    attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
  });
}

export interface MapasAcumulacion {
  update(next: EstadoAcumulacion): void;
  fit(name: "island" | "region"): void;
  /** The Santa Cruz map, for layers the view adds on top (the Geoportal's neighbourhoods). */
  islandMap: LeafletNS.Map;
  /** The Santa Cruz map's labels, for the neighbourhood names (capaBarrios.ts). */
  etiquetasIsla: CapaEtiquetas;
  /**
   * Draws the Geoportal's routes and points with their QGIS style in place of the schematic
   * ones, and moves every icon, heat spot and the R4 ship to the real places.
   */
  setRutas(datos: DatosRutas): void;
  /**
   * Shows or hides the heat on the Santa Cruz map. It lies over the neighbourhoods, and the
   * urban point (R1) sits in Puerto Ayora, so hiding it is how their cleaning colour is read.
   */
  mostrarCalor(visible: boolean): void;
  /** One zoom step on the Santa Cruz map: 1 in, −1 out. */
  acercar(sentido: 1 | -1): void;
  /** Zoom to an area of the Santa Cruz map drawn by the user (seleccionArea.ts). Returns its cancel. */
  seleccionarArea(alTerminar: () => void): () => void;
  /** Center and zoom of the Santa Cruz map, to come back to them. */
  vistaIsla(): VistaMapa;
  /**
   * After its card is expanded or collapsed: fits the Santa Cruz map to its new size and shows
   * `vista` again. Expanded, the wheel zooms and a finger drags (the page does not scroll then).
   */
  ajustarIsla(opciones: { expandido: boolean; vista?: VistaMapa }): void;
  destroy(): void;
}

export interface VistaMapa {
  centro: LatLng;
  zoom: number;
}

interface Vista {
  el: HTMLElement;
  bounds: LeafletNS.LatLngBounds;
  far?: boolean;
  map: LeafletNS.Map;
  heat: CapaCalor;
  heatKey?: string;
  legs: Array<{ route: string; line: LeafletNS.Polyline }>;
  rutas?: CapaRutas;
  etiquetas: CapaEtiquetas;
  /** The end of R6 as a dot; the Geoportal's point symbol replaces it. */
  destino?: LeafletNS.Marker;
  /** The user moved the map: new routes do not fit it again. */
  movido: boolean;
  detail: LeafletNS.LayerGroup;
  points: Array<{ p: PuntoRuta; marker: LeafletNS.Marker }>;
  clusters: LeafletNS.LayerGroup;
  zones: Array<{ zone: ZonaPunto; marker: LeafletNS.Marker }>;
  fitted: boolean;
  fit(): void;
}

/**
 * Crea los dos mapas del panel: detalle de Santa Cruz y tramo marítimo hasta Guayaquil.
 */
export function createAccumulationMaps(
  L: Leaflet,
  containers: { island: HTMLElement; region: HTMLElement },
  { motion = true }: { motion?: boolean } = {},
): MapasAcumulacion {
  const Heat = heatLayer(L);
  // `anchor` moves the icon off its point; tooltips then open from the icon's centre.
  const icon = (html: string, size: [number, number], className = "acc-marker", anchor: [number, number] = [size[0] / 2, size[1] / 2]) =>
    L.divIcon({ className, html, iconSize: size, iconAnchor: anchor, tooltipAnchor: [size[0] / 2 - anchor[0], size[1] / 2 - anchor[1]] });

  // Where each point is: acumulacion.ts's reference places until the Geoportal's points arrive.
  const posiciones = new Map<string, LatLng>([
    ...points.map((p) => [p.id, [p.lat, p.lon]] as [string, LatLng]),
    [destination.id, [destination.lat, destination.lon]],
  ]);
  const pos = (id: string): LatLng => posiciones.get(id)!;
  let mar = recorrido([...(seaRoute as LatLng[])]);
  let conRutas = false;
  /** Points the Geoportal has: their icon's leader ends at the point symbol. */
  const conAnillo = new Set<string>();
  let ultimo: EstadoAcumulacion | null = null;
  const boundsIsla = () => L.latLngBounds(points.filter((p) => p.zone === "sc").map((p) => pos(p.id))).pad(0.15);
  const boundsRegion = () =>
    L.latLngBounds([...mar.linea, ...points.filter((p) => p.zone === "gye").map((p) => pos(p.id)), ...(conRutas ? [pos(destination.id)] : [])]).pad(0.06);

  const setup = (el: HTMLElement, bounds: LeafletNS.LatLngBounds, far?: boolean, controlesPropios = false): Vista => {
    // The Santa Cruz map brings its own controls (MapasCalor.tsx): zoom, reset, area and expand.
    const map = L.map(el, { zoomSnap: 0.25, zoomDelta: 0.5, scrollWheelZoom: false, dragging: !L.Browser.mobile, minZoom: 3, maxZoom: 19, zoomControl: !controlesPropios });
    map.createPane("accHeat").style.zIndex = "350";
    fondoClaro(L).addTo(map);
    const view = { el, bounds, far, map } as Vista;
    view.heat = new Heat({ pantalla: !!far }).addTo(map) as CapaCalor;
    view.movido = false;
    map.on("dragstart", () => { view.movido = true; });
    view.etiquetas = crearCapaEtiquetas(L, map, {
      grupos: ["rutas", "barrios"],
      obstaculos: ".acc-pin-disc, .acc-pin-label, .acc-cluster, .acc-ship, .acc-anillo, .acc-end, .acc-controles",
    });
    view.legs = legs.map((l) => {
      const line = l.sea ? (seaRoute as LatLng[]) : arc(pos(l.from), pos(l.to), l.branch ? -0.16 : 0.14);
      return {
        route: l.route,
        line: L.polyline(line, { className: `acc-leg${l.sea ? " is-sea" : ""}${l.branch ? " is-branch" : ""}`, color: l.sea ? "#2563eb" : l.branch ? "#d97706" : "#0d9488", weight: 3.5, opacity: 1, smoothFactor: 1 })
          .bindTooltip(`<strong>${l.route}</strong> · ${esc(routes[l.route][0])}`, { sticky: true, className: "acc-tip" })
          .addTo(map),
      };
    });
    view.detail = L.layerGroup();
    view.points = points.map((p) => ({
      p,
      marker: L.marker(pos(p.id), { icon: icon("", [44, 44]), keyboard: false, riseOnHover: true })
        .bindTooltip("", { direction: "top", offset: [0, -22], className: "acc-tip" })
        .addTo(view.detail),
    }));
    view.destino = L.marker(pos(destination.id), { icon: icon('<span class="acc-end"></span>', [16, 16]), keyboard: false })
      .bindTooltip(`<strong>${esc(destination.name)}</strong><br>${esc(destination.note)}`, { direction: "top", offset: [0, -8], className: "acc-tip" })
      .addTo(view.detail);
    view.clusters = L.layerGroup();
    view.zones = (Object.keys(zones) as ZonaPunto[]).map((zone) => ({
      zone,
      marker: L.marker(zoneCenter(zone, pos), { icon: icon("", [0, 0]), keyboard: false }).addTo(view.clusters),
    }));
    const syncZoom = () => {
      const detail = map.getZoom() >= DETAIL_ZOOM;
      view.el.classList.toggle("is-far", map.getZoom() < NEAR_ZOOM);
      (detail ? view.detail : view.clusters).addTo(map);
      map.removeLayer(detail ? view.clusters : view.detail);
    };
    map.on("zoomend", syncZoom);
    // After syncZoom: the icons that now have room go back onto their points, the rest move aside.
    map.on("zoomend resize", () => acomodar(view));
    view.fitted = false;
    view.fit = () => {
      if (view.el.clientWidth && view.el.clientHeight) {
        // Beside their points, the Puerto Ayora icons and figures hang below the southernmost ones.
        const abajo = conRutas && !view.far ? 96 : 24;
        map.fitBounds(view.bounds, { paddingTopLeft: [24, 24], paddingBottomRight: [24, abajo] });
        view.fitted = true;
        syncZoom();
      }
    };
    map.setView(view.bounds.getCenter(), view.far ? 5 : 10);
    syncZoom();
    view.fit();
    return view;
  };

  const views: Record<"island" | "region", Vista> = {
    island: setup(containers.island, boundsIsla(), false, true),
    region: setup(containers.region, boundsRegion(), true),
  };

  // Ajusta el tamaño cuando el panel cambia o vuelve a mostrarse.
  const resize = new ResizeObserver(() => {
    for (const view of Object.values(views)) {
      // A map leaving the page (the dashboard closing) shrinks to nothing before destroy() runs.
      // Resizing it then makes the light basemap (maplibre-gl-leaflet) schedule a frame that runs
      // after the map is removed and throws reading `getZoom` of null.
      if (!view.el.isConnected || !view.el.clientWidth || !view.el.clientHeight) continue;
      view.map.invalidateSize({ pan: false });
      if (!view.fitted) view.fit();
    }
  });
  for (const view of Object.values(views)) resize.observe(view.el);

  const cache = new WeakMap<LeafletNS.Marker, string>();
  const setIcon = (marker: LeafletNS.Marker, html: string, size: [number, number], className?: string, anchor?: [number, number]) => {
    const key = html + "|" + (anchor ?? "");
    if (cache.get(marker) === key) return;
    cache.set(marker, key);
    marker.setIcon(icon(html, size, className, anchor));
  };

  // Barcos del R4 (mapa del tramo marítimo): uno por viaje, en su posición según la hora.
  // Si varios coinciden en el mismo lugar (por ejemplo, programados en Itabaca), se apilan.
  const fleet = L.layerGroup().addTo(views.region.map), ships = new Map<string, LeafletNS.Marker>();
  function updateShips(voyages: Viaje[], unit: string) {
    const seen = new Set<string>(), stacks = new Map<string, number>();
    for (const v of voyages) {
      const spot = v.status === "navegando" ? v.progress.toFixed(3) : v.status;
      const level = stacks.get(spot) ?? 0;
      stacks.set(spot, level + 1);
      const at: LatLng = v.status === "programado" ? mar.inicio : v.status === "arribado" ? mar.fin : mar.en(v.progress);
      let marker = ships.get(v.key);
      if (!marker) {
        marker = L.marker(at, { icon: icon("", [52, 30]), keyboard: false, zIndexOffset: 800 })
          .bindTooltip("", { direction: "top", offset: [0, -26], className: "acc-tip" })
          .addTo(fleet);
        ships.set(v.key, marker);
      }
      marker.setLatLng(at);
      setIcon(marker, voyageHtml(v, unit), [52, 30], "acc-marker acc-ship-marker", [26, 15 - level * 50]);
      marker.setTooltipContent(voyageTip(v, unit));
      seen.add(v.key);
    }
    ships.forEach((marker, key) => { if (!seen.has(key)) { fleet.removeLayer(marker); ships.delete(key); } });
  }

  function update(current: EstadoAcumulacion) {
    ultimo = current;
    // Santa Cruz: red where waste accumulates, as large as its share of the total.
    const acumulacion: PuntosCalor = {
      detail: points.filter((p) => current.stock[p.id] > 0).map((p) => ({ latlng: pos(p.id), share: share(current.stock[p.id], current), tono: "rojo" })),
      zones: (Object.keys(zones) as ZonaPunto[])
        .map((zone) => ({ latlng: zoneCenter(zone, pos), share: share(zoneValue(zone, current), current), tono: "rojo" as const }))
        .filter((p) => p.share > 0),
    };
    // Sea leg and Guayaquil: management. Red at Itabaca, the last point of Santa Cruz, shrinks as
    // waste leaves Galápagos; green in Guayaquil grows from nothing as it arrives (R5 and R6).
    const balance = balanceGestion(current);
    const manchas: PuntoCalor[] = [
      { latlng: pos("R4"), share: balance.partePorSacar, tono: "rojo" as const },
      { latlng: pos("R6"), share: balance.parteGestionada, tono: "verde" as const },
    ].filter((p) => p.share > 0);
    const gestion: PuntosCalor = { detail: manchas, zones: manchas };
    for (const view of Object.values(views)) {
      const heatPoints = view === views.region ? gestion : acumulacion;
      const heatKey = JSON.stringify(heatPoints);
      if (view.heatKey !== heatKey) { view.heat.setPoints(heatPoints); view.heatKey = heatKey; }
      const sailing = current.voyages.some((v) => v.status === "navegando");
      for (const { route, line } of view.legs) line.getElement()?.classList.toggle("is-active", current.activeLegs.has(route) || (route === "R4" && sailing));
      for (const { p, marker } of view.points) {
        const guia = conRutas ? { lado: LADO_CIFRA[p.id], guiaConPunto: !conAnillo.has(p.id) } : undefined;
        setIcon(marker, pointHtml(p, current, motion, guia), [44, 44]);
        marker.setTooltipContent(pointTip(p, current));
        marker.setZIndexOffset(current.active.has(p.id) ? 500 : current.stock[p.id] > 0 ? 200 : 0);
      }
      for (const { zone, marker } of view.zones) setIcon(marker, clusterHtml(zone, current), [0, 0]);
    }
    updateShips(current.voyages, current.unit);
    // The figures under the labels may have changed size.
    for (const view of Object.values(views)) {
      acomodar(view);
      view.etiquetas.recolocar();
    }
  }

  // Slides an icon `d` pixels off its point (or back onto it, with null), with its leader and tooltip.
  function moverIcono(marker: LeafletNS.Marker, d: readonly [number, number] | null, radio: number) {
    const el = marker.getElement();
    if (!el) return;
    const [dx, dy] = d ?? [0, 0];
    el.style.setProperty("--dx", `${dx}px`);
    el.style.setProperty("--dy", `${dy}px`);
    if (d) {
      const { largo, angulo } = guiaIcono(dx, dy, radio);
      el.style.setProperty("--guia-largo", `${largo.toFixed(1)}px`);
      el.style.setProperty("--guia-angulo", `${angulo.toFixed(1)}deg`);
      el.style.setProperty("--guia-opacidad", "0.8");
    } else {
      // The angle stays: the leader shrinks along it as the icon slides back.
      el.style.setProperty("--guia-largo", "0px");
      el.style.setProperty("--guia-opacidad", "0");
    }
    const tip = marker.getTooltip();
    if (tip) {
      tip.options.offset = L.point(dx, dy - 22);
      if (tip.isOpen()) tip.update();
    }
  }

  // Each icon on its point while it has room; those that would touch another one move aside.
  function acomodar(view: Vista) {
    if (!conRutas || !view.map.hasLayer(view.detail)) return;
    const enPantalla = view.points.map(({ p }) => {
      const { x, y } = view.map.latLngToContainerPoint(pos(p.id));
      return { id: p.id, x, y };
    });
    const apartados = iconosApartados(enPantalla);
    for (const { p, marker } of view.points) {
      const d = apartados.has(p.id) ? DESPLAZAMIENTO[p.id] ?? null : null;
      moverIcono(marker, d, conAnillo.has(p.id) ? ANILLOS_PUNTO.exterior / 2 : 0);
    }
    // The labels keep clear of the icons: placed again once the icons have slid (0.3 s).
    view.etiquetas.recolocar();
    window.setTimeout(() => view.etiquetas.recolocar(), 350);
  }

  function setRutas(datos: DatosRutas) {
    ubicacionesDePuntos(datos.puntos, [...points.map((p) => p.id), destination.id]).forEach((ll, id) => {
      posiciones.set(id, ll);
      conAnillo.add(id);
    });
    const r4 = lineaDeRuta(datos.tramos, "R4");
    if (r4) mar = recorrido(r4);
    conRutas = true;
    for (const view of Object.values(views)) {
      for (const { line } of view.legs) view.map.removeLayer(line);
      view.rutas?.quitar();
      view.rutas = dibujarRutas(L, view.map, datos);
      view.legs = view.rutas.lineas;
      view.etiquetas.fijar("rutas", view.rutas.etiquetas);
      for (const { p, marker } of view.points) marker.setLatLng(pos(p.id));
      for (const { zone, marker } of view.zones) marker.setLatLng(zoneCenter(zone, pos));
      if (view.destino) { view.detail.removeLayer(view.destino); view.destino = undefined; }
    }
    views.island.bounds = boundsIsla();
    views.region.bounds = boundsRegion();
    for (const view of Object.values(views)) if (!view.movido) view.fit();
    if (ultimo) update(ultimo);
  }

  return {
    update,
    fit(name) { views[name]?.fit(); },
    islandMap: views.island.map,
    etiquetasIsla: views.island.etiquetas,
    setRutas,
    mostrarCalor(visible) {
      const panel = views.island.map.getPane("accHeat");
      if (panel) panel.style.display = visible ? "" : "none";
    },
    acercar(sentido) {
      const map = views.island.map;
      views.island.movido = true;
      if (sentido > 0) map.zoomIn();
      else map.zoomOut();
    },
    seleccionarArea(alTerminar) {
      views.island.movido = true;
      return iniciarSeleccionArea(L, views.island.map, alTerminar);
    },
    vistaIsla() {
      const map = views.island.map, c = map.getCenter();
      return { centro: [c.lat, c.lng], zoom: map.getZoom() };
    },
    ajustarIsla({ expandido, vista }) {
      const map = views.island.map;
      map.invalidateSize({ pan: false });
      if (expandido) {
        map.scrollWheelZoom.enable();
        map.dragging.enable();
      } else {
        map.scrollWheelZoom.disable();
        if (L.Browser.mobile) map.dragging.disable();
      }
      if (vista) map.setView(vista.centro, vista.zoom, { animate: false });
    },
    destroy() {
      resize.disconnect();
      for (const view of Object.values(views)) {
        // Leaflet 1.9 ends a zoom animation on a 250 ms timer that remove() does not cancel; on a
        // removed map it throws reading `_leaflet_pos` (leaving the dashboard while the map still
        // zooms). Clearing the flag first turns that pending timer into a no-op.
        (view.map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
        view.map.remove();
      }
    },
  };
}
