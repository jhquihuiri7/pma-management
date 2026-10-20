import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  RiesgosCapacidadFila,
  RiesgosEstado,
  RiesgosFicha,
  RiesgosFichaResumen,
  RiesgosIsla,
  RiesgosRecibo,
  RiesgosRecurso,
  RiesgosRecursoTipo,
  RiesgosResumen,
} from "@pma/types";
import { getDb } from "../../db/client.js";
import { riesgosDelegaciones, riesgosFichas, riesgosRecursos } from "../../db/schema/riesgos.js";
import { Conflict, NotFound } from "../../lib/errors.js";
import { pgErrorCode, UNIQUE_VIOLATION } from "../pg2030/shared.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { ISLAS, TIPOS_RECURSO } from "./catalogos.js";
import { claveActivo, claveInstitucion, codigoRecibo, type FichaValidada, type FiltrosRecursos } from "./modelo.js";

function recibo(row: { id: string; createdAt: Date }): RiesgosRecibo {
  return { id: row.id, codigo: codigoRecibo(row.id), createdAt: row.createdAt.toISOString() };
}

/** The receipt of a ficha already stored under this id, if any. */
export async function reciboFicha(id: string): Promise<RiesgosRecibo | null> {
  const [row] = await getDb()
    .select({ id: riesgosFichas.id, createdAt: riesgosFichas.createdAt })
    .from(riesgosFichas)
    .where(eq(riesgosFichas.id, id))
    .limit(1);
  return row ? recibo(row) : null;
}

/**
 * Store a validated ficha and its resources. A second call with the same id
 * (a retry after a dropped connection) returns the first receipt untouched.
 */
export async function crearFicha(ficha: FichaValidada): Promise<{ recibo: RiesgosRecibo; creada: boolean }> {
  const institucionClave = claveInstitucion(ficha.institucionNombre);
  return getDb().transaction(async (tx) => {
    const [creada] = await tx
      .insert(riesgosFichas)
      .values({
        id: ficha.id,
        institucionClave,
        institucionNombre: ficha.institucionNombre,
        institucionTipo: ficha.institucionTipo,
        mesaGrupo: ficha.mesaGrupo,
        isla: ficha.isla,
        principalNombre: ficha.principal.nombre,
        principalCargo: ficha.principal.cargo,
        principalCorreo: ficha.principal.correo,
        principalTelefono: ficha.principal.telefono,
        alternoNombre: ficha.alterno.nombre,
        alternoCargo: ficha.alterno.cargo,
        alternoCorreo: ficha.alterno.correo,
        alternoTelefono: ficha.alterno.telefono,
        brechas: ficha.brechas,
        observaciones: ficha.observaciones,
      })
      .onConflictDoNothing({ target: riesgosFichas.id })
      .returning({ id: riesgosFichas.id, createdAt: riesgosFichas.createdAt });

    if (!creada) {
      const [existente] = await tx
        .select({ id: riesgosFichas.id, createdAt: riesgosFichas.createdAt })
        .from(riesgosFichas)
        .where(eq(riesgosFichas.id, ficha.id));
      return { recibo: recibo(existente), creada: false };
    }

    await tx.insert(riesgosRecursos).values(
      ficha.recursos.map((r, orden) => ({
        fichaId: ficha.id,
        orden,
        institucionClave,
        tipo: r.tipo,
        nombre: r.nombre,
        claveActivo: claveActivo(r),
        isla: r.isla,
        ubicacion: r.ubicacion,
        unidad: r.unidad,
        cantidadExistente: r.cantidadExistente,
        cantidadOperativa: r.cantidadOperativa,
        cantidadMovilizable: r.cantidadMovilizable,
        esTitular: r.esTitular,
        disponibilidad: r.disponibilidad,
        restricciones: r.restricciones,
        detalles: r.detalles,
      })),
    );
    return { recibo: recibo(creada), creada: true };
  });
}

type FichaRow = typeof riesgosFichas.$inferSelect;

function resumenFicha(row: FichaRow, recursos: number): RiesgosFichaResumen {
  return {
    id: row.id,
    codigo: codigoRecibo(row.id),
    institucionClave: row.institucionClave,
    institucionNombre: row.institucionNombre,
    institucionTipo: row.institucionTipo,
    mesaGrupo: row.mesaGrupo,
    isla: row.isla,
    estado: row.estado,
    recursos,
    createdAt: row.createdAt.toISOString(),
    revisadoAt: row.revisadoAt?.toISOString() ?? null,
  };
}

export async function listarFichas(filtros: { estado?: RiesgosEstado }): Promise<RiesgosFichaResumen[]> {
  const db = getDb();
  const recursosPorFicha = db
    .select({ fichaId: riesgosRecursos.fichaId, total: count().as("total") })
    .from(riesgosRecursos)
    .groupBy(riesgosRecursos.fichaId)
    .as("recursos_por_ficha");
  const rows = await db
    .select({ ficha: riesgosFichas, recursos: recursosPorFicha.total })
    .from(riesgosFichas)
    .leftJoin(recursosPorFicha, eq(recursosPorFicha.fichaId, riesgosFichas.id))
    .where(filtros.estado ? eq(riesgosFichas.estado, filtros.estado) : undefined)
    .orderBy(desc(riesgosFichas.createdAt));
  return rows.map((row) => resumenFicha(row.ficha, Number(row.recursos ?? 0)));
}

type RecursoRow = typeof riesgosRecursos.$inferSelect;

function recurso(row: RecursoRow, institucionNombre: string): RiesgosRecurso {
  return {
    id: row.id,
    fichaId: row.fichaId,
    institucionNombre,
    tipo: row.tipo,
    nombre: row.nombre,
    isla: row.isla,
    ubicacion: row.ubicacion,
    unidad: row.unidad,
    cantidadExistente: row.cantidadExistente,
    cantidadOperativa: row.cantidadOperativa,
    cantidadMovilizable: row.cantidadMovilizable,
    esTitular: row.esTitular,
    disponibilidad: row.disponibilidad,
    restricciones: row.restricciones,
    detalles: row.detalles,
    estado: row.estado,
    movilizableConsolidado: row.estado === "validado" && row.esTitular ? row.cantidadMovilizable : 0,
  };
}

export async function obtenerFicha(id: string): Promise<RiesgosFicha> {
  const db = getDb();
  const [row] = await db.select().from(riesgosFichas).where(eq(riesgosFichas.id, id)).limit(1);
  if (!row) throw NotFound("Ficha no encontrada");
  const recursos = await db
    .select()
    .from(riesgosRecursos)
    .where(eq(riesgosRecursos.fichaId, id))
    .orderBy(asc(riesgosRecursos.orden));
  return {
    ...resumenFicha(row, recursos.length),
    principal: { nombre: row.principalNombre, cargo: row.principalCargo, correo: row.principalCorreo, telefono: row.principalTelefono },
    alterno: { nombre: row.alternoNombre, cargo: row.alternoCargo, correo: row.alternoCorreo, telefono: row.alternoTelefono },
    brechas: row.brechas,
    observaciones: row.observaciones,
    notaRevision: row.notaRevision,
    revisadoPorNombre: row.revisadoPorNombre,
    detalleRecursos: recursos.map((r) => recurso(r, row.institucionNombre)),
  };
}

/** Owned resources of this ficha that another validated ficha of the institution already counts. */
async function recursosYaValidados(fichaId: string): Promise<string[]> {
  const otro = alias(riesgosRecursos, "otro");
  const rows = await getDb()
    .selectDistinct({ nombre: riesgosRecursos.nombre })
    .from(riesgosRecursos)
    .innerJoin(otro, and(
      eq(otro.institucionClave, riesgosRecursos.institucionClave),
      eq(otro.tipo, riesgosRecursos.tipo),
      eq(otro.claveActivo, riesgosRecursos.claveActivo),
      eq(otro.isla, riesgosRecursos.isla),
      eq(otro.estado, "validado"),
      eq(otro.esTitular, true),
      ne(otro.fichaId, riesgosRecursos.fichaId),
    ))
    .where(and(eq(riesgosRecursos.fichaId, fichaId), eq(riesgosRecursos.esTitular, true)));
  return rows.map((row) => row.nombre);
}

/**
 * Validate, exclude or reopen a ficha. Its resources take the same state in
 * the same transaction, so the matrix never counts half a review.
 */
export async function revisarFicha(
  id: string,
  input: { estado: RiesgosEstado; nota: string },
  userId: string,
): Promise<RiesgosFicha> {
  try {
    await getDb().transaction(async (tx) => {
      const actor = await lockAndAssertActor(tx, userId, "riesgos", ["ADMIN"]);
      const [ficha] = await tx
        .select({ id: riesgosFichas.id })
        .from(riesgosFichas)
        .where(eq(riesgosFichas.id, id))
        .for("update");
      if (!ficha) throw NotFound("Ficha no encontrada");
      await tx
        .update(riesgosFichas)
        .set({
          estado: input.estado,
          notaRevision: input.nota,
          revisadoPor: actor.id,
          revisadoPorNombre: actor.name,
          revisadoAt: new Date(),
        })
        .where(eq(riesgosFichas.id, id));
      await tx.update(riesgosRecursos).set({ estado: input.estado }).where(eq(riesgosRecursos.fichaId, id));
    });
  } catch (error) {
    if (pgErrorCode(error) !== UNIQUE_VIOLATION) throw error;
    const repetidos = await recursosYaValidados(id);
    throw Conflict(
      repetidos.length
        ? `Otra ficha validada de esta institución ya registra: ${repetidos.join(", ")}. Excluya esa ficha antes de validar esta.`
        : "Otra ficha validada de esta institución ya registra alguno de estos recursos. Excluya esa ficha antes de validar esta.",
    );
  }
  return obtenerFicha(id);
}

function escaparLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function condicionesRecursos(filtros: FiltrosRecursos): SQL | undefined {
  const condiciones: SQL[] = [];
  if (filtros.isla) condiciones.push(eq(riesgosRecursos.isla, filtros.isla));
  if (filtros.tipo) condiciones.push(eq(riesgosRecursos.tipo, filtros.tipo));
  if (filtros.estado) condiciones.push(eq(riesgosRecursos.estado, filtros.estado));
  if (filtros.institucion) condiciones.push(eq(riesgosRecursos.institucionClave, filtros.institucion));
  if (filtros.q) {
    const term = escaparLike(filtros.q);
    condiciones.push(or(ilike(riesgosRecursos.nombre, term), ilike(riesgosFichas.institucionNombre, term))!);
  }
  return condiciones.length ? and(...condiciones) : undefined;
}

export async function listarRecursos(filtros: FiltrosRecursos): Promise<RiesgosRecurso[]> {
  const rows = await getDb()
    .select({ recurso: riesgosRecursos, institucionNombre: riesgosFichas.institucionNombre })
    .from(riesgosRecursos)
    .innerJoin(riesgosFichas, eq(riesgosFichas.id, riesgosRecursos.fichaId))
    .where(condicionesRecursos(filtros))
    .orderBy(asc(riesgosRecursos.tipo), asc(riesgosRecursos.nombre), asc(riesgosFichas.institucionNombre));
  return rows.map((row) => recurso(row.recurso, row.institucionNombre));
}

/** Units typed by hand: "Personas " and "personas" are the same unit. */
const unidadNormalizada = sql<string>`lower(btrim(regexp_replace(${riesgosRecursos.unidad}, '\\s+', ' ', 'g')))`;

const contable = and(eq(riesgosRecursos.estado, "validado"), eq(riesgosRecursos.esTitular, true));

export async function resumen(): Promise<RiesgosResumen> {
  const db = getDb();
  const [[fichas], [validados], [delegaciones], capacidad, porTipo, porInstitucion] = await Promise.all([
    db.select({
      instituciones: sql<number>`count(distinct ${riesgosFichas.institucionClave})::int`,
      total: sql<number>`count(*)::int`,
      pendientes: sql<number>`count(*) filter (where ${riesgosFichas.estado} = 'pendiente')::int`,
      validadas: sql<number>`count(*) filter (where ${riesgosFichas.estado} = 'validado')::int`,
    }).from(riesgosFichas),
    db.select({ total: sql<number>`count(*)::int` }).from(riesgosRecursos).where(eq(riesgosRecursos.estado, "validado")),
    db.select({ total: sql<number>`count(*)::int` }).from(riesgosDelegaciones),
    db.select({
      tipo: riesgosRecursos.tipo,
      unidad: unidadNormalizada,
      isla: riesgosRecursos.isla,
      movilizable: sql<number>`sum(${riesgosRecursos.cantidadMovilizable})::int`,
      recursos: sql<number>`count(*)::int`,
    }).from(riesgosRecursos).where(contable).groupBy(riesgosRecursos.tipo, unidadNormalizada, riesgosRecursos.isla),
    db.select({ tipo: riesgosRecursos.tipo, recursos: sql<number>`count(*)::int` })
      .from(riesgosRecursos).where(contable).groupBy(riesgosRecursos.tipo),
    db.select({
      institucionNombre: sql<string>`max(${riesgosFichas.institucionNombre})`,
      recursos: sql<number>`count(*)::int`,
    }).from(riesgosRecursos)
      .innerJoin(riesgosFichas, eq(riesgosFichas.id, riesgosRecursos.fichaId))
      .where(contable)
      .groupBy(riesgosRecursos.institucionClave)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const filas = new Map<string, RiesgosCapacidadFila>();
  for (const row of capacidad) {
    const clave = `${row.tipo}|${row.unidad}`;
    let fila = filas.get(clave);
    if (!fila) {
      fila = {
        tipo: row.tipo,
        unidad: row.unidad,
        porIsla: Object.fromEntries(ISLAS.map((isla) => [isla, 0])) as Record<RiesgosIsla, number>,
        total: 0,
        recursos: 0,
      };
      filas.set(clave, fila);
    }
    fila.porIsla[row.isla] += Number(row.movilizable);
    fila.total += Number(row.movilizable);
    fila.recursos += Number(row.recursos);
  }
  const ordenTipo = (tipo: RiesgosRecursoTipo) => TIPOS_RECURSO.indexOf(tipo);
  const recursosPorTipo = new Map(porTipo.map((row) => [row.tipo, Number(row.recursos)]));

  return {
    instituciones: Number(fichas?.instituciones ?? 0),
    fichas: Number(fichas?.total ?? 0),
    fichasPendientes: Number(fichas?.pendientes ?? 0),
    fichasValidadas: Number(fichas?.validadas ?? 0),
    recursosValidados: Number(validados?.total ?? 0),
    delegaciones: Number(delegaciones?.total ?? 0),
    capacidad: [...filas.values()].sort((a, b) => ordenTipo(a.tipo) - ordenTipo(b.tipo) || a.unidad.localeCompare(b.unidad, "es")),
    porTipo: TIPOS_RECURSO.map((tipo) => ({ tipo, recursos: recursosPorTipo.get(tipo) ?? 0 })),
    porInstitucion: porInstitucion.map((row) => ({ institucionNombre: row.institucionNombre, recursos: Number(row.recursos) })),
  };
}
