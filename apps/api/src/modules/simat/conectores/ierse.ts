// IERSE WSN (Universidad del Azuay) — open API, no origin restriction, for the
// "Red Galápagos" wireless sensor network. This is SIMAT's live rainfall
// source for Santa Cruz. Discovered from the public viewer at
// ierse.uazuay.edu.ec/proyectos/ierse-wsn (pub_query="1" = public query).
//
// Data belongs to a university research project: cite IERSE / U. del Azuay and
// confirm reuse terms. Timestamps are Galápagos local time (UTC−6).

import type { SimatUltimoDato, SimatVariable } from "@pma/types";
import { FuenteError, obtenerJson } from "../red.js";
import { fechaGalapagos, instanteGalapagos, islaDeCoordenada } from "../geografia.js";
import { guardarEstaciones, guardarObservaciones, type ObservacionRow } from "../persistencia.js";

const BASE = "https://ierse.uazuay.edu.ec/ierse-nodes";
const NETWORK = "ntw003_glps";
const PROPIETARIO = "IERSE · Universidad del Azuay";
const USO = "Datos abiertos del visor IERSE · citar IERSE/UAzuay";
const PASO_MIN = 5;

/**
 * IERSE sensor id → SIMAT variable, the unit we store and a factor from IERSE's
 * unit. RAIN is incremental mm per reading (verified: 0.4 then 0.8 mm, then
 * zeros), so windows add readings up. Pressure arrives in Pa and is stored in
 * hPa like METAR and INAMHI (100913 Pa at Militar ≈ 1010 hPa at SEST).
 */
const VARIABLES: Array<{ sensor: string; variable: SimatVariable; unidad: string; factor: number }> = [
  { sensor: "RAIN", variable: "precipitacion", unidad: "mm", factor: 1 },
  { sensor: "Temperature", variable: "temperatura", unidad: "°C", factor: 1 },
  { sensor: "Humidity", variable: "humedad", unidad: "%", factor: 1 },
  { sensor: "Pressure", variable: "presion", unidad: "hPa", factor: 0.01 },
  { sensor: "UVI", variable: "uv", unidad: "índice", factor: 1 },
];

interface NodoIerse {
  node_id: string;
  node_name: string;
  node_location: string;
  node_lat: number;
  node_long: number;
  node_status: string;
}

interface PuntoIerse {
  timestamp: string;
  sensor_value: number | null;
}

async function pedir<T>(ruta: string, cuerpo: Record<string, string>): Promise<T> {
  return obtenerJson<T>(`${BASE}${ruta}`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
    timeoutMs: 55_000,
  });
}

/** Operational and known nodes of the Galápagos network, deduped. */
export async function nodosGalapagos(fecha: string): Promise<NodoIerse[]> {
  const porId = new Map<string, NodoIerse>();
  for (const sensor of ["RAIN", "Temperature"]) {
    const nodos = await pedir<NodoIerse[]>("/nodes_var_date", {
      req_var: sensor,
      req_date: fecha,
      req_netw: NETWORK,
      pub_query: "1",
    }).catch(() => [] as NodoIerse[]);
    for (const n of nodos) if (n?.node_id) porId.set(n.node_id, n);
  }
  return [...porId.values()];
}

async function serieNodo(nodeId: string, sensor: string, fecha: string): Promise<PuntoIerse[]> {
  const data = await pedir<PuntoIerse[]>("/node_data", {
    req_var: sensor,
    req_date: fecha,
    req_node: nodeId,
    req_netw: NETWORK,
    pub_query: "1",
  }).catch(() => [] as PuntoIerse[]);
  return Array.isArray(data) ? data : [];
}

export async function sincronizarIerse(): Promise<{ registros: number; resumen: string }> {
  const ahora = new Date();
  const hoy = fechaGalapagos(ahora);
  const ayer = fechaGalapagos(ahora, -1);
  const nodos = await nodosGalapagos(hoy);
  if (!nodos.length) throw new FuenteError("IERSE no devolvió nodos para la red Galápagos.");

  let registros = 0;
  const observaciones: ObservacionRow[] = [];

  for (const nodo of nodos) {
    const lat = Number(nodo.node_lat);
    const lon = Number(nodo.node_long);
    const ultimoDato: SimatUltimoDato[] = [];
    const variablesPresentes: SimatVariable[] = [];

    for (const { sensor, variable, unidad, factor } of VARIABLES) {
      // Rainfall needs recent history (overnight + today) for the windows; the
      // rest only needs today for context and the latest value.
      const fechas = variable === "precipitacion" ? [ayer, hoy] : [hoy];
      const puntos: PuntoIerse[] = [];
      for (const fecha of fechas) puntos.push(...(await serieNodo(nodo.node_id, sensor, fecha)));

      const validos = puntos
        .filter((p) => p && p.sensor_value != null && Number.isFinite(Number(p.sensor_value)) && p.timestamp)
        .map((p) => ({
          instante: instanteGalapagos(p.timestamp),
          valor: Math.round(Number(p.sensor_value) * factor * 100) / 100,
        }))
        .filter((p) => !Number.isNaN(p.instante.getTime()));
      if (!validos.length) continue;

      variablesPresentes.push(variable);
      for (const p of validos) {
        observaciones.push({
          estacionId: `IERSE-${nodo.node_id}`,
          variable,
          instante: p.instante,
          valor: p.valor,
          calidad: "válido",
          fuente: PROPIETARIO,
          uso: USO,
        });
      }
      const ultimo = validos.reduce((a, b) => (b.instante >= a.instante ? b : a));
      ultimoDato.push({ variable, instante: ultimo.instante.toISOString(), valor: ultimo.valor, unidad });
    }

    await guardarEstaciones([
      {
        id: `IERSE-${nodo.node_id}`,
        fuente: "IERSE",
        codigo: nodo.node_id,
        nombre: nodo.node_name || nodo.node_id,
        isla: islaDeCoordenada(lat, lon),
        lat,
        lon,
        altitud: null,
        pasoMin: PASO_MIN,
        propietario: PROPIETARIO,
        estado: nodo.node_status || "",
        activa: (nodo.node_status || "").toLowerCase() === "operativo",
        variables: variablesPresentes,
        ultimoDato,
      },
    ]);
  }

  registros = await guardarObservaciones(observaciones);
  return {
    registros,
    resumen: `${nodos.length} estaciones · ${registros} observaciones nuevas`,
  };
}
