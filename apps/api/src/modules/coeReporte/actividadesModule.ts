import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { CoeActividad, CoeEvento } from "@pma/types";
import { getDb } from "../../db/client.js";
import { coeActividades, coeEventos } from "../../db/schema/coeReporte.js";
import { BadRequest, Conflict, NotFound } from "../../lib/errors.js";
import { encolarAviso } from "./avisosModule.js";
import {
  codigoEvento,
  normalizarTexto,
  type ActividadValidada,
  type Filtros,
  type ResultadoValidado,
} from "./modelo.js";

const MAX_FILAS = 5000;

type Fila = typeof coeActividades.$inferSelect;

function publica(fila: Fila): CoeActividad {
  return {
    id: fila.id,
    evento: fila.eventoId,
    dia: fila.dia,
    isla: fila.isla,
    sector: fila.sector,
    institucion: fila.institucion,
    instancia: fila.instancia,
    equipo: fila.equipo,
    descripcion: fila.descripcion,
    metas: fila.metas,
    estado: fila.estado,
    resultado: fila.resultado,
    motivo: fila.motivo,
    numeros: fila.numeros,
    creadoEn: fila.creadoEn.toISOString(),
    completadoEn: fila.completadoEn ? fila.completadoEn.toISOString() : null,
  };
}

// ---------------------------------------------------------------- eventos

export async function listarEventos(): Promise<CoeEvento[]> {
  return getDb()
    .select({ id: coeEventos.id, titulo: coeEventos.titulo })
    .from(coeEventos)
    .orderBy(desc(coeEventos.creadoEn), asc(coeEventos.id));
}

/** Creating an event that already exists returns it unchanged. */
export async function crearEvento(titulo: string): Promise<{ evento: CoeEvento; creado: boolean }> {
  const id = codigoEvento(titulo);
  const db = getDb();
  const [creado] = await db
    .insert(coeEventos)
    .values({ id, titulo })
    .onConflictDoNothing({ target: coeEventos.id })
    .returning({ id: coeEventos.id, titulo: coeEventos.titulo });
  if (creado) return { evento: creado, creado: true };
  const [existente] = await db
    .select({ id: coeEventos.id, titulo: coeEventos.titulo })
    .from(coeEventos)
    .where(eq(coeEventos.id, id));
  return { evento: existente, creado: false };
}

// ------------------------------------------------------------ actividades

/** The activities of one history code, newest day first. */
export async function listarMias(propietario: string): Promise<CoeActividad[]> {
  const filas = await getDb()
    .select()
    .from(coeActividades)
    .where(eq(coeActividades.propietario, propietario))
    .orderBy(desc(coeActividades.dia), desc(coeActividades.creadoEn))
    .limit(MAX_FILAS);
  return filas.map(publica);
}

/**
 * Store a programmed (or unprogrammed, with its result) activity and queue its
 * notice. A retry with the same id returns the stored activity untouched.
 */
export async function crearActividad(
  propietario: string,
  a: ActividadValidada,
): Promise<{ actividad: CoeActividad; creada: boolean }> {
  return getDb().transaction(async (tx) => {
    const [evento] = await tx
      .select({ titulo: coeEventos.titulo })
      .from(coeEventos)
      .where(eq(coeEventos.id, a.evento));
    if (!evento) throw BadRequest("Selecciona un evento válido.");

    const extra = a.estado === "extra";
    const [creada] = await tx
      .insert(coeActividades)
      .values({
        id: a.id,
        propietario,
        eventoId: a.evento,
        dia: a.dia,
        isla: a.isla,
        sector: a.sector,
        institucion: a.institucion,
        instancia: a.instancia,
        equipo: a.equipo,
        descripcion: a.descripcion,
        metas: a.metas,
        estado: a.estado,
        resultado: a.resultado,
        numeros: a.numeros,
        ...(extra ? { completadoEn: new Date() } : {}),
      })
      .onConflictDoNothing({ target: coeActividades.id })
      .returning();

    if (!creada) {
      const [existente] = await tx.select().from(coeActividades).where(eq(coeActividades.id, a.id));
      // An id taken by another history code is never revealed.
      if (!existente || existente.propietario !== propietario) throw Conflict("Identificador de actividad inválido.");
      return { actividad: publica(existente), creada: false };
    }

    const actividad = publica(creada);
    await encolarAviso(tx, actividad, extra ? "resultado" : "programacion", evento.titulo);
    return { actividad, creada: true };
  });
}

/**
 * Record the result of a pending activity, once. Resending the same `envio`
 * returns the stored result; a different one after the first gets 409.
 */
export async function registrarResultado(
  propietario: string,
  id: string,
  r: ResultadoValidado,
): Promise<{ actividad: CoeActividad; creada: boolean }> {
  return getDb().transaction(async (tx) => {
    const [actual] = await tx
      .select()
      .from(coeActividades)
      .where(and(eq(coeActividades.id, id), eq(coeActividades.propietario, propietario)))
      .for("update");
    if (!actual) throw NotFound("No se encontró esta actividad en tu historial.");
    if (actual.envioId === r.envio) return { actividad: publica(actual), creada: false };
    if (actual.estado !== "pending") throw Conflict("Esta actividad ya tiene un resultado registrado.");

    const [fila] = await tx
      .update(coeActividades)
      .set({
        estado: r.estado,
        resultado: r.resultado,
        motivo: r.motivo,
        numeros: r.numeros,
        envioId: r.envio,
        completadoEn: new Date(),
      })
      .where(eq(coeActividades.id, id))
      .returning();
    const [evento] = await tx
      .select({ titulo: coeEventos.titulo })
      .from(coeEventos)
      .where(eq(coeEventos.id, fila.eventoId));
    const actividad = publica(fila);
    await encolarAviso(tx, actividad, "resultado", evento?.titulo ?? fila.eventoId);
    return { actividad, creada: true };
  });
}

/** Every activity for the board. The board filters again on the client. */
export async function listarActividades(filtros: Filtros): Promise<CoeActividad[]> {
  const condiciones: SQL[] = [];
  if (filtros.dia) condiciones.push(eq(coeActividades.dia, filtros.dia));
  if (filtros.evento) condiciones.push(eq(coeActividades.eventoId, filtros.evento));
  if (filtros.isla) condiciones.push(eq(coeActividades.isla, filtros.isla));
  if (filtros.estado) condiciones.push(eq(coeActividades.estado, filtros.estado));
  const filas = await getDb()
    .select()
    .from(coeActividades)
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(coeActividades.dia), desc(coeActividades.creadoEn))
    .limit(MAX_FILAS);
  const institucion = filtros.institucion ? normalizarTexto(filtros.institucion) : null;
  return filas
    .filter((f) => !institucion || normalizarTexto(f.institucion) === institucion)
    .map(publica);
}
