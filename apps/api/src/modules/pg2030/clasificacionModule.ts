import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pg2030Clasificaciones,
  pg2030MetaMeses,
  pg2030MetasInstitucionales,
  pg2030MetasPlan,
  pg2030Proyectos,
} from "../../db/schema/pg2030.js";
import type { Pg2030Clasificacion } from "@pma/types";
import { env } from "../../lib/env.js";
import { ProveedorIaError, llamarNvidia, type ClasificadorIa } from "./ia/cliente.js";
import { interpretarContribucion, interpretarInversion } from "./ia/interpretar.js";
import { PROMPT_VERSION, promptContribucion, promptInversion } from "./ia/prompts.js";

type ClasificacionRow = typeof pg2030Clasificaciones.$inferSelect;

/** Answers outside the closed list allowed per request before it gives up (plan §8). */
export const MAX_RESPUESTAS_INVALIDAS = 3;
const STALE_LOCK_MS = 10 * 60_000;

/**
 * What the institution wrote, as the model's `contexto` (plan §8): the goal's
 * name and description, its direct beneficiaries and, for every reported
 * month, the milestones reached and the notes — joined with " - ".
 */
export function construirContexto(
  meta: { nombre: string; descripcion: string | null; beneficiariosDirectos: string | null },
  meses: Array<{ mes: number; reportado: boolean; hitosAlcanzados: string | null; observaciones: string | null }>,
): string {
  const partes = [meta.nombre, meta.descripcion, meta.beneficiariosDirectos];
  for (const m of [...meses].sort((a, b) => a.mes - b.mes)) {
    if (!m.reportado) continue;
    partes.push(m.hitosAlcanzados, m.observaciones);
  }
  return partes.map((p) => (p ?? "").trim()).filter(Boolean).join(" - ");
}

export function huellaDe(metaTexto: string, contexto: string): string {
  return createHash("sha256").update(`${PROMPT_VERSION}\u0000${metaTexto}\u0000${contexto}`).digest("hex");
}

/** The model's two inputs for a goal, read from the current data. */
async function entradaDeMeta(db: any, metaId: string): Promise<{ metaTexto: string; contexto: string } | null> {
  const [meta] = await db
    .select({
      nombre: pg2030MetasInstitucionales.nombre,
      descripcion: pg2030MetasInstitucionales.descripcion,
      beneficiariosDirectos: pg2030MetasInstitucionales.beneficiariosDirectos,
      metaTexto: pg2030MetasPlan.texto,
    })
    .from(pg2030MetasInstitucionales)
    .innerJoin(pg2030Proyectos, eq(pg2030Proyectos.id, pg2030MetasInstitucionales.proyectoId))
    .innerJoin(pg2030MetasPlan, eq(pg2030MetasPlan.id, pg2030Proyectos.metaPlanId))
    .where(eq(pg2030MetasInstitucionales.id, metaId))
    .limit(1);
  if (!meta) return null;
  const meses = await db
    .select({
      mes: pg2030MetaMeses.mes,
      reportadoAt: pg2030MetaMeses.reportadoAt,
      hitosAlcanzados: pg2030MetaMeses.hitosAlcanzados,
      observaciones: pg2030MetaMeses.observaciones,
    })
    .from(pg2030MetaMeses)
    .where(eq(pg2030MetaMeses.metaId, metaId));
  return {
    metaTexto: meta.metaTexto,
    contexto: construirContexto(meta, meses.map((m: { mes: number; reportadoAt: Date | null; hitosAlcanzados: string | null; observaciones: string | null }) => ({
      mes: m.mes,
      reportado: m.reportadoAt !== null,
      hitosAlcanzados: m.hitosAlcanzados,
      observaciones: m.observaciones,
    }))),
  };
}

/**
 * Queue a classification when the model's input changed. Called inside the
 * transaction that wrote the goal (plan §8), so the request and the change
 * commit together. Returns whether a request was created.
 */
export async function encolarClasificacion(tx: any, metaId: string): Promise<boolean> {
  const entrada = await entradaDeMeta(tx, metaId);
  if (!entrada) return false;
  const huella = huellaDe(entrada.metaTexto, entrada.contexto);
  const [ultima] = await tx
    .select({ huella: pg2030Clasificaciones.huella })
    .from(pg2030Clasificaciones)
    .where(eq(pg2030Clasificaciones.metaId, metaId))
    .orderBy(desc(pg2030Clasificaciones.createdAt))
    .limit(1);
  if (ultima?.huella === huella) return false;
  await tx.insert(pg2030Clasificaciones).values({ metaId, huella, metaTexto: entrada.metaTexto, contexto: entrada.contexto });
  return true;
}

/** Re-queue the goals of every project under a Plan goal whose text an administrator corrected. */
export async function encolarMetasDeMetaPlan(tx: any, metaPlanId: string): Promise<number> {
  const metas = await tx
    .select({ id: pg2030MetasInstitucionales.id })
    .from(pg2030MetasInstitucionales)
    .innerJoin(pg2030Proyectos, eq(pg2030Proyectos.id, pg2030MetasInstitucionales.proyectoId))
    .where(eq(pg2030Proyectos.metaPlanId, metaPlanId));
  let created = 0;
  for (const m of metas) if (await encolarClasificacion(tx, m.id)) created += 1;
  return created;
}

/** Goals that never got a request (written before phase 4): the worker queues them. */
export async function encolarFaltantes(limit = 200): Promise<number> {
  const db = getDb();
  const faltantes = await db
    .select({ id: pg2030MetasInstitucionales.id })
    .from(pg2030MetasInstitucionales)
    .where(sql`not exists (select 1 from ${pg2030Clasificaciones} c where c.meta_id = ${pg2030MetasInstitucionales.id})`)
    .limit(limit);
  let created = 0;
  for (const m of faltantes) {
    if (await db.transaction((tx) => encolarClasificacion(tx, m.id))) created += 1;
  }
  return created;
}

type Resultado = { clasificadas: number; reintentos: number; sinClasificar: number; erroresProveedor: number };

/**
 * Answer pending requests, mail-outbox style: claim with `lockedAt`, call the
 * model outside any transaction, then record the outcome. Provider failures
 * back off and stay pending forever; answers outside the list count toward
 * MAX_RESPUESTAS_INVALIDAS, after which the request ends "sin clasificar"
 * until the goal's input changes.
 */
export async function procesarClasificaciones({
  limit = 5,
  clasificar = llamarNvidia,
  now = () => new Date(),
  metaIds,
}: {
  limit?: number;
  clasificar?: ClasificadorIa;
  now?: () => Date;
  /** Only these goals' requests (tests); every pending one otherwise. */
  metaIds?: string[];
} = {}): Promise<Resultado> {
  const db = getDb();
  const start = now();
  const staleLock = new Date(start.getTime() - STALE_LOCK_MS);
  const claimable = or(isNull(pg2030Clasificaciones.lockedAt), lt(pg2030Clasificaciones.lockedAt, staleLock));
  const candidates = await db
    .select({ id: pg2030Clasificaciones.id })
    .from(pg2030Clasificaciones)
    .where(and(
      eq(pg2030Clasificaciones.estado, "pendiente"),
      lte(pg2030Clasificaciones.availableAt, start),
      claimable,
      metaIds ? inArray(pg2030Clasificaciones.metaId, metaIds) : undefined,
    ))
    .orderBy(asc(pg2030Clasificaciones.availableAt))
    .limit(limit);

  const result: Resultado = { clasificadas: 0, reintentos: 0, sinClasificar: 0, erroresProveedor: 0 };
  for (const candidate of candidates) {
    const claimTime = now();
    const [job] = await db
      .update(pg2030Clasificaciones)
      .set({ lockedAt: claimTime })
      .where(and(eq(pg2030Clasificaciones.id, candidate.id), eq(pg2030Clasificaciones.estado, "pendiente"), claimable))
      .returning();
    if (!job) continue;
    const mine = and(eq(pg2030Clasificaciones.id, job.id), eq(pg2030Clasificaciones.lockedAt, claimTime));

    try {
      const update = await clasificarJob(job, clasificar);
      const invalidas = job.respuestasInvalidas + update.invalidas;
      const completa = update.contribucion !== null && update.tipoInversion !== null;
      const agotada = !completa && invalidas >= MAX_RESPUESTAS_INVALIDAS;
      await db
        .update(pg2030Clasificaciones)
        .set({
          contribucion: update.contribucion,
          tipoInversion: update.tipoInversion,
          respuestaContribucion: update.respuestaContribucion,
          respuestaInversion: update.respuestaInversion,
          respuestasInvalidas: invalidas,
          intentos: job.intentos + 1,
          modelo: env.NVIDIA_MODEL,
          estado: completa ? "clasificada" : agotada ? "sin_clasificar" : "pendiente",
          procesadaAt: completa || agotada ? now() : null,
          availableAt: completa || agotada ? job.availableAt : new Date(now().getTime() + 60_000),
          lockedAt: null,
          lastError: completa ? null : "Respuesta fuera de la lista de categorías",
        })
        .where(mine);
      if (completa) result.clasificadas += 1;
      else if (agotada) result.sinClasificar += 1;
      else result.reintentos += 1;
    } catch (error) {
      const intentos = job.intentos + 1;
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(intentos, 7));
      await db
        .update(pg2030Clasificaciones)
        .set({
          intentos,
          availableAt: new Date(now().getTime() + delayMs),
          lockedAt: null,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        })
        .where(mine);
      result.erroresProveedor += 1;
      // Without a key, or with the provider down, every other request would
      // fail the same way: stop and let the backoff space the next attempts.
      if (error instanceof ProveedorIaError) break;
    }
  }
  return result;
}

/** Ask only for what is still missing, so a half answer is kept. */
async function clasificarJob(job: ClasificacionRow, clasificar: ClasificadorIa) {
  let contribucion = job.contribucion;
  let tipoInversion = job.tipoInversion;
  let respuestaContribucion = job.respuestaContribucion;
  let respuestaInversion = job.respuestaInversion;
  let invalidas = 0;
  if (!contribucion) {
    respuestaContribucion = await clasificar(promptContribucion(job.metaTexto, job.contexto));
    contribucion = interpretarContribucion(respuestaContribucion);
    if (!contribucion) invalidas += 1;
  }
  if (!tipoInversion) {
    respuestaInversion = await clasificar(promptInversion(job.metaTexto, job.contexto));
    tipoInversion = interpretarInversion(respuestaInversion);
    if (!tipoInversion) invalidas += 1;
  }
  return { contribucion, tipoInversion, respuestaContribucion, respuestaInversion, invalidas };
}

// ---------------------------------------------------------------------------
// Reading the classification in force
// ---------------------------------------------------------------------------

export function vistaDe(row: ClasificacionRow | undefined): Pg2030Clasificacion {
  if (!row) return { estado: "analizando", contribucion: null, tipoInversion: null, actualizadaAt: null };
  return {
    estado: row.estado === "clasificada" ? "clasificada" : row.estado === "sin_clasificar" ? "pendiente_clasificacion" : "analizando",
    contribucion: row.contribucion,
    tipoInversion: row.tipoInversion,
    actualizadaAt: (row.procesadaAt ?? row.createdAt).toISOString(),
  };
}

export async function solicitudesDe(db: any, metaIds: string[]): Promise<Map<string, ClasificacionRow[]>> {
  const out = new Map<string, ClasificacionRow[]>();
  if (metaIds.length === 0) return out;
  const rows: ClasificacionRow[] = await db
    .select()
    .from(pg2030Clasificaciones)
    .where(inArray(pg2030Clasificaciones.metaId, metaIds))
    .orderBy(asc(pg2030Clasificaciones.createdAt));
  for (const row of rows) out.set(row.metaId, [...(out.get(row.metaId) ?? []), row]);
  return out;
}

/** The goal's latest request: what the planning screen shows. */
export function clasificacionActual(solicitudes: ClasificacionRow[] | undefined): Pg2030Clasificacion {
  return vistaDe(solicitudes?.[solicitudes.length - 1]);
}

/**
 * The classification a cutoff uses (plan §8): that of the latest request
 * created before the institution's effective deadline, even if it was answered
 * later. A cutoff still open uses the latest request.
 */
export function clasificacionAlCorte(solicitudes: ClasificacionRow[] | undefined, antesDe: Date | null): Pg2030Clasificacion {
  if (!solicitudes || solicitudes.length === 0) return vistaDe(undefined);
  if (!antesDe) return vistaDe(solicitudes[solicitudes.length - 1]);
  const previas = solicitudes.filter((s) => s.createdAt < antesDe);
  return vistaDe(previas[previas.length - 1] ?? solicitudes[0]);
}
