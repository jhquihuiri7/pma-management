// INAMHI hourly series — DISABLED by default. The station_data_automaticas
// endpoints answer 403 "origin_not_allowed" to anyone but INAMHI's own viewer
// (verified 2026-11-17). We do NOT spoof the origin. This connector only runs
// when INAMHI has authorized this server and the operator sets:
//
//   SIMAT_INAMHI_SERIES=1
//   SIMAT_INAMHI_ORIGIN=https://sigtar.gobiernogalapagos.gob.ec   (the value INAMHI allow-lists)
//   and/or SIMAT_INAMHI_TOKEN=<credential INAMHI issues>
//
// Until then inamhiSeriesHabilitado() is false and the orchestrator skips it.
// When enabled, verify the response shape against the live endpoint before
// trusting the parser below. See docs/plan-integracion-simat.md §0.3 and the
// draft request in its Annex A.

import { env } from "../../../lib/env.js";
import { FuenteError, obtenerJson } from "../red.js";
import { getDb } from "../../../db/client.js";
import { simatEstaciones } from "../../../db/schema/simat.js";
import { eq } from "drizzle-orm";
import { guardarObservaciones, type ObservacionRow } from "../persistencia.js";

const BASE = "https://inamhi.gob.ec/api_visor";
const NEMONICO_LLUVIA_HORARIA = "017140801h";
const PROPIETARIO = "INAMHI";

export function inamhiSeriesHabilitado(): boolean {
  return env.SIMAT_INAMHI_SERIES && (env.SIMAT_INAMHI_ORIGIN.length > 0 || env.SIMAT_INAMHI_TOKEN.length > 0);
}

/** Only the authorized headers INAMHI issued; never a spoofed origin. */
function cabecerasAutorizadas(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (env.SIMAT_INAMHI_ORIGIN) headers.Origin = env.SIMAT_INAMHI_ORIGIN;
  if (env.SIMAT_INAMHI_TOKEN) headers.Authorization = `Bearer ${env.SIMAT_INAMHI_TOKEN}`;
  return headers;
}

interface RespuestaSerie {
  series?: Array<{ nemonico?: string; data?: Array<{ date?: string; fecha?: string; value?: number; valor?: number }> }>;
}

export async function sincronizarInamhiSeries(): Promise<{ registros: number; resumen: string }> {
  if (!inamhiSeriesHabilitado()) {
    throw new FuenteError("Conector desactivado: falta la autorización de INAMHI (SIMAT_INAMHI_*).");
  }
  // The INAMHI stations already in the inventory, transmitting.
  const estaciones = await getDb()
    .select({ id: simatEstaciones.id, codigo: simatEstaciones.codigo })
    .from(simatEstaciones)
    .where(eq(simatEstaciones.fuente, "INAMHI"));

  const observaciones: ObservacionRow[] = [];
  let consultadas = 0;
  for (const est of estaciones) {
    const idInamhi = est.id.replace(/^INAMHI-/, "");
    const respuesta = await obtenerJson<RespuestaSerie>(`${BASE}/station_data_automaticas/get_data_hour/`, {
      method: "POST",
      body: JSON.stringify({ id_estacion: Number(idInamhi), table_names: [NEMONICO_LLUVIA_HORARIA] }),
      headers: cabecerasAutorizadas(),
      timeoutMs: 40_000,
    }).catch(() => null);
    if (!respuesta?.series) continue;
    consultadas += 1;
    for (const serie of respuesta.series) {
      for (const punto of serie.data ?? []) {
        const fecha = punto.date ?? punto.fecha;
        const valor = punto.value ?? punto.valor;
        if (!fecha || valor == null || !Number.isFinite(Number(valor))) continue;
        const instante = new Date(fecha);
        if (Number.isNaN(instante.getTime())) continue;
        observaciones.push({
          estacionId: est.id,
          variable: "precipitacion",
          instante,
          valor: Number(valor),
          calidad: "válido",
          fuente: PROPIETARIO,
          uso: "INAMHI · acceso autorizado",
        });
      }
    }
  }
  const registros = await guardarObservaciones(observaciones);
  return { registros, resumen: `${consultadas} estaciones INAMHI · ${registros} observaciones nuevas` };
}
