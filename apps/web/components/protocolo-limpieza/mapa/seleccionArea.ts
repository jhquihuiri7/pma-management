import type * as LeafletNS from "leaflet";

// Zoom to an area: while the mode is on, dragging on the map draws a rectangle and
// releasing zooms the map to it. Leaflet's own box zoom needs Shift and a mouse;
// this one works from a button, with a mouse or a finger (pointer events).

/** A drag shorter than this (in pixels) on either side is a click, not an area. */
const MINIMO_PX = 8;

/**
 * Starts the selection on `map`. Returns a function that cancels it; `alTerminar`
 * runs once when the selection ends, zoomed or cancelled.
 */
export function iniciarSeleccionArea(L: typeof LeafletNS, map: LeafletNS.Map, alTerminar: () => void): () => void {
  const contenedor = map.getContainer();
  const arrastraba = map.dragging.enabled();
  map.dragging.disable();
  map.doubleClickZoom.disable();
  contenedor.classList.add("is-seleccionando");

  let inicio: LeafletNS.Point | null = null;
  let caja: HTMLDivElement | null = null;
  let terminado = false;
  const punto = (e: PointerEvent) => map.mouseEventToContainerPoint(e as unknown as MouseEvent);

  const dibujar = (a: LeafletNS.Point, b: LeafletNS.Point) => {
    if (!caja) return;
    caja.style.left = `${Math.min(a.x, b.x)}px`;
    caja.style.top = `${Math.min(a.y, b.y)}px`;
    caja.style.width = `${Math.abs(a.x - b.x)}px`;
    caja.style.height = `${Math.abs(a.y - b.y)}px`;
  };

  // Capture phase: the map's markers and Leaflet's own handlers never see the drag.
  const abajo = (e: PointerEvent) => {
    if (e.button !== 0 || inicio) return;
    e.preventDefault();
    e.stopPropagation();
    inicio = punto(e);
    caja = L.DomUtil.create("div", "acc-seleccion", contenedor) as HTMLDivElement;
    dibujar(inicio, inicio);
    contenedor.setPointerCapture?.(e.pointerId);
  };
  const mover = (e: PointerEvent) => {
    if (!inicio) return;
    e.preventDefault();
    e.stopPropagation();
    dibujar(inicio, punto(e));
  };
  const arriba = (e: PointerEvent) => {
    if (!inicio) return;
    e.preventDefault();
    e.stopPropagation();
    const desde = inicio, hasta = punto(e);
    terminar();
    if (Math.abs(hasta.x - desde.x) >= MINIMO_PX && Math.abs(hasta.y - desde.y) >= MINIMO_PX) {
      map.fitBounds(L.latLngBounds(map.containerPointToLatLng(desde), map.containerPointToLatLng(hasta)));
    }
  };
  // A click right after the drag would reach the markers below.
  const clic = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  contenedor.addEventListener("pointerdown", abajo, true);
  contenedor.addEventListener("pointermove", mover, true);
  contenedor.addEventListener("pointerup", arriba, true);
  contenedor.addEventListener("pointercancel", terminar, true);
  contenedor.addEventListener("click", clic, true);

  function terminar() {
    if (terminado) return;
    terminado = true;
    contenedor.removeEventListener("pointerdown", abajo, true);
    contenedor.removeEventListener("pointermove", mover, true);
    contenedor.removeEventListener("pointerup", arriba, true);
    contenedor.removeEventListener("pointercancel", terminar, true);
    // The click that follows the pointerup is swallowed, then markers get theirs again.
    setTimeout(() => contenedor.removeEventListener("click", clic, true), 0);
    caja?.remove();
    caja = null;
    inicio = null;
    contenedor.classList.remove("is-seleccionando");
    if (arrastraba) map.dragging.enable();
    map.doubleClickZoom.enable();
    alTerminar();
  }
  return terminar;
}
