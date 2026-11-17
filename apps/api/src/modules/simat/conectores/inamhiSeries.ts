// Series públicas del visor INAMHI, consultadas desde el servidor SIGTAR.
import { env } from "../../../lib/env.js";
import { FuenteError, obtenerJson } from "../red.js";
import { getDb } from "../../../db/client.js";
import { simatEstaciones } from "../../../db/schema/simat.js";
import { and, eq } from "drizzle-orm";
import { guardarObservaciones, type ObservacionRow } from "../persistencia.js";

const BASE = "https://inamhi.gob.ec/api_visor";
const NEMONICO_LLUVIA_HORARIA = "017140801h";
const PROPIETARIO = "INAMHI";

export function inamhiSeriesHabilitado(): boolean {
  return env.SIMAT_INAMHI_SERIES && (env.SIMAT_INAMHI_ORIGIN.length > 0 || env.SIMAT_INAMHI_TOKEN.length > 0);
}

/** Cabeceras que acepta el visor público. */
function cabecerasVisor(): Record<string, string> {
  const headers: Record<string, string> = { Referer: env.SIMAT_INAMHI_REFERER };
  if (env.SIMAT_INAMHI_ORIGIN) headers.Origin = env.SIMAT_INAMHI_ORIGIN;
  if (env.SIMAT_INAMHI_TOKEN) headers.Authorization = `Bearer ${env.SIMAT_INAMHI_TOKEN}`;
  return headers;
}

interface RespuestaSerie {
  series?: Array<{ code?: string; nemonico?: string; data?: Array<{ date?: string; fecha?: string; value?: number; valor?: number }> }>;
}

export async function sincronizarInamhiSeries(): Promise<{ registros: number; resumen: string }> {
  if (!inamhiSeriesHabilitado()) {
    throw new FuenteError("Conector INAMHI desactivado por configuración.");
  }
  // The INAMHI stations already in the inventory, transmitting.
  const estaciones = await getDb()
    .select({ id: simatEstaciones.id, codigo: simatEstaciones.codigo })
    .from(simatEstaciones)
    .where(and(eq(simatEstaciones.fuente, "INAMHI"), eq(simatEstaciones.activa, true)));

  if (!estaciones.length) throw new FuenteError("Sin estaciones INAMHI activas; sincronice primero el inventario.");
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 72 * 3600_000);
  const observaciones: ObservacionRow[] = [];
  let consultadas = 0;
  for (const est of estaciones) {
    const idInamhi = est.id.replace(/^INAMHI-/, "");
    const respuesta = await obtenerJson<RespuestaSerie>(`${BASE}/station_data_automaticas/get_data_hour/`, {
      method: "POST",
      body: JSON.stringify({ id_estacion: Number(idInamhi), table_names: [NEMONICO_LLUVIA_HORARIA], fecha_desde: new Date(desde.getTime() - 5 * 3600_000).toISOString().slice(0, 10), fecha_hasta: ahora.toISOString().slice(0, 10) }),
      headers: cabecerasVisor(),
      timeoutMs: 40_000,
    });
    observaciones.push(...parseSerieInamhi(respuesta, est.id, desde, ahora));
    consultadas += 1;
  }
  if (!observaciones.length) throw new FuenteError("INAMHI no devolvió lluvia horaria válida en las últimas 72 horas.");
  const registros = await guardarObservaciones(observaciones);
  return { registros, resumen: `${consultadas} estaciones INAMHI · ${registros} observaciones nuevas` };
}

export function parseSerieInamhi(respuesta: RespuestaSerie, estacionId: string, desde: Date, ahora: Date): ObservacionRow[] {
  const observaciones: ObservacionRow[] = [];
    if (!Array.isArray(respuesta?.series)) throw new FuenteError(`INAMHI ${estacionId}: formato de serie inesperado.`);
    for (const serie of respuesta.series) {
      if ((serie.code ?? serie.nemonico) !== NEMONICO_LLUVIA_HORARIA) continue;
      for (const punto of serie.data ?? []) {
        const fecha = punto.date ?? punto.fecha;
        const valor = punto.value ?? punto.valor;
        if (!fecha || !/(Z|[+-]\d{2}:\d{2})$/.test(fecha) || valor == null || typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) continue;
        const instante = new Date(fecha);
        if (Number.isNaN(instante.getTime()) || instante < desde || instante > ahora) continue;
        observaciones.push({
          estacionId,
          variable: "precipitacion",
          instante,
          valor: Number(valor),
          calidad: "válido",
          fuente: PROPIETARIO,
          uso: "INAMHI · observación horaria del visor público",
        });
      }
    }
  return observaciones;
}
