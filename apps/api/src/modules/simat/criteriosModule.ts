import { desc, eq, sql } from "drizzle-orm";
import type { SimatCriterio, SimatCriterioEntrada, SimatEstadoValidacion, SimatIsla } from "@pma/types";
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
    lluvia: { vigilancia: row.lluviaVigilancia, preparacion: row.lluviaPreparacion, respuesta: row.lluviaRespuesta },
    marM: row.marM,
    estadoValidacion: row.estadoValidacion as SimatEstadoValidacion,
    alertasPublicas: row.alertasPublicas,
    activo: row.activo,
    actualizadoPor: row.actualizadoPorNombre,
    actualizadoEn: row.actualizadoEn.toISOString(),
  };
}

export async function listarCriterios(): Promise<SimatCriterio[]> {
  const rows = await getDb().select().from(simatCriterios).orderBy(desc(simatCriterios.actualizadoEn));
  return rows.map(aCriterio);
}

/**
 * Crea o actualiza un criterio. Con `id` se edita esa fila (también la de un
 * sector sin estación, que el índice único no distingue); sin `id`, la clave
 * estación · puerto · sector decide si es nuevo.
 */
export async function guardarCriterio(entrada: SimatCriterioEntrada, usuario: { id: string; name: string }): Promise<SimatCriterio> {
  const estacion = entrada.estacion ? await obtenerEstacion(entrada.estacion) : null;
  if (entrada.estacion && !estacion) throw NotFound("Seleccione una estación del inventario.");
  let validado;
  try {
    validado = construirCriterio(entrada, estacion);
  } catch (err) {
    throw BadRequest(err instanceof Error ? err.message : "Criterio inválido.");
  }
  const ahora = new Date();
  const valores = {
    estacionId: validado.estacion,
    isla: validado.isla,
    puerto: validado.puerto,
    datum: validado.datum,
    sector: validado.sector,
    respaldo: validado.respaldo,
    ventanaMin: validado.ventanaMin,
    vigenciaMin: validado.vigenciaMin,
    desfaseMin: validado.desfaseMin,
    lluviaVigilancia: validado.lluvia.vigilancia,
    lluviaPreparacion: validado.lluvia.preparacion,
    lluviaRespuesta: validado.lluvia.respuesta,
    marM: validado.marM,
    estadoValidacion: validado.estadoValidacion,
    alertasPublicas: validado.alertasPublicas,
    activo: validado.activo,
    actualizadoPor: usuario.id,
    actualizadoPorNombre: usuario.name,
    actualizadoEn: ahora,
  };

  if (entrada.id) {
    const [row] = await getDb()
      .update(simatCriterios)
      .set({ ...valores, version: sql`${simatCriterios.version} + 1` })
      .where(eq(simatCriterios.id, entrada.id))
      .returning();
    if (!row) throw NotFound("El criterio ya no existe.");
    return aCriterio(row);
  }

  const { estacionId: _estacion, puerto: _puerto, sector: _sector, ...cambios } = valores;
  void _estacion;
  void _puerto;
  void _sector;
  const [row] = await getDb()
    .insert(simatCriterios)
    .values(valores)
    .onConflictDoUpdate({
      target: [simatCriterios.estacionId, simatCriterios.puerto, simatCriterios.sector],
      set: { ...cambios, version: sql`${simatCriterios.version} + 1` },
    })
    .returning();
  return aCriterio(row);
}
