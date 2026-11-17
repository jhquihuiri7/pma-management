import { desc, eq, sql } from "drizzle-orm";
import type { SimatCriterio, SimatCriterioEntrada, SimatIsla } from "@pma/types";
import { getDb } from "../../db/client.js";
import { simatCriterios } from "../../db/schema/simat.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { construirCriterio } from "./riesgo.js";
import { obtenerEstacion } from "./lecturas.js";

type CriterioRow = typeof simatCriterios.$inferSelect;

function aCriterio(row: CriterioRow): SimatCriterio {
  return {
    id: row.id,
    estacion: row.estacionId,
    isla: row.isla as SimatIsla,
    puerto: row.puerto,
    datum: row.datum,
    sector: row.sector,
    respaldo: row.respaldo,
    ventanaMin: row.ventanaMin,
    vigenciaMin: row.vigenciaMin,
    desfaseMin: row.desfaseMin,
    lluviaMmH: row.lluviaMmH,
    marM: row.marM,
    activo: row.activo,
    actualizadoPor: row.actualizadoPorNombre,
    actualizadoEn: row.actualizadoEn.toISOString(),
  };
}

export async function listarCriterios(): Promise<SimatCriterio[]> {
  const rows = await getDb().select().from(simatCriterios).orderBy(desc(simatCriterios.actualizadoEn));
  return rows.map(aCriterio);
}

export async function guardarCriterio(entrada: SimatCriterioEntrada, usuario: { id: string; name: string }): Promise<SimatCriterio> {
  const estacion = await obtenerEstacion(entrada.estacion);
  if (!estacion) throw NotFound("Seleccione una estación del inventario.");
  let validado;
  try {
    validado = construirCriterio(entrada, estacion);
  } catch (err) {
    throw BadRequest(err instanceof Error ? err.message : "Criterio inválido.");
  }
  const ahora = new Date();
  const [row] = await getDb()
    .insert(simatCriterios)
    .values({
      estacionId: validado.estacion,
      isla: validado.isla,
      puerto: validado.puerto,
      datum: validado.datum,
      sector: validado.sector,
      respaldo: validado.respaldo,
      ventanaMin: validado.ventanaMin,
      vigenciaMin: validado.vigenciaMin,
      desfaseMin: validado.desfaseMin,
      lluviaMmH: validado.lluviaMmH,
      marM: validado.marM,
      activo: validado.activo,
      actualizadoPor: usuario.id,
      actualizadoPorNombre: usuario.name,
      actualizadoEn: ahora,
    })
    .onConflictDoUpdate({
      target: [simatCriterios.estacionId, simatCriterios.puerto, simatCriterios.sector],
      set: {
        isla: validado.isla,
        datum: validado.datum,
        respaldo: validado.respaldo,
        ventanaMin: validado.ventanaMin,
        vigenciaMin: validado.vigenciaMin,
        desfaseMin: validado.desfaseMin,
        lluviaMmH: validado.lluviaMmH,
        marM: validado.marM,
        activo: validado.activo,
        version: sql`${simatCriterios.version} + 1`,
        actualizadoPor: usuario.id,
        actualizadoPorNombre: usuario.name,
        actualizadoEn: ahora,
      },
    })
    .returning();
  return aCriterio(row);
}
