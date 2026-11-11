import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { protocoloLimpiezaFotos, protocoloLimpiezaRegistros } from "../../db/schema/protocoloLimpieza.js";
import { BadRequest, Conflict } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import {
  camposDe,
  clean,
  datosAnteriores,
  limpiarRecursos,
  recordKey,
  type DatosRegistroLimpieza,
  type OperacionLimpieza,
  type RecursoLimpieza,
  type RegistroLimpieza,
} from "./reglas.js";

// Any role with the module may report and edit: the module has no per-role
// rules (decision of 2026-11-11). ADMIN has it implicitly.
export const ROLES_PROTOCOLO_LIMPIEZA = ["ADMIN", "REPORTER", "VIEWER"] as const;

const UNIQUE_VIOLATION = "23505";
const DUPLICADO = "Ya existe un reporte con esa combinación de datos.";
const CAMBIADO = "El registro cambió. Cierra el formulario y ábrelo de nuevo.";
const EDICION_INVALIDA = "El registro que intentas editar es inválido.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Postgres error code, whether thrown raw or wrapped in DrizzleQueryError's `cause`. */
function pgErrorCode(error: unknown): string | undefined {
  const own = (error as { code?: unknown })?.code;
  if (typeof own === "string") return own;
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

/** The shared rules throw plain Errors whose message names the field; they are the client's 400. */
function validar(
  kind: unknown,
  data: unknown,
  recursos: unknown,
): { kind: OperacionLimpieza; data: DatosRegistroLimpieza; recursos: RecursoLimpieza[] } {
  try {
    const limpio = clean(kind, data);
    return { kind: kind as OperacionLimpieza, data: limpio, recursos: limpiarRecursos(recursos) };
  } catch (error) {
    throw BadRequest(error instanceof Error ? error.message : "Reporte inválido.");
  }
}

/**
 * A report may only point at a photo that was uploaded through this module.
 * The rules check the id's shape; this checks that it exists.
 */
async function assertFotosExisten(tx: Tx, kind: OperacionLimpieza, data: DatosRegistroLimpieza): Promise<void> {
  const campos = camposDe(kind).filter((f) => f.type === "photo" && data[f.id] !== undefined);
  if (!campos.length) return;
  const ids = campos.map((f) => String(data[f.id]));
  const encontradas = await tx
    .select({ id: protocoloLimpiezaFotos.id })
    .from(protocoloLimpiezaFotos)
    .where(inArray(protocoloLimpiezaFotos.id, ids));
  const existentes = new Set(encontradas.map((f) => f.id));
  const faltante = campos.find((f) => !existentes.has(String(data[f.id])));
  if (faltante) throw BadRequest("Vuelve a adjuntar la " + faltante.label.toLowerCase() + ".");
}

function comoDuplicado(error: unknown): never {
  if (pgErrorCode(error) === UNIQUE_VIOLATION) throw Conflict(DUPLICADO);
  throw error;
}

/** Every report, oldest change first: the dashboard computes everything from this list. */
export async function listarRegistros(): Promise<RegistroLimpieza[]> {
  const t = protocoloLimpiezaRegistros;
  const rows = await getDb()
    .select({ id: t.id, kind: t.kind, data: t.data, recursos: t.recursos, version: t.version, updatedAt: t.updatedAt, createdByName: t.createdByName })
    .from(t)
    .orderBy(asc(t.updatedAt), asc(t.id));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as OperacionLimpieza,
    data: r.data,
    recursos: r.recursos ?? [],
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    creadoPorNombre: r.createdByName,
  }));
}

export async function crearRegistro(actorId: string, kind: unknown, data: unknown, recursos?: unknown): Promise<{ id: string }> {
  const entrada = validar(kind, data, recursos);
  const uniqueKey = recordKey(entrada.kind, entrada.data);
  try {
    return await getDb().transaction(async (tx) => {
      const actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
      await assertFotosExisten(tx, entrada.kind, entrada.data);
      const [row] = await tx
        .insert(protocoloLimpiezaRegistros)
        .values({
          kind: entrada.kind,
          data: entrada.data,
          recursos: entrada.recursos,
          uniqueKey,
          createdBy: actor.id,
          createdByName: actor.name,
          updatedBy: actor.id,
          updatedByName: actor.name,
        })
        .returning({ id: protocoloLimpiezaRegistros.id });
      return { id: row.id };
    });
  } catch (error) {
    comoDuplicado(error);
  }
}

/**
 * Saves an edit made from `version`. If anyone saved the report since, nothing
 * changes and the editor is asked to reopen it. The operation of a report
 * cannot change: an edit sent with another one is treated the same way.
 */
export async function editarRegistro(
  actorId: string,
  id: string,
  version: unknown,
  kind: unknown,
  data: unknown,
  recursos?: unknown,
): Promise<{ id: string }> {
  // Same order as the standalone app: the report's content first, then the edit itself.
  const entrada = validar(kind, data, recursos);
  if (!UUID.test(id) || typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw BadRequest(EDICION_INVALIDA);
  }
  const uniqueKey = recordKey(entrada.kind, entrada.data);
  const t = protocoloLimpiezaRegistros;
  try {
    return await getDb().transaction(async (tx) => {
      const actor = await lockAndAssertActor(tx, actorId, "protocolo_limpieza", ROLES_PROTOCOLO_LIMPIEZA);
      await assertFotosExisten(tx, entrada.kind, entrada.data);
      // Values of fields the form no longer asks (an older report's lot, for instance) are kept.
      const [actual] = await tx.select({ data: t.data }).from(t).where(eq(t.id, id)).limit(1);
      const datos = { ...datosAnteriores(entrada.kind, actual?.data ?? {}), ...entrada.data };
      const updated = await tx
        .update(t)
        .set({
          data: datos,
          recursos: entrada.recursos,
          uniqueKey,
          version: sql`${t.version} + 1`,
          updatedBy: actor.id,
          updatedByName: actor.name,
          updatedAt: sql`now()`,
        })
        .where(and(eq(t.id, id), eq(t.version, version), eq(t.kind, entrada.kind)))
        .returning({ id: t.id });
      if (!updated.length) throw Conflict(CAMBIADO);
      return { id };
    });
  } catch (error) {
    comoDuplicado(error);
  }
}
