// Open-Meteo rainfall forecast. Ported from lluvia_pronostico.py. Fetched on
// demand (not stored) with a short in-process cache. Modeled, not a station
// reading. Attribution: Open-Meteo, CC BY 4.0.

import type { SimatPronostico } from "@pma/types";
import { FuenteError, obtenerJson } from "../red.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { expira: number; valor: SimatPronostico }>();

function iso(segundos: number): string {
  return new Date(segundos * 1000).toISOString();
}

function cantidad(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

interface RespuestaOpenMeteo {
  current?: { time: number; interval?: number; precipitation?: number };
  hourly?: { time: number[]; precipitation: number[]; precipitation_probability: number[] };
}

export async function pronosticoLluvia(estacion: { id: string; lat: number; lon: number }): Promise<SimatPronostico> {
  const clave = `${estacion.lat.toFixed(3)},${estacion.lon.toFixed(3)}`;
  const guardado = cache.get(clave);
  if (guardado && guardado.expira > Date.now()) return { ...guardado.valor, estacion: estacion.id };

  const params = new URLSearchParams({
    latitude: String(estacion.lat),
    longitude: String(estacion.lon),
    current: "precipitation",
    hourly: "precipitation,precipitation_probability",
    forecast_hours: "25",
    // Las 24 h ya transcurridas del mismo modelo, para compararlas con la lluvia medida.
    past_hours: "24",
    timeformat: "unixtime",
    precipitation_unit: "mm",
    cell_selection: "land",
  });
  const data = await obtenerJson<RespuestaOpenMeteo>(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    timeoutMs: 12_000,
  });

  const ahora = Date.now() / 1000;
  const current = data.current;
  const currentMm = cantidad(current?.precipitation);
  const interval = current?.interval;
  let estimacion: SimatPronostico["estimacion"] = null;
  if (current && currentMm != null && typeof interval === "number" && interval > 0 && Math.abs(ahora - current.time) < 3600) {
    estimacion = {
      fin: iso(current.time),
      inicio: iso(current.time - interval),
      mm: currentMm,
      minutos: interval / 60,
      intensidad: (currentMm * 3600) / interval,
    };
  }

  const pronostico: SimatPronostico["pronostico"] = [];
  const pasado: SimatPronostico["pasado"] = [];
  const hourly = data.hourly;
  if (hourly) {
    for (let i = 0; i < hourly.time.length; i += 1) {
      const t = hourly.time[i];
      if (t <= ahora && t > ahora - 24 * 3600) {
        // Hora ya transcurrida: lo que el modelo da para ella.
        const prob = cantidad(hourly.precipitation_probability[i]);
        pasado.push({ inicio: iso(t - 3600), fin: iso(t), mm: cantidad(hourly.precipitation[i]), probabilidad: prob != null && prob <= 100 ? prob : null });
        continue;
      }
      if (ahora < t && t <= ahora + 24 * 3600) {
        const prob = cantidad(hourly.precipitation_probability[i]);
        pronostico.push({
          inicio: iso(t - 3600),
          fin: iso(t),
          mm: cantidad(hourly.precipitation[i]),
          probabilidad: prob != null && prob <= 100 ? prob : null,
        });
      }
    }
  }
  if (!estimacion && !pronostico.length) throw new FuenteError("No hay estimaciones vigentes para esta ubicación.");

  const valor: SimatPronostico = { estacion: estacion.id, consultado: new Date().toISOString(), estimacion, pronostico, pasado };
  cache.set(clave, { expira: Date.now() + CACHE_MS, valor });
  return valor;
}
