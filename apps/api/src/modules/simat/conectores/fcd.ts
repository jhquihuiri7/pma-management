// Fundación Charles Darwin climate CSV. Ported from integraciones.py (fcd_clima):
// daily precipitation for Puerto Ayora and Bellavista. Historical, not real time
// (Puerto Ayora reaches mid-2026, Bellavista 2019). Cite FCD.

import type { SimatIsla } from "@pma/types";
import { FuenteError, obtenerTexto } from "../red.js";
import { guardarEstaciones, guardarObservaciones, type ObservacionRow } from "../persistencia.js";

const FUENTE = "Fundación Charles Darwin";
const USO = "Descarga pública · citar FCD";
// The whole history is kept (Puerto Ayora since 1964, Bellavista 1987–2019):
// ~33k daily rows, inserted once; later runs only add the new days.

const ESTACIONES: Array<{ id: string; codigo: string; nombre: string; isla: SimatIsla; lat: number; lon: number; url: string }> = [
  {
    id: "FCD-PA",
    codigo: "FCD-PA",
    nombre: "Puerto Ayora (FCD)",
    isla: "Santa Cruz",
    lat: -0.743,
    lon: -90.305,
    url: "https://datazone.darwinfoundation.org/images/climate/climate_puerto-ayora.csv",
  },
  {
    id: "FCD-BV",
    codigo: "FCD-BV",
    nombre: "Bellavista (FCD)",
    isla: "Santa Cruz",
    lat: -0.693,
    lon: -90.323,
    url: "https://datazone.darwinfoundation.org/images/climate/climate_bellavista.csv",
  },
];

export interface FilaFcd {
  fecha: Date;
  mm: number;
}

/** Parse the FCD CSV into daily precipitation rows. */
export function parseCsvFcd(texto: string): FilaFcd[] {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const cabecera = lineas[0].split(",").map((c) => c.trim());
  const iFecha = cabecera.indexOf("observation_date");
  const iPrec = cabecera.indexOf("precipitation");
  if (iFecha < 0 || iPrec < 0) throw new FuenteError("Cambió el esquema del CSV climatológico de FCD.");
  const filas: FilaFcd[] = [];
  for (let i = 1; i < lineas.length; i += 1) {
    const cols = lineas[i].split(",");
    const bruto = (cols[iPrec] ?? "").trim();
    if (!bruto) continue;
    const mm = Number(bruto);
    const fecha = new Date(`${(cols[iFecha] ?? "").trim()}T00:00:00Z`);
    if (!Number.isFinite(mm) || mm < 0 || Number.isNaN(fecha.getTime())) continue;
    filas.push({ fecha, mm });
  }
  return filas;
}

export async function sincronizarFcd(): Promise<{ registros: number; resumen: string }> {
  const observaciones: ObservacionRow[] = [];
  let estacionesConDatos = 0;

  for (const est of ESTACIONES) {
    const texto = await obtenerTexto(est.url, { timeoutMs: 30_000 });
    const filas = parseCsvFcd(texto);
    if (!filas.length) continue;
    estacionesConDatos += 1;
    for (const f of filas) {
      observaciones.push({
        estacionId: est.id,
        variable: "precipitacion",
        instante: f.fecha,
        valor: f.mm,
        calidad: "válido",
        fuente: FUENTE,
        uso: USO,
      });
    }
    const ultima = filas.reduce((a, b) => (b.fecha >= a.fecha ? b : a));
    await guardarEstaciones([
      {
        id: est.id,
        fuente: "FCD",
        codigo: est.codigo,
        nombre: est.nombre,
        isla: est.isla,
        lat: est.lat,
        lon: est.lon,
        altitud: null,
        pasoMin: 1440,
        propietario: FUENTE,
        estado: "Serie histórica diaria",
        activa: false,
        variables: ["precipitacion"],
        ultimoDato: [{ variable: "precipitacion", instante: ultima.fecha.toISOString(), valor: ultima.mm, unidad: "mm" }],
      },
    ]);
  }
  if (!estacionesConDatos) throw new FuenteError("FCD no devolvió series climatológicas.");
  const registros = await guardarObservaciones(observaciones);
  return { registros, resumen: `${estacionesConDatos} estaciones FCD · ${registros} días nuevos` };
}
