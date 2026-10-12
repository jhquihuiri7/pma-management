import { and, eq, sql } from "drizzle-orm";
import { pg2030Anios, pg2030Reaperturas, pg2030UsuarioInstitucion } from "../../db/schema/pg2030.js";
import type { Pg2030Anio, Pg2030Trimestre } from "@pma/types";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import {
  TRIMESTRES,
  corteEnCarga,
  corteHabilitado,
  estadoCorte,
  plazoBase,
  plazoCierre,
  type AnioCortes,
  type Trimestre,
} from "./cortes.js";

/** Postgres error code, whether thrown raw or wrapped in DrizzleQueryError's `cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  const own = (error as { code?: unknown })?.code;
  if (typeof own === "string") return own;
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

/** Someone who writes PG2030 data: an administrator, or a reporter for their institution. */
export interface Pg2030Writer {
  id: string;
  name: string;
  role: "ADMIN" | "REPORTER";
  /** The reporter's institution; null for an administrator, who works for any. */
  institucionId: string | null;
}

/**
 * Establish the writer at the start of a transaction, revalidating role, app
 * access and — for a reporter — the institution they report for. A reporter
 * without one can read but never write (§4).
 */
export async function lockPg2030Writer(tx: any, userId: string): Promise<Pg2030Writer> {
  const actor = await lockAndAssertActor(tx, userId, "pg2030", ["ADMIN", "REPORTER"]);
  if (actor.role === "ADMIN") return { id: actor.id, name: actor.name, role: "ADMIN", institucionId: null };
  const [link] = await tx
    .select({ institucionId: pg2030UsuarioInstitucion.institucionId })
    .from(pg2030UsuarioInstitucion)
    .where(eq(pg2030UsuarioInstitucion.userId, actor.id))
    .limit(1)
    .for("share");
  if (!link) throw Forbidden("Tu usuario no tiene una institución asignada en PG2030; pide al administrador que te la asigne");
  return { id: actor.id, name: actor.name, role: "REPORTER", institucionId: link.institucionId };
}

export function assertPuedeTrabajarCon(writer: Pg2030Writer, institucionId: string): void {
  if (writer.role === "REPORTER" && writer.institucionId !== institucionId) {
    throw Forbidden("Solo puedes trabajar con las metas de tu institución");
  }
}

export type AnioRow = typeof pg2030Anios.$inferSelect;

export function toAnioCortes(row: AnioRow): AnioCortes {
  return { anio: row.anio, primerCorte: row.primerCorte as Trimestre, fechaLimiteCarga: row.fechaLimiteCarga };
}

export async function loadAnio(db: any, anio: number): Promise<AnioRow> {
  const [row] = await db.select().from(pg2030Anios).where(eq(pg2030Anios.anio, anio)).limit(1);
  if (!row) throw NotFound(`El año ${anio} no está abierto en PG2030`);
  return row;
}

/** Latest reopening deadline per cutoff for one institution in one year. */
export async function reaperturasHasta(
  db: any,
  anio: number,
  institucionId: string,
): Promise<Map<Trimestre, string>> {
  const rows: Array<{ trimestre: number; hasta: string }> = await db
    .select({ trimestre: pg2030Reaperturas.trimestre, hasta: sql<string>`max(${pg2030Reaperturas.fechaLimite})::text` })
    .from(pg2030Reaperturas)
    .where(and(eq(pg2030Reaperturas.anio, anio), eq(pg2030Reaperturas.institucionId, institucionId)))
    .groupBy(pg2030Reaperturas.trimestre);
  return new Map(rows.map((r) => [r.trimestre as Trimestre, r.hasta]));
}

export function toAnio(row: AnioRow, now: Date): Pg2030Anio {
  const cfg = toAnioCortes(row);
  return {
    anio: row.anio,
    primerCorte: row.primerCorte as Pg2030Trimestre,
    fechaLimiteCarga: row.fechaLimiteCarga,
    abiertoPorNombre: row.abiertoPorNombre,
    createdAt: row.createdAt.toISOString(),
    cortes: TRIMESTRES.map((t) => ({
      trimestre: t,
      habilitado: corteHabilitado(cfg, t),
      plazoBase: plazoBase(cfg.anio, t),
      plazoCierre: plazoCierre(cfg, t),
      enCarga: corteEnCarga(cfg, t),
      estado: estadoCorte(cfg, t, now),
    })),
  };
}
