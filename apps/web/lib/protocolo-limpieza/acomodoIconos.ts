// Where the icons of the map points go (decision of 2026-11-15): each one sits on its
// point when it has room, and only those that would touch another icon move aside,
// joined to their point by a leader. Pure geometry, so it is tested without a browser.

/** Icons (44 px, drawn up to 52 px wide) closer than this, centre to centre, touch. */
export const DISTANCIA_ICONOS = 52;

/** The ids of the points whose icon would touch another one at these screen positions. */
export function iconosApartados(
  puntos: ReadonlyArray<{ id: string; x: number; y: number }>,
  distancia = DISTANCIA_ICONOS,
): Set<string> {
  const apartados = new Set<string>();
  for (let i = 0; i < puntos.length; i++) {
    for (let j = i + 1; j < puntos.length; j++) {
      if (Math.hypot(puntos[i].x - puntos[j].x, puntos[i].y - puntos[j].y) < distancia) {
        apartados.add(puntos[i].id);
        apartados.add(puntos[j].id);
      }
    }
  }
  return apartados;
}

/**
 * The leader of an icon moved (dx, dy) pixels from its point: its length, from the
 * icon's centre back to the edge of the point's symbol (radius `radio`), and its angle.
 */
export function guiaIcono(dx: number, dy: number, radio: number): { largo: number; angulo: number } {
  return {
    largo: Math.max(0, Math.hypot(dx, dy) - radio),
    angulo: (Math.atan2(-dy, -dx) * 180) / Math.PI,
  };
}
