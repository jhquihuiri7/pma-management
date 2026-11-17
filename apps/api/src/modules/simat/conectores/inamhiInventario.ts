// INAMHI station inventory — the PUBLIC part of the visor API. We can read the
// station list and each station's parameters with their last-data timestamp,
// but NOT the hourly series (see inamhiSeries.ts: 403 origin_not_allowed). So
// this connector stores the automatic Galápagos stations with the time of their
// last transmission per variable; the values themselves stay null until INAMHI
// authorizes the series endpoint.

import type { SimatUltimoDato, SimatVariable } from "@pma/types";
import { FuenteError, obtenerJson } from "../red.js";
import { islaDeCoordenada } from "../geografia.js";
import { guardarEstaciones } from "../persistencia.js";

const BASE = "https://inamhi.gob.ec/api_visor";
const APP = "vs_1h_inh";

/** INAMHI parameter name → SIMAT variable. */
const VARIABLES: Record<string, SimatVariable> = {
  "PRECIPITACION": "precipitacion",
  "TEMPERATURA DEL AIRE": "temperatura",
  "HUMEDAD RELATIVA DEL AIRE": "humedad",
  "PRESION ATMOSFERICA": "presion",
  "VELOCIDAD DEL VIENTO": "viento_vel",
  "DIRECCION DEL VIENTO": "viento_dir",
  "RADIACION SOLAR GLOBAL": "radiacion",
};

interface EstacionInamhi {
  id_estacion: number;
  codigo: string;
  latitud: string;
  longitud: string;
  altitud: string;
  id_captor: number;
  captor: string;
  id_estado_transmision: number;
  estado_transmision: string;
  id_categoria: number;
  propietario: string;
  punto_obs: string;
}

interface ParametroInamhi {
  name_param: string;
  simbolo_unidad: string;
  params: Array<{ nemonico: string; fecha_ultimo_dato: string | null; simbolo_unidad: string }>;
}

function enGalapagos(lat: number, lon: number): boolean {
  return lon > -93 && lon < -88 && lat > -2 && lat < 2;
}

/**
 * INAMHI labels fecha_ultimo_dato with "-05:00", but the wall clock is UTC:
 * on 2026-11-17 at 15:56Z hourly stations reported "15:00:00-05:00", which
 * taken literally is 20:00Z, hours in the future. Read the offset as written,
 * and if that lands in the future, reinterpret the wall clock as UTC (so a
 * later fix on INAMHI's side keeps working).
 */
export function instanteInamhi(valor: string, ahora = Date.now()): number {
  const literal = Date.parse(valor);
  if (Number.isFinite(literal) && literal <= ahora + 30 * 60_000) return literal;
  const reloj = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(valor);
  return reloj ? Date.parse(`${reloj[1]}Z`) : NaN;
}

export async function sincronizarInamhiInventario(): Promise<{ registros: number; resumen: string }> {
  const todas = await obtenerJson<EstacionInamhi[]>(
    `${BASE}/station_information/estaciones/visores/?id_aplicacion=${APP}&_ts=${Date.now()}`,
    { timeoutMs: 40_000 }
  );
  if (!Array.isArray(todas)) throw new FuenteError("INAMHI no devolvió el inventario de estaciones.");

  // Automatic meteorological stations in Galápagos: the ones worth monitoring.
  const galapagos = todas.filter((e) => {
    const lat = Number(e.latitud);
    const lon = Number(e.longitud);
    return Number.isFinite(lat) && Number.isFinite(lon) && enGalapagos(lat, lon) && e.id_captor === 2 && e.id_categoria === 1;
  });

  let registros = 0;
  for (const e of galapagos) {
    const lat = Number(e.latitud);
    const lon = Number(e.longitud);
    const ultimoDato: SimatUltimoDato[] = [];
    const variables: SimatVariable[] = [];
    try {
      const params = await obtenerJson<ParametroInamhi[]>(
        `${BASE}/station_information/estaciones/parametros/?id_estacion=${e.id_estacion}&id_aplicacion=${APP}`,
        { timeoutMs: 30_000 }
      );
      for (const grupo of params ?? []) {
        const variable = VARIABLES[grupo.name_param?.trim().toUpperCase()];
        if (!variable) continue;
        const fechas = (grupo.params ?? [])
          .map((p) => (p.fecha_ultimo_dato ? instanteInamhi(p.fecha_ultimo_dato) : NaN))
          .filter((t) => Number.isFinite(t));
        if (!fechas.length) continue;
        variables.push(variable);
        ultimoDato.push({
          variable,
          instante: new Date(Math.max(...fechas)).toISOString(),
          valor: null, // series are blocked; only the timestamp is public
          unidad: grupo.simbolo_unidad ?? "",
        });
      }
    } catch {
      // Keep the station even if its parameters could not be read this run.
    }

    await guardarEstaciones([
      {
        id: `INAMHI-${e.id_estacion}`,
        fuente: "INAMHI",
        codigo: e.codigo,
        nombre: e.punto_obs,
        isla: islaDeCoordenada(lat, lon),
        lat,
        lon,
        altitud: Number.isFinite(Number(e.altitud)) ? Number(e.altitud) : null,
        pasoMin: 60,
        propietario: e.propietario ?? "",
        estado: e.estado_transmision ?? "",
        activa: e.id_estado_transmision === 1,
        variables,
        ultimoDato,
      },
    ]);
    registros += 1;
  }
  return { registros, resumen: `${registros} estaciones automáticas de INAMHI` };
}
