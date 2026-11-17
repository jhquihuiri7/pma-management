// Shared writes for the SIMAT connectors. Stations upsert (never deleted);
// observations and sea levels are inserted idempotently, so a re-sync of data
// already stored is a no-op.

import { getDb } from "../../db/client.js";
import { simatEstaciones, simatNivelMar, simatObservaciones } from "../../db/schema/simat.js";
import type { SimatIsla, SimatUltimoDato, SimatVariable } from "@pma/types";

export interface EstacionUpsert {
  id: string;
  fuente: string;
  codigo: string;
  nombre: string;
  isla: SimatIsla;
  lat: number;
  lon: number;
  altitud: number | null;
  pasoMin: number;
  propietario: string;
  estado: string;
  activa: boolean;
  variables: SimatVariable[];
  ultimoDato: SimatUltimoDato[];
}

export async function guardarEstaciones(rows: EstacionUpsert[]): Promise<void> {
  if (!rows.length) return;
  const db = getDb();
  for (const r of rows) {
    await db
      .insert(simatEstaciones)
      .values({
        id: r.id,
        fuente: r.fuente,
        codigo: r.codigo,
        nombre: r.nombre,
        isla: r.isla,
        lat: r.lat,
        lon: r.lon,
        altitud: r.altitud,
        pasoMin: r.pasoMin,
        propietario: r.propietario,
        estado: r.estado,
        activa: r.activa,
        variables: r.variables,
        ultimoDato: r.ultimoDato,
        actualizadoEn: new Date(),
      })
      .onConflictDoUpdate({
        target: simatEstaciones.id,
        set: {
          fuente: r.fuente,
          codigo: r.codigo,
          nombre: r.nombre,
          isla: r.isla,
          lat: r.lat,
          lon: r.lon,
          altitud: r.altitud,
          pasoMin: r.pasoMin,
          propietario: r.propietario,
          estado: r.estado,
          activa: r.activa,
          variables: r.variables,
          ultimoDato: r.ultimoDato,
          actualizadoEn: new Date(),
        },
      });
  }
}

export interface ObservacionRow {
  estacionId: string;
  variable: SimatVariable;
  instante: Date;
  valor: number;
  calidad: "válido" | "sospechoso" | "inválido";
  fuente: string;
  uso: string;
}

/** Inserts the new observations, skipping any already stored. Returns the count inserted. */
export async function guardarObservaciones(rows: ObservacionRow[]): Promise<number> {
  if (!rows.length) return 0;
  // Dedupe within the batch by (estacion, variable, instante).
  const vistos = new Set<string>();
  const unicos = rows.filter((r) => {
    if (!Number.isFinite(r.valor)) return false;
    const clave = `${r.estacionId}|${r.variable}|${r.instante.toISOString()}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
  if (!unicos.length) return 0;
  const db = getDb();
  let total = 0;
  // Insert in chunks to keep the statement size bounded.
  for (let i = 0; i < unicos.length; i += 500) {
    const chunk = unicos.slice(i, i + 500);
    const inserted = await db
      .insert(simatObservaciones)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ estacionId: simatObservaciones.estacionId });
    total += inserted.length;
  }
  return total;
}

export interface NivelMarRow {
  puerto: string;
  tipo: "Predicción astronómica" | "Nivel observado";
  instante: string;
  horaPublicada: boolean;
  valor: number;
  unidad: string;
  referencia: string;
  fase: string | null;
  calidad: string;
  fuente: string;
  registradoPor?: string | null;
  registradoPorNombre?: string | null;
}

export async function guardarNivelMar(rows: NivelMarRow[]): Promise<number> {
  if (!rows.length) return 0;
  const db = getDb();
  let total = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const inserted = await db
      .insert(simatNivelMar)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: simatNivelMar.id });
    total += inserted.length;
  }
  return total;
}
