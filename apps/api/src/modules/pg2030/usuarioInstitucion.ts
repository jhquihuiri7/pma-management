import { eq, inArray } from "drizzle-orm";
import { pg2030Instituciones, pg2030UsuarioInstitucion } from "../../db/schema/pg2030.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import type { Pg2030InstitucionRef } from "@pma/types";

/**
 * A REPORTER's institution in PG2030. Only REPORTERs carry one: ADMINs see
 * every institution and VIEWERs read all of them, so a link on either role
 * would mean nothing. Callers run these inside the transaction that holds the
 * authorization lock (see `lockAuthorizationMutations`).
 */
export function assertCanHaveInstitucion(role: string, apps: readonly string[]): void {
  if (role !== "REPORTER") {
    throw BadRequest("Solo un reportero tiene institución en PG2030");
  }
  if (!apps.includes("pg2030")) {
    throw BadRequest("El usuario no tiene acceso a PG2030");
  }
}

export async function setUsuarioInstitucion(
  tx: any,
  params: { userId: string; institucionId: string; actor: { id: string; name: string } },
): Promise<void> {
  // KEY SHARE blocks a concurrent delete of the institution until this link
  // commits, so the RESTRICT foreign key never surfaces as a 500.
  const [institucion] = await tx
    .select({ id: pg2030Instituciones.id, activa: pg2030Instituciones.activa })
    .from(pg2030Instituciones)
    .where(eq(pg2030Instituciones.id, params.institucionId))
    .limit(1)
    .for("key share");
  if (!institucion) throw NotFound("La institución no existe");
  if (!institucion.activa) throw BadRequest("La institución está inactiva y no puede recibir reporteros");

  const now = new Date();
  await tx
    .insert(pg2030UsuarioInstitucion)
    .values({
      userId: params.userId,
      institucionId: params.institucionId,
      asignadoPor: params.actor.id,
      asignadoPorNombre: params.actor.name,
    })
    .onConflictDoUpdate({
      target: pg2030UsuarioInstitucion.userId,
      set: {
        institucionId: params.institucionId,
        asignadoPor: params.actor.id,
        asignadoPorNombre: params.actor.name,
        updatedAt: now,
      },
    });
}

export async function clearUsuarioInstitucion(tx: any, userId: string): Promise<void> {
  await tx.delete(pg2030UsuarioInstitucion).where(eq(pg2030UsuarioInstitucion.userId, userId));
}

export async function getInstitucionesByUser(
  db: any,
  userIds: readonly string[],
): Promise<Map<string, Pg2030InstitucionRef>> {
  const out = new Map<string, Pg2030InstitucionRef>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      userId: pg2030UsuarioInstitucion.userId,
      id: pg2030Instituciones.id,
      nombre: pg2030Instituciones.nombre,
      sigla: pg2030Instituciones.sigla,
    })
    .from(pg2030UsuarioInstitucion)
    .innerJoin(pg2030Instituciones, eq(pg2030Instituciones.id, pg2030UsuarioInstitucion.institucionId))
    .where(inArray(pg2030UsuarioInstitucion.userId, [...userIds]));
  for (const row of rows) {
    out.set(row.userId, { id: row.id, nombre: row.nombre, sigla: row.sigla });
  }
  return out;
}
