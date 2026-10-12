import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pg2030Anios,
  pg2030Bitacora,
  pg2030Convocatorias,
  pg2030Instituciones,
  pg2030MetasInstitucionales,
  pg2030Reaperturas,
  pg2030SinAcciones,
} from "../../db/schema/pg2030.js";
import type {
  Pg2030Anio,
  Pg2030BitacoraAccion,
  Pg2030BitacoraEntrada,
  Pg2030EstadoInstitucionAnio,
  Pg2030InstitucionAnio,
  Pg2030InstitucionTipo,
  Pg2030Reapertura,
  Pg2030Trimestre,
} from "@pma/types";
import { BadRequest, Conflict, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import {
  corteCerrado,
  corteHabilitado,
  cortesVencidos,
  finDelDia,
  plazoEfectivo,
  type Trimestre,
} from "./cortes.js";
import {
  UNIQUE_VIOLATION,
  assertPuedeTrabajarCon,
  loadAnio,
  lockPg2030Writer,
  pgErrorCode,
  reaperturasHasta,
  toAnio,
  toAnioCortes,
} from "./shared.js";

/** Only tests pass `now`; production always uses the current instant. */
export type Clock = { now?: Date };

const fmtFecha = (fecha: string) => fecha.split("-").reverse().join("/");

export async function listAnios({ now = new Date() }: Clock = {}): Promise<Pg2030Anio[]> {
  const rows = await getDb().select().from(pg2030Anios).orderBy(desc(pg2030Anios.anio));
  return rows.map((row) => toAnio(row, now));
}

export type AbrirAnioInput = { anio: number; primerCorte: Trimestre; fechaLimiteCarga: string | null };

/**
 * Open a fiscal year (§7). If a habilitated cutoff already expired — 2026,
 * opened from T2 in October — the year needs an initial-load deadline in the
 * future; otherwise it must not have one. Every active institution is called.
 */
export async function abrirAnio(
  actorId: string,
  input: AbrirAnioInput,
  { now = new Date() }: Clock = {},
): Promise<Pg2030Anio> {
  const vencidos = cortesVencidos(input.anio, input.primerCorte, now);
  if (vencidos.length > 0) {
    if (!input.fechaLimiteCarga) {
      throw BadRequest(
        `El plazo de ${vencidos.map((t) => `T${t}`).join(" y ")} ya venció: fija una fecha límite de carga inicial`,
      );
    }
    if (now >= finDelDia(input.fechaLimiteCarga)) {
      throw BadRequest("La fecha límite de carga inicial debe ser futura");
    }
  } else if (input.fechaLimiteCarga) {
    throw BadRequest("Ningún corte habilitado está vencido: este año no tiene carga inicial");
  }

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const actor = await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
      const [row] = await tx
        .insert(pg2030Anios)
        .values({
          anio: input.anio,
          primerCorte: input.primerCorte,
          fechaLimiteCarga: input.fechaLimiteCarga,
          abiertoPor: actor.id,
          abiertoPorNombre: actor.name,
        })
        .returning();
      const activas = await tx
        .select({ id: pg2030Instituciones.id })
        .from(pg2030Instituciones)
        .where(eq(pg2030Instituciones.activa, true));
      if (activas.length > 0) {
        await tx.insert(pg2030Convocatorias).values(activas.map((i) => ({ anio: input.anio, institucionId: i.id })));
      }
      return toAnio(row, now);
    });
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) throw Conflict(`El año ${input.anio} ya está abierto`);
    throw error;
  }
}

/** Extend the initial load. Only while it has not expired, and only forward (§7). */
export async function ampliarCarga(
  actorId: string,
  anio: number,
  fechaLimiteCarga: string,
  { now = new Date() }: Clock = {},
): Promise<Pg2030Anio> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [current] = await tx.select().from(pg2030Anios).where(eq(pg2030Anios.anio, anio)).limit(1).for("update");
    if (!current) throw NotFound(`El año ${anio} no está abierto en PG2030`);
    if (!current.fechaLimiteCarga) throw BadRequest(`El año ${anio} no tiene carga inicial`);
    if (now >= finDelDia(current.fechaLimiteCarga)) {
      throw Conflict("La carga inicial ya venció: las correcciones se hacen con una reapertura");
    }
    if (fechaLimiteCarga <= current.fechaLimiteCarga) {
      throw BadRequest(`La nueva fecha debe ser posterior al ${fmtFecha(current.fechaLimiteCarga)}`);
    }
    const [row] = await tx
      .update(pg2030Anios)
      .set({ fechaLimiteCarga, updatedAt: new Date() })
      .where(eq(pg2030Anios.anio, anio))
      .returning();
    return toAnio(row, now);
  });
}

/** Every institution's standing in a year: called, with goals, declared "sin acciones" or silent. */
export async function listInstitucionesDelAnio(anio: number): Promise<Pg2030InstitucionAnio[]> {
  const db = getDb();
  await loadAnio(db, anio);
  const [instituciones, convocadas, declaraciones, metas] = await Promise.all([
    db.select().from(pg2030Instituciones).orderBy(asc(pg2030Instituciones.sigla)),
    db.select({ id: pg2030Convocatorias.institucionId }).from(pg2030Convocatorias).where(eq(pg2030Convocatorias.anio, anio)),
    db.select().from(pg2030SinAcciones).where(eq(pg2030SinAcciones.anio, anio)),
    db
      .select({ institucionId: pg2030MetasInstitucionales.institucionId, count: sql<number>`count(*)::int` })
      .from(pg2030MetasInstitucionales)
      .where(eq(pg2030MetasInstitucionales.anio, anio))
      .groupBy(pg2030MetasInstitucionales.institucionId),
  ]);
  const convocadaIds = new Set(convocadas.map((c) => c.id));
  const declaracionBy = new Map(declaraciones.map((d) => [d.institucionId, d]));
  const metasBy = new Map(metas.map((m) => [m.institucionId, m.count]));

  return instituciones.map((inst) => {
    const declaracion = declaracionBy.get(inst.id);
    const count = metasBy.get(inst.id) ?? 0;
    const convocada = convocadaIds.has(inst.id);
    const estado: Pg2030EstadoInstitucionAnio = count > 0
      ? "con_metas"
      : declaracion
        ? "sin_acciones"
        : convocada
          ? "sin_respuesta"
          : "no_convocada";
    return {
      institucion: {
        id: inst.id,
        nombre: inst.nombre,
        sigla: inst.sigla,
        tipo: inst.tipo as Pg2030InstitucionTipo,
        activa: inst.activa,
      },
      convocada,
      metas: count,
      sinAcciones: declaracion
        ? { declaradoPorNombre: declaracion.declaradoPorNombre, createdAt: declaracion.createdAt.toISOString() }
        : null,
      estado,
    };
  });
}

export async function setConvocatoria(
  actorId: string,
  anio: number,
  institucionId: string,
  convocada: boolean,
): Promise<{ ok: true; anio: number; institucionId: string; convocada: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    await loadAnio(tx, anio);
    const [inst] = await tx
      .select({ id: pg2030Instituciones.id })
      .from(pg2030Instituciones)
      .where(eq(pg2030Instituciones.id, institucionId))
      .limit(1)
      .for("key share");
    if (!inst) throw NotFound("Institución no encontrada");
    if (convocada) {
      await tx.insert(pg2030Convocatorias).values({ anio, institucionId }).onConflictDoNothing();
    } else {
      await tx
        .delete(pg2030Convocatorias)
        .where(and(eq(pg2030Convocatorias.anio, anio), eq(pg2030Convocatorias.institucionId, institucionId)));
    }
    return { ok: true as const, anio, institucionId, convocada };
  });
}

/**
 * Declare (or withdraw) "no actions linked to the Plan this year". The
 * institution's reporter or an administrator does it; it is exclusive with
 * having goals that year (§5).
 */
export async function setSinAcciones(
  actorId: string,
  anio: number,
  institucionId: string,
  declarada: boolean,
): Promise<{ ok: true; anio: number; institucionId: string; declarada: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    assertPuedeTrabajarCon(writer, institucionId);
    await loadAnio(tx, anio);
    // Serialize against goal creation for the same institution (same lock in
    // createMeta); NO KEY UPDATE leaves foreign-key checks unblocked.
    const [inst] = await tx
      .select({ id: pg2030Instituciones.id })
      .from(pg2030Instituciones)
      .where(eq(pg2030Instituciones.id, institucionId))
      .limit(1)
      .for("no key update");
    if (!inst) throw NotFound("Institución no encontrada");

    if (declarada) {
      const [metas] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pg2030MetasInstitucionales)
        .where(and(eq(pg2030MetasInstitucionales.anio, anio), eq(pg2030MetasInstitucionales.institucionId, institucionId)));
      if (metas && metas.count > 0) {
        throw Conflict(`La institución tiene ${metas.count} meta(s) en ${anio}: no puede declarar que no tiene acciones vinculadas`);
      }
      await tx
        .insert(pg2030SinAcciones)
        .values({ anio, institucionId, declaradoPor: writer.id, declaradoPorNombre: writer.name })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(pg2030SinAcciones)
        .where(and(eq(pg2030SinAcciones.anio, anio), eq(pg2030SinAcciones.institucionId, institucionId)));
    }
    return { ok: true as const, anio, institucionId, declarada };
  });
}

export async function listReaperturas(anio: number, { now = new Date() }: Clock = {}): Promise<Pg2030Reapertura[]> {
  const db = getDb();
  await loadAnio(db, anio);
  const rows = await db
    .select({
      r: pg2030Reaperturas,
      sigla: pg2030Instituciones.sigla,
      nombre: pg2030Instituciones.nombre,
    })
    .from(pg2030Reaperturas)
    .innerJoin(pg2030Instituciones, eq(pg2030Instituciones.id, pg2030Reaperturas.institucionId))
    .where(eq(pg2030Reaperturas.anio, anio))
    .orderBy(desc(pg2030Reaperturas.createdAt));
  return rows.map(({ r, sigla, nombre }) => ({
    id: r.id,
    anio: r.anio,
    trimestre: r.trimestre as Pg2030Trimestre,
    institucion: { id: r.institucionId, sigla, nombre },
    fechaLimite: r.fechaLimite,
    motivo: r.motivo,
    creadoPorNombre: r.creadoPorNombre,
    createdAt: r.createdAt.toISOString(),
    // Reopenings are only created on closed cutoffs, so one in force is one
    // whose own deadline has not passed.
    vigente: now < finDelDia(r.fechaLimite),
  }));
}

export type ReaperturaInput = { trimestre: Trimestre; institucionId: string; fechaLimite: string; motivo: string };

/** Reopen a closed cutoff for one institution, at its request, with a reason (§7). */
export async function crearReapertura(
  actorId: string,
  anio: number,
  input: ReaperturaInput,
  { now = new Date() }: Clock = {},
): Promise<{ ok: true; id: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const cfg = toAnioCortes(await loadAnio(tx, anio));
    if (!corteHabilitado(cfg, input.trimestre)) {
      throw BadRequest(`T${input.trimestre} no está habilitado en ${anio}; sus meses se reabren con T${cfg.primerCorte}`);
    }
    if (!corteCerrado(cfg, input.trimestre, now)) {
      throw Conflict(`T${input.trimestre} de ${anio} todavía está abierto`);
    }
    if (now >= finDelDia(input.fechaLimite)) throw BadRequest("La nueva fecha límite debe ser futura");
    const [inst] = await tx
      .select({ id: pg2030Instituciones.id })
      .from(pg2030Instituciones)
      .where(eq(pg2030Instituciones.id, input.institucionId))
      .limit(1)
      .for("key share");
    if (!inst) throw NotFound("Institución no encontrada");

    const previas = await reaperturasHasta(tx, anio, input.institucionId);
    const antes = plazoEfectivo(cfg, input.trimestre, previas.get(input.trimestre) ?? null);
    const [row] = await tx
      .insert(pg2030Reaperturas)
      .values({
        anio,
        trimestre: input.trimestre,
        institucionId: input.institucionId,
        fechaLimite: input.fechaLimite,
        motivo: input.motivo,
        creadoPor: actor.id,
        creadoPorNombre: actor.name,
      })
      .returning({ id: pg2030Reaperturas.id });
    await registrarBitacora(tx, {
      anio,
      trimestre: input.trimestre,
      institucionId: input.institucionId,
      metaId: null,
      accion: "reapertura",
      detalle: { fechaLimite: input.fechaLimite, motivo: input.motivo, plazoAnterior: antes },
      usuario: actor,
    });
    return { ok: true as const, id: row.id };
  });
}

export async function registrarBitacora(
  tx: any,
  entrada: {
    anio: number;
    trimestre: Trimestre;
    institucionId: string;
    metaId: string | null;
    accion: Pg2030BitacoraAccion;
    detalle: Record<string, unknown>;
    usuario: { id: string; name: string };
  },
): Promise<void> {
  await tx.insert(pg2030Bitacora).values({
    anio: entrada.anio,
    trimestre: entrada.trimestre,
    institucionId: entrada.institucionId,
    metaId: entrada.metaId,
    accion: entrada.accion,
    detalle: entrada.detalle,
    usuarioId: entrada.usuario.id,
    usuarioNombre: entrada.usuario.name,
  });
}

export async function listBitacora(anio: number, institucionId?: string): Promise<Pg2030BitacoraEntrada[]> {
  const db = getDb();
  const rows = await db
    .select({ b: pg2030Bitacora, sigla: pg2030Instituciones.sigla, nombre: pg2030Instituciones.nombre })
    .from(pg2030Bitacora)
    .innerJoin(pg2030Instituciones, eq(pg2030Instituciones.id, pg2030Bitacora.institucionId))
    .where(
      institucionId
        ? and(eq(pg2030Bitacora.anio, anio), eq(pg2030Bitacora.institucionId, institucionId))
        : eq(pg2030Bitacora.anio, anio),
    )
    .orderBy(desc(pg2030Bitacora.createdAt))
    .limit(500);
  return rows.map(({ b, sigla, nombre }) => ({
    id: b.id,
    anio: b.anio,
    trimestre: b.trimestre as Pg2030Trimestre,
    institucion: { id: b.institucionId, sigla, nombre },
    metaId: b.metaId,
    accion: b.accion,
    detalle: b.detalle,
    usuarioNombre: b.usuarioNombre,
    createdAt: b.createdAt.toISOString(),
  }));
}
