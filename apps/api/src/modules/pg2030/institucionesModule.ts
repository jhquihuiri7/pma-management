import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema/shared.js";
import {
  pg2030Anios,
  pg2030Convocatorias,
  pg2030Instituciones,
  pg2030UsuarioInstitucion,
} from "../../db/schema/pg2030.js";
import type { Pg2030Institucion, Pg2030InstitucionTipo, Pg2030Me } from "@pma/types";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { Conflict, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION, pgErrorCode } from "./shared.js";

type InstitucionRow = typeof pg2030Instituciones.$inferSelect;

export type InstitucionInput = {
  nombre: string;
  sigla: string;
  tipo: Pg2030InstitucionTipo;
  activa?: boolean;
};

function toInstitucion(row: InstitucionRow, usuarios: Pg2030Institucion["usuarios"]): Pg2030Institucion {
  return {
    id: row.id,
    nombre: row.nombre,
    sigla: row.sigla,
    tipo: row.tipo as Pg2030InstitucionTipo,
    activa: row.activa,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    usuarios,
  };
}

/**
 * Refuse a sigla another institution already uses, compared case-insensitively
 * like the unique index. Checked up front for a readable message; the index
 * still catches a concurrent insert (see `withSiglaConflict`).
 */
async function assertSiglaLibre(tx: any, sigla: string, exceptId?: string): Promise<void> {
  const [taken] = await tx
    .select({ id: pg2030Instituciones.id, sigla: pg2030Instituciones.sigla })
    .from(pg2030Instituciones)
    .where(
      exceptId
        ? and(sql`lower(${pg2030Instituciones.sigla}) = lower(${sigla})`, ne(pg2030Instituciones.id, exceptId))
        : sql`lower(${pg2030Instituciones.sigla}) = lower(${sigla})`,
    )
    .limit(1);
  if (taken) throw Conflict(`Ya existe una institución con la sigla ${taken.sigla}`);
}

async function withSiglaConflict<T>(sigla: string | undefined, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      throw Conflict(`Ya existe una institución con la sigla ${sigla ?? ""}`.trim());
    }
    throw error;
  }
}

export async function listInstituciones(): Promise<Pg2030Institucion[]> {
  const db = getDb();
  const [rows, links] = await Promise.all([
    db.select().from(pg2030Instituciones).orderBy(asc(pg2030Instituciones.sigla)),
    db
      .select({
        institucionId: pg2030UsuarioInstitucion.institucionId,
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(pg2030UsuarioInstitucion)
      .innerJoin(users, eq(users.id, pg2030UsuarioInstitucion.userId))
      .orderBy(asc(users.name)),
  ]);
  const byInstitucion = new Map<string, Pg2030Institucion["usuarios"]>();
  for (const link of links) {
    const list = byInstitucion.get(link.institucionId) ?? [];
    list.push({ id: link.id, name: link.name, email: link.email });
    byInstitucion.set(link.institucionId, list);
  }
  return rows.map((row) => toInstitucion(row, byInstitucion.get(row.id) ?? []));
}

export async function createInstitucion(actorId: string, input: InstitucionInput): Promise<Pg2030Institucion> {
  const db = getDb();
  return withSiglaConflict(input.sigla, () =>
    db.transaction(async (tx) => {
      await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
      await assertSiglaLibre(tx, input.sigla);
      const [row] = await tx
        .insert(pg2030Instituciones)
        .values({ nombre: input.nombre, sigla: input.sigla, tipo: input.tipo, activa: input.activa ?? true })
        .returning();
      // A new institution is called in the most recent open year only (§4);
      // earlier years are marked by hand if needed.
      const [latest] = await tx.select({ anio: sql<number | null>`max(${pg2030Anios.anio})` }).from(pg2030Anios);
      if (latest?.anio != null && row.activa) {
        await tx.insert(pg2030Convocatorias).values({ anio: latest.anio, institucionId: row.id }).onConflictDoNothing();
      }
      return toInstitucion(row, []);
    }),
  );
}

export async function updateInstitucion(
  actorId: string,
  id: string,
  patch: Partial<InstitucionInput>,
): Promise<Pg2030Institucion> {
  const db = getDb();
  return withSiglaConflict(patch.sigla, () =>
    db.transaction(async (tx) => {
      await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
      if (patch.sigla !== undefined) await assertSiglaLibre(tx, patch.sigla, id);
      const [row] = await tx
        .update(pg2030Instituciones)
        .set({
          ...(patch.nombre !== undefined ? { nombre: patch.nombre } : {}),
          ...(patch.sigla !== undefined ? { sigla: patch.sigla } : {}),
          ...(patch.tipo !== undefined ? { tipo: patch.tipo } : {}),
          ...(patch.activa !== undefined ? { activa: patch.activa } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pg2030Instituciones.id, id))
        .returning();
      if (!row) throw NotFound("Institución no encontrada");
      const usuarios = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(pg2030UsuarioInstitucion)
        .innerJoin(users, eq(users.id, pg2030UsuarioInstitucion.userId))
        .where(eq(pg2030UsuarioInstitucion.institucionId, id))
        .orderBy(asc(users.name));
      return toInstitucion(row, usuarios);
    }),
  );
}

/**
 * Delete an institution created by mistake. Anything that hangs from it — for
 * now its reporters — blocks the delete; deactivating is the way to retire an
 * institution that has a history.
 */
export async function deleteInstitucion(actorId: string, id: string): Promise<{ ok: true; id: string }> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
      const [linked] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pg2030UsuarioInstitucion)
        .where(eq(pg2030UsuarioInstitucion.institucionId, id));
      if (linked && linked.count > 0) {
        throw Conflict(
          `La institución tiene ${linked.count} reportero(s) asignado(s). Reasígnalos o desactívala en lugar de eliminarla`,
        );
      }
      const deleted = await tx
        .delete(pg2030Instituciones)
        .where(eq(pg2030Instituciones.id, id))
        .returning({ id: pg2030Instituciones.id });
      if (deleted.length !== 1) throw NotFound("Institución no encontrada");
      return { ok: true as const, id };
    });
  } catch (error) {
    // A reference added by a later phase (metas institucionales) that this
    // function does not know about yet still refuses the delete cleanly.
    if (pgErrorCode(error) === FOREIGN_KEY_VIOLATION) {
      throw Conflict("La institución tiene datos asociados. Desactívala en lugar de eliminarla");
    }
    throw error;
  }
}

/** Payload of `GET /pg2030/me`: the caller's role and, for a REPORTER, their institution. */
export async function getPg2030Me(user: AccessTokenClaims): Promise<Pg2030Me> {
  const db = getDb();
  const [row] = await db
    .select({
      id: pg2030Instituciones.id,
      nombre: pg2030Instituciones.nombre,
      sigla: pg2030Instituciones.sigla,
      tipo: pg2030Instituciones.tipo,
      activa: pg2030Instituciones.activa,
    })
    .from(pg2030UsuarioInstitucion)
    .innerJoin(pg2030Instituciones, eq(pg2030Instituciones.id, pg2030UsuarioInstitucion.institucionId))
    .where(eq(pg2030UsuarioInstitucion.userId, user.sub))
    .limit(1);
  const institucion = row ? { ...row, tipo: row.tipo as Pg2030InstitucionTipo } : null;
  return {
    role: user.role,
    institucion,
    puedeEscribir: user.role === "ADMIN" || (user.role === "REPORTER" && institucion !== null),
  };
}
