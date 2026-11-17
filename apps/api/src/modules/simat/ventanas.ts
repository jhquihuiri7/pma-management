// Rolling rainfall accumulations. Adapted from the Flask app's series(): the
// original assumed readings aligned to exact step multiples (its data was
// simulated). Real sources (IERSE every ~5 min, not on the minute) are
// irregular, so here a window is the sum of the readings whose instant falls
// inside it — the correct way to accumulate rainfall regardless of alignment.
// A window is only reported when every reading inside it is valid, from a
// single source, and the window holds at least COBERTURA_MINIMA of the readings
// the station's cadence implies: with gaps, the rain that fell during them is
// unknown and the total would understate it. Otherwise it is null with a reason,
// as the original did (it required every expected reading).

import type { SimatCalidad, SimatMuestraLluvia, SimatSerieLluvia, SimatVentana } from "@pma/types";

/** Display windows (minutes): 5 min to 72 h. */
export const VENTANAS = [5, 15, 30, 60, 180, 360, 720, 1440, 2880, 4320] as const;

/**
 * Share of the expected readings a window needs. Below 1 because real cadences
 * drift (IERSE reports every ~4.7–5.3 min, so an hour holds 11–13 readings).
 */
export const COBERTURA_MINIMA = 0.9;

export interface LecturaLluvia {
  instante: Date;
  valor: number;
  calidad: SimatCalidad;
  fuente: string;
}

export function construirSerie(estacionId: string, lecturas: LecturaLluvia[], paso: number): SimatSerieLluvia {
  const orden = [...lecturas].sort((a, b) => b.instante.getTime() - a.instante.getTime());
  const latestRow = orden[0];
  const latest: SimatMuestraLluvia | null = latestRow
    ? {
        time: latestRow.instante.toISOString(),
        value: latestRow.valor,
        quality: latestRow.calidad,
        source: latestRow.fuente,
      }
    : null;

  const windows: SimatVentana[] = VENTANAS.map((minutes) => {
    if (minutes < paso) {
      return { minutes, total: null, intensity: null, valid: 0, expected: 0, reason: "Resolución insuficiente" };
    }
    const expected = Math.round(minutes / paso);
    if (!latestRow) {
      return { minutes, total: null, intensity: null, valid: 0, expected, reason: "Sin datos" };
    }
    const fin = latestRow.instante.getTime();
    const inicio = fin - minutes * 60_000;
    const dentro = orden.filter((r) => {
      const t = r.instante.getTime();
      return t > inicio && t <= fin;
    });
    const validas = dentro.filter((r) => r.calidad === "válido");
    const fuentes = new Set(validas.map((r) => r.fuente));
    const limpia = validas.length === dentro.length && fuentes.size <= 1;
    const cubierta = validas.length >= Math.ceil(expected * COBERTURA_MINIMA);
    if (!dentro.length || !limpia || !cubierta) {
      return {
        minutes,
        total: null,
        intensity: null,
        valid: validas.length,
        expected,
        reason: !limpia ? "Lecturas no válidas o mezcla de procedencias" : "Serie incompleta",
      };
    }
    const total = Math.round(validas.reduce((sum, r) => sum + r.valor, 0) * 100) / 100;
    return {
      minutes,
      total,
      intensity: Math.round((total * 60) / minutes * 100) / 100,
      valid: validas.length,
      expected,
      reason: "Completo",
    };
  });

  // Recent readings for the sparkline / chart, oldest first, capped.
  const limiteReciente = paso >= 1440 ? 30 : Math.max(1, Math.round((6 * 60) / paso));
  const recent: SimatMuestraLluvia[] = orden
    .slice(0, limiteReciente)
    .reverse()
    .map((r) => ({ time: r.instante.toISOString(), value: r.valor, quality: r.calidad, source: r.fuente }));

  return { estacion: estacionId, paso, windows, recent, latest };
}
