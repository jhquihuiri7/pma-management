// Orchestrates the SIMAT connectors: runs them, records each attempt in
// simat_sincronizaciones, and exposes their health. The worker calls tick() on
// a timer; each connector runs at most once per its interval, one at a time.

import { sql } from "drizzle-orm";
import type { SimatConector, SimatConectorEstado } from "@pma/types";
import { getDb } from "../../db/client.js";
import { simatSincronizaciones } from "../../db/schema/simat.js";
import { sincronizarIerse } from "./conectores/ierse.js";
import { sincronizarIoc } from "./conectores/ioc.js";
import { sincronizarInocar } from "./conectores/inocar.js";
import { sincronizarInamhiInventario } from "./conectores/inamhiInventario.js";
import { inamhiSeriesHabilitado, sincronizarInamhiSeries } from "./conectores/inamhiSeries.js";
import { sincronizarFcd } from "./conectores/fcd.js";
import { sincronizarMetar } from "./conectores/metar.js";

interface Definicion {
  nombre: string;
  descripcion: string;
  intervaloMin: number;
  habilitado: () => boolean;
  ejecutar: () => Promise<{ registros: number; resumen: string }>;
}

export const CONECTORES: Record<SimatConector, Definicion> = {
  ierse: {
    nombre: "IERSE · Red Galápagos",
    descripcion: "Lluvia y clima en vivo de las estaciones de la U. del Azuay (Santa Cruz).",
    intervaloMin: 10,
    habilitado: () => true,
    ejecutar: sincronizarIerse,
  },
  ioc: {
    nombre: "Mareógrafos IOC/INOCAR",
    descripcion: "Nivel del mar observado (preliminar) en Santa Cruz y Baltra.",
    intervaloMin: 5,
    habilitado: () => true,
    ejecutar: sincronizarIoc,
  },
  inocar: {
    nombre: "INOCAR · Mareas",
    descripcion: "Predicciones astronómicas de pleamar y bajamar por puerto.",
    intervaloMin: 720,
    habilitado: () => true,
    ejecutar: sincronizarInocar,
  },
  "inamhi-inventario": {
    nombre: "INAMHI · Inventario",
    descripcion: "Estaciones automáticas de Galápagos y la hora de su última transmisión.",
    intervaloMin: 30,
    habilitado: () => true,
    ejecutar: sincronizarInamhiInventario,
  },
  "inamhi-series": {
    nombre: "INAMHI · Series horarias",
    descripcion: "Lluvia horaria de las estaciones INAMHI. Requiere autorización de INAMHI.",
    intervaloMin: 15,
    habilitado: inamhiSeriesHabilitado,
    ejecutar: sincronizarInamhiSeries,
  },
  fcd: {
    nombre: "Fundación Charles Darwin",
    descripcion: "Lluvia diaria histórica de Puerto Ayora y Bellavista.",
    intervaloMin: 1440,
    habilitado: () => true,
    ejecutar: sincronizarFcd,
  },
  metar: {
    nombre: "METAR · San Cristóbal",
    descripcion: "Observación horaria del aeropuerto SEST (temperatura, viento, presión).",
    intervaloMin: 30,
    habilitado: () => true,
    ejecutar: sincronizarMetar,
  },
};

export const CONECTORES_KEYS = Object.keys(CONECTORES) as SimatConector[];

async function registrarExito(conector: SimatConector, registros: number, resumen: string): Promise<void> {
  const ahora = new Date();
  await getDb()
    .insert(simatSincronizaciones)
    .values({ conector, ultimoIntento: ahora, ultimoExito: ahora, resultado: resumen, registros, error: null, fallosSeguidos: 0, avisoEnviado: false, actualizadoEn: ahora })
    .onConflictDoUpdate({
      target: simatSincronizaciones.conector,
      set: { ultimoIntento: ahora, ultimoExito: ahora, resultado: resumen, registros, error: null, fallosSeguidos: 0, avisoEnviado: false, actualizadoEn: ahora },
    });
}

async function registrarFallo(conector: SimatConector, error: string): Promise<void> {
  const ahora = new Date();
  await getDb()
    .insert(simatSincronizaciones)
    .values({ conector, ultimoIntento: ahora, resultado: `Error: ${error}`.slice(0, 320), error: error.slice(0, 320), fallosSeguidos: 1, actualizadoEn: ahora })
    .onConflictDoUpdate({
      target: simatSincronizaciones.conector,
      set: {
        ultimoIntento: ahora,
        resultado: `Error: ${error}`.slice(0, 320),
        error: error.slice(0, 320),
        fallosSeguidos: sql`${simatSincronizaciones.fallosSeguidos} + 1`,
        actualizadoEn: ahora,
      },
    });
}

/** Run one connector and record the outcome. Returns the result. */
export async function sincronizar(conector: SimatConector): Promise<{ ok: boolean; registros: number; mensaje: string }> {
  const def = CONECTORES[conector];
  if (!def) throw new Error(`Conector desconocido: ${conector}`);
  // A deliberately disabled connector (INAMHI series) is not a failure.
  if (!def.habilitado()) return { ok: false, registros: 0, mensaje: "Conector desactivado." };
  try {
    const { registros, resumen } = await def.ejecutar();
    await registrarExito(conector, registros, resumen);
    return { ok: true, registros, mensaje: resumen };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await registrarFallo(conector, mensaje);
    return { ok: false, registros: 0, mensaje };
  }
}

/** Run every enabled connector whose interval has elapsed. Called by the worker. */
export async function tickSincronizacion(): Promise<{ ejecutados: number; ok: number }> {
  const filas = await getDb().select().from(simatSincronizaciones);
  const porConector = new Map(filas.map((f) => [f.conector as SimatConector, f]));
  const ahora = Date.now();
  let ejecutados = 0;
  let ok = 0;
  for (const conector of CONECTORES_KEYS) {
    const def = CONECTORES[conector];
    if (!def.habilitado()) continue;
    const estado = porConector.get(conector);
    const ultimo = estado?.ultimoIntento ? estado.ultimoIntento.getTime() : null;
    const vencido = ultimo == null || ahora - ultimo >= def.intervaloMin * 60_000;
    if (!vencido) continue;
    ejecutados += 1;
    const r = await sincronizar(conector);
    if (r.ok) ok += 1;
  }
  return { ejecutados, ok };
}

export async function estadoConectores(): Promise<SimatConectorEstado[]> {
  const filas = await getDb().select().from(simatSincronizaciones);
  const porConector = new Map(filas.map((f) => [f.conector as SimatConector, f]));
  return CONECTORES_KEYS.map((conector) => {
    const def = CONECTORES[conector];
    const fila = porConector.get(conector);
    return {
      conector,
      nombre: def.nombre,
      descripcion: def.descripcion,
      ultimoIntento: fila?.ultimoIntento ? fila.ultimoIntento.toISOString() : null,
      ultimoExito: fila?.ultimoExito ? fila.ultimoExito.toISOString() : null,
      resultado: fila?.resultado ?? null,
      registros: fila?.registros ?? 0,
      error: fila?.error ?? null,
      fallosSeguidos: fila?.fallosSeguidos ?? 0,
      habilitado: def.habilitado(),
      intervaloMin: def.intervaloMin,
    };
  });
}
