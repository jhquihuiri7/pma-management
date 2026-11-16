// Label placement for the module's maps, the way QGIS's engine does it: each
// label tries its candidate positions in order and takes the first one that is
// inside the view and touches nothing already on the map (icons, figures and
// labels placed before it); a label with no free position is not drawn.
// Pure geometry, so it is tested without a browser.

/** A box in screen pixels: top-left corner, width and height. */
export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CandidatoEtiqueta {
  id: string;
  /** Possible boxes, best first. */
  posiciones: readonly Caja[];
}

/** Space kept between a label and anything else. */
const MARGEN = 2;

export const seTocan = (a: Caja, b: Caja, margen = MARGEN) =>
  a.x < b.x + b.w + margen && b.x < a.x + a.w + margen && a.y < b.y + b.h + margen && b.y < a.y + a.h + margen;

const dentro = (a: Caja, vista: Caja) => a.x >= vista.x && a.y >= vista.y && a.x + a.w <= vista.x + vista.w && a.y + a.h <= vista.y + vista.h;

/**
 * Places the labels in the order given (the first ones win). Returns, for each
 * label drawn, the index of the position it took; a label left out is hidden.
 */
export function colocarEtiquetas(candidatos: readonly CandidatoEtiqueta[], obstaculos: readonly Caja[], vista: Caja): Map<string, number> {
  const ocupado: Caja[] = [...obstaculos];
  const elegidas = new Map<string, number>();
  for (const c of candidatos) {
    const i = c.posiciones.findIndex((p) => dentro(p, vista) && !ocupado.some((o) => seTocan(p, o)));
    if (i < 0) continue;
    elegidas.set(c.id, i);
    ocupado.push(c.posiciones[i]);
  }
  return elegidas;
}

/**
 * The positions QGIS tries around a point symbol of radius `radio`, at
 * `distancia` from its edge, in the order of the .qml (TR, TL, BR, BL, R, L).
 */
export function posicionesAlrededor(x: number, y: number, w: number, h: number, radio: number, distancia: number): Caja[] {
  const d = radio + distancia, k = d * Math.SQRT1_2;
  return [
    { x: x + k, y: y - k - h, w, h },
    { x: x - k - w, y: y - k - h, w, h },
    { x: x + k, y: y + k, w, h },
    { x: x - k - w, y: y + k, w, h },
    { x: x + d, y: y - h / 2, w, h },
    { x: x - d - w, y: y - h / 2, w, h },
  ];
}

/** Where a label sits along a line drawn on screen, and the angle that keeps it upright. */
export interface PuntoEnLinea {
  x: number;
  y: number;
  /** Degrees, from −90 to 90. */
  angulo: number;
}

/** The point at `fraccion` of the line's length (screen pixels), with the direction of its segment there. */
export function puntoEnLinea(puntos: ReadonlyArray<{ x: number; y: number }>, fraccion: number): PuntoEnLinea | null {
  if (puntos.length < 2) return null;
  const largos = puntos.slice(1).map((p, i) => Math.hypot(p.x - puntos[i].x, p.y - puntos[i].y));
  const total = largos.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let resto = Math.min(1, Math.max(0, fraccion)) * total;
  for (let i = 0; i < largos.length; i++) {
    if (resto <= largos[i] || i === largos.length - 1) {
      const t = largos[i] ? Math.min(1, resto / largos[i]) : 0;
      const [a, b] = [puntos[i], puntos[i + 1]];
      let angulo = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angulo > 90) angulo -= 180;
      if (angulo < -90) angulo += 180;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angulo };
    }
    resto -= largos[i];
  }
  return null;
}

/** The screen box a w × h label covers once rotated `angulo` degrees around its centre (x, y). */
export function cajaGirada(x: number, y: number, w: number, h: number, angulo: number): Caja {
  const r = (angulo * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const W = w * c + h * s, H = w * s + h * c;
  return { x: x - W / 2, y: y - H / 2, w: W, h: H };
}
