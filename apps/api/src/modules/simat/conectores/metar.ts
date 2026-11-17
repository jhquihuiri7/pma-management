// METAR for SEST (San Cristóbal airport), via NOAA's public text files. The
// only public hourly observation in Galápagos today: temperature, wind and
// pressure (METAR carries no rainfall amount, so it does not feed the matrix).

import type { SimatVariable } from "@pma/types";
import { FuenteError, obtenerTexto } from "../red.js";
import { guardarEstaciones, guardarObservaciones, type ObservacionRow } from "../persistencia.js";

const FUENTE = "DAC · METAR (NOAA)";
const USO = "METAR público (NOAA)";

const ESTACION = {
  id: "METAR-SEST",
  codigo: "SEST",
  nombre: "Aeropuerto San Cristóbal (SEST)",
  isla: "San Cristóbal" as const,
  lat: -0.910206,
  lon: -89.617401,
};

export interface LecturaMetar {
  instante: Date;
  tempC: number | null;
  vientoDir: number | null;
  vientoKmh: number | null;
  presionHpa: number | null;
}

/** Parse one METAR observation line. */
export function parseMetar(metar: string, ahora: Date): LecturaMetar | null {
  const partes = metar.trim().split(/\s+/);
  const idx = partes.indexOf("SEST");
  if (idx < 0) return null;
  const campos = partes.slice(idx + 1);
  const dt = campos.find((c) => /^\d{6}Z$/.test(c));
  if (!dt) return null;
  const dia = Number(dt.slice(0, 2));
  const hh = Number(dt.slice(2, 4));
  const mm = Number(dt.slice(4, 6));
  let instante = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), dia, hh, mm));
  if (instante.getTime() > ahora.getTime() + 3_600_000) {
    instante = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, dia, hh, mm));
  }

  let vientoDir: number | null = null;
  let vientoKmh: number | null = null;
  const viento = campos.find((c) => /^(\d{3}|VRB)\d{2}(G\d{2})?KT$/.test(c));
  if (viento) {
    const dir = viento.slice(0, 3);
    vientoDir = dir === "VRB" ? null : Number(dir);
    vientoKmh = Math.round(Number(viento.slice(3, 5)) * 1.852 * 10) / 10;
  }

  let tempC: number | null = null;
  const temp = campos.find((c) => /^M?\d{2}\/M?\d{2}$/.test(c));
  if (temp) {
    const t = temp.split("/")[0];
    tempC = t.startsWith("M") ? -Number(t.slice(1)) : Number(t);
  }

  let presionHpa: number | null = null;
  const q = campos.find((c) => /^Q\d{4}$/.test(c));
  if (q) presionHpa = Number(q.slice(1));

  return { instante, tempC, vientoDir, vientoKmh, presionHpa };
}

export async function sincronizarMetar(): Promise<{ registros: number; resumen: string }> {
  const texto = await obtenerTexto("https://tgftp.nws.noaa.gov/data/observations/metar/stations/SEST.TXT", {
    timeoutMs: 20_000,
    accept: "text/plain",
  });
  const metar = texto.split(/\r?\n/).find((l) => l.includes("SEST"));
  if (!metar) throw new FuenteError("No se encontró el METAR de SEST.");
  const lectura = parseMetar(metar, new Date());
  if (!lectura) throw new FuenteError("No se pudo interpretar el METAR de SEST.");

  const porVariable: Array<{ variable: SimatVariable; valor: number | null; unidad: string }> = [
    { variable: "temperatura", valor: lectura.tempC, unidad: "°C" },
    { variable: "viento_vel", valor: lectura.vientoKmh, unidad: "km/h" },
    { variable: "viento_dir", valor: lectura.vientoDir, unidad: "°" },
    { variable: "presion", valor: lectura.presionHpa, unidad: "hPa" },
  ];

  const observaciones: ObservacionRow[] = [];
  const variables: SimatVariable[] = [];
  const ultimoDato = [];
  for (const { variable, valor, unidad } of porVariable) {
    if (valor == null) continue;
    variables.push(variable);
    observaciones.push({
      estacionId: ESTACION.id,
      variable,
      instante: lectura.instante,
      valor,
      calidad: "válido",
      fuente: FUENTE,
      uso: USO,
    });
    ultimoDato.push({ variable, instante: lectura.instante.toISOString(), valor, unidad });
  }

  await guardarEstaciones([
    {
      id: ESTACION.id,
      fuente: "METAR",
      codigo: ESTACION.codigo,
      nombre: ESTACION.nombre,
      isla: ESTACION.isla,
      lat: ESTACION.lat,
      lon: ESTACION.lon,
      altitud: null,
      pasoMin: 60,
      propietario: FUENTE,
      estado: "Observación horaria",
      activa: true,
      variables,
      ultimoDato,
    },
  ]);
  const registros = await guardarObservaciones(observaciones);
  return { registros, resumen: `METAR SEST · ${registros} observaciones nuevas` };
}
