// Read side: stations, rolling rain series, gauge series and sea-level rows,
// mapped from the database rows to the shared types.

import { and, desc, eq, gte } from "drizzle-orm";
import type { SimatEstacion, SimatIsla, SimatMareografo, SimatNivelMar, SimatSerieLluvia, SimatVariable } from "@pma/types";
import { getDb } from "../../db/client.js";
import { simatEstaciones, simatNivelMar, simatObservaciones } from "../../db/schema/simat.js";
import { NotFound } from "../../lib/errors.js";
import { construirSerie, type LecturaLluvia } from "./ventanas.js";
import { GAUGES } from "./conectores/ioc.js";

type EstacionRow = typeof simatEstaciones.$inferSelect;

function aEstacion(row: EstacionRow): SimatEstacion {
  return {
    id: row.id,
    fuente: row.fuente as SimatEstacion["fuente"],
    codigo: row.codigo,
    nombre: row.nombre,
    isla: row.isla as SimatIsla,
    lat: row.lat,
    lon: row.lon,
    altitud: row.altitud,
    pasoMin: row.pasoMin,
    propietario: row.propietario,
    estado: row.estado,
    activa: row.activa,
    variables: row.variables,
    ultimoDato: row.ultimoDato,
    actualizadoEn: row.actualizadoEn.toISOString(),
  };
}

export async function listarEstaciones(): Promise<SimatEstacion[]> {
  const rows = await getDb().select().from(simatEstaciones).orderBy(desc(simatEstaciones.activa), simatEstaciones.nombre);
  return rows.map(aEstacion);
}

export async function obtenerEstacion(id: string): Promise<SimatEstacion | null> {
  const [row] = await getDb().select().from(simatEstaciones).where(eq(simatEstaciones.id, id)).limit(1);
  return row ? aEstacion(row) : null;
}

/** Rolling rainfall windows for a station, built from its stored observations. */
export async function serieLluvia(id: string): Promise<SimatSerieLluvia> {
  const [estacion] = await getDb().select().from(simatEstaciones).where(eq(simatEstaciones.id, id)).limit(1);
  if (!estacion) throw NotFound("Estación desconocida.");
  const rows = await getDb()
    .select({ instante: simatObservaciones.instante, valor: simatObservaciones.valor, calidad: simatObservaciones.calidad, fuente: simatObservaciones.fuente })
    .from(simatObservaciones)
    .where(and(eq(simatObservaciones.estacionId, id), eq(simatObservaciones.variable, "precipitacion")))
    .orderBy(desc(simatObservaciones.instante))
    .limit(5000);
  const lecturas: LecturaLluvia[] = rows.map((r) => ({
    instante: r.instante,
    valor: r.valor,
    calidad: r.calidad as LecturaLluvia["calidad"],
    fuente: r.fuente,
  }));
  return construirSerie(id, lecturas, estacion.pasoMin);
}

type NivelRow = typeof simatNivelMar.$inferSelect;

function aNivel(row: NivelRow): SimatNivelMar {
  return {
    id: row.id,
    puerto: row.puerto,
    tipo: row.tipo as SimatNivelMar["tipo"],
    instante: row.instante,
    horaPublicada: row.horaPublicada,
    valor: row.valor,
    unidad: row.unidad,
    referencia: row.referencia,
    fase: row.fase,
    calidad: row.calidad,
    fuente: row.fuente,
  };
}

/** Recent sea-level rows (observed + predictions), newest first. */
export async function listarNivelMar(puerto?: string): Promise<SimatNivelMar[]> {
  const where = puerto ? eq(simatNivelMar.puerto, puerto) : undefined;
  const rows = await getDb()
    .select()
    .from(simatNivelMar)
    .where(where)
    .orderBy(desc(simatNivelMar.createdAt))
    .limit(4000);
  return rows.map(aNivel);
}

const IOC = "https://www.ioc-sealevelmonitoring.org";

/** The gauge series (last 12 h) and latest level for a port, from the database. */
export async function mareografo(codigo: string): Promise<SimatMareografo> {
  const gauge = GAUGES[codigo];
  if (!gauge) throw NotFound("Mareógrafo no disponible.");
  const desde = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const rows = await getDb()
    .select({ instante: simatNivelMar.instante, valor: simatNivelMar.valor })
    .from(simatNivelMar)
    .where(and(eq(simatNivelMar.puerto, gauge.puerto), eq(simatNivelMar.tipo, "Nivel observado"), gte(simatNivelMar.instante, desde)))
    .orderBy(simatNivelMar.instante);
  if (!rows.length) throw NotFound("Sin lecturas recientes del mareógrafo.");
  const serie = rows.map((r) => ({ fecha: r.instante, valor: r.valor }));
  const ultimo = serie[serie.length - 1];
  return {
    codigo,
    puerto: gauge.puerto,
    estacion: gauge.estacion,
    valor: ultimo.valor,
    unidad: "m",
    fecha: ultimo.fecha,
    sensor: "RAS · radar en pozo tranquilizador",
    referencia: "Referencia instrumental sin datum publicado",
    calidad: "Dato preliminar sin control de calidad",
    fuente: "INOCAR · UNESCO/COI–VLIZ",
    enlace: `${IOC}/station.php?code=${codigo}`,
    serie,
  };
}
