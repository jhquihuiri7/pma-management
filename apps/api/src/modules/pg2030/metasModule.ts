import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pg2030Instituciones,
  pg2030MetaMeses,
  pg2030MetasInstitucionales,
  pg2030MetasPlan,
  pg2030Proyectos,
  pg2030SinAcciones,
  pg2030UsuarioInstitucion,
} from "../../db/schema/pg2030.js";
import type {
  Pg2030Clasificacion,
  Pg2030FuenteFinanciamiento,
  Pg2030InstitucionTipo,
  Pg2030MetaInstitucional,
  Pg2030MetaMes,
  Pg2030MetasPayload,
  Pg2030ReporteResultado,
} from "@pma/types";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../../lib/errors.js";
import {
  adminPuedeReportar,
  avisoAcumulado,
  corteCerrado,
  corteDeMes,
  mesBloqueado,
  type AnioCortes,
  type Trimestre,
} from "./cortes.js";
import {
  assertPuedeTrabajarCon,
  loadAnio,
  lockPg2030Writer,
  reaperturasHasta,
  toAnio,
  toAnioCortes,
  type Pg2030Writer,
} from "./shared.js";
import { registrarBitacora, type Clock } from "./aniosModule.js";
import { clasificacionActual, encolarClasificacion, solicitudesDe } from "./clasificacionModule.js";

type MetaRow = typeof pg2030MetasInstitucionales.$inferSelect;
type MesRow = typeof pg2030MetaMeses.$inferSelect;

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);
const MES_NOMBRES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesesTexto = (meses: number[]) => meses.map((m) => MES_NOMBRES[m - 1]).join(", ");

/** Physical values keep 4 decimals and money 2, as the columns do. */
const roundTo = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const fisico = (value: number) => roundTo(value, 4);
const dinero = (value: number) => roundTo(value, 2);
const num = (value: string | null) => (value === null ? null : Number(value));

/** Who is looking: decides what each month allows. */
type Caller = { role: "ADMIN" | "REPORTER" | "VIEWER"; institucionId: string | null };

/** Everything a lock decision needs, loaded once per request. */
type Contexto = { cfg: AnioCortes; reaperturas: Map<Trimestre, string>; now: Date };

async function loadContexto(db: any, anio: number, institucionId: string, now: Date): Promise<Contexto> {
  const cfg = toAnioCortes(await loadAnio(db, anio));
  return { cfg, reaperturas: await reaperturasHasta(db, anio, institucionId), now };
}

function bloqueado(ctx: Contexto, mes: number): boolean {
  return mesBloqueado(ctx.cfg, mes, ctx.reaperturas.get(corteDeMes(ctx.cfg, mes)) ?? null, ctx.now);
}

/** A month "has values" when anything was planned or it was reported. */
function tieneDatos(m: MesRow): boolean {
  return Number(m.fisicoPlanificado) > 0 || Number(m.presupuestoPlanificado) > 0 || m.reportadoAt !== null;
}

/** Closed cutoffs (even if reopened now) holding values of this goal: changes there go to the audit log. */
function cortesCerradosConDatos(ctx: Contexto, meses: MesRow[]): Trimestre[] {
  const cortes = new Set<Trimestre>();
  for (const m of meses) {
    const corte = corteDeMes(ctx.cfg, m.mes);
    if (tieneDatos(m) && corteCerrado(ctx.cfg, corte, ctx.now)) cortes.add(corte);
  }
  return [...cortes].sort();
}

/** Months with values that are locked right now: they block deleting the goal or moving its project. */
function mesesBloqueadosConDatos(ctx: Contexto, meses: MesRow[]): number[] {
  return meses.filter((m) => tieneDatos(m) && bloqueado(ctx, m.mes)).map((m) => m.mes).sort((a, b) => a - b);
}

function toMes(m: MesRow, ctx: Contexto, caller: Caller, institucionId: string): Pg2030MetaMes {
  const locked = bloqueado(ctx, m.mes);
  const canWrite = caller.role === "ADMIN" || (caller.role === "REPORTER" && caller.institucionId === institucionId);
  return {
    mes: m.mes,
    fisicoPlanificado: Number(m.fisicoPlanificado),
    presupuestoPlanificado: Number(m.presupuestoPlanificado),
    fisicoEjecutado: num(m.fisicoEjecutado),
    presupuestoDevengado: num(m.presupuestoDevengado),
    hitosAlcanzados: m.hitosAlcanzados,
    observaciones: m.observaciones,
    reportadoAt: m.reportadoAt ? m.reportadoAt.toISOString() : null,
    reportadoPorNombre: m.reportadoPorNombre,
    bloqueado: locked,
    puedePlanificar: canWrite && !locked,
    // An administrator reports for an institution only inside the initial load.
    puedeReportar: canWrite && !locked && (caller.role === "REPORTER" || adminPuedeReportar(ctx.cfg, m.mes, ctx.now)),
  };
}

type Refs = {
  institucion: { id: string; nombre: string; sigla: string };
  proyecto: { id: string; codigo: string; nombre: string; metaPlanCodigo: string };
};

function toMeta(
  meta: MetaRow,
  meses: MesRow[],
  refs: Refs,
  ctx: Contexto,
  caller: Caller,
  clasificacion: Pg2030Clasificacion,
): Pg2030MetaInstitucional {
  const ordered = [...meses].sort((a, b) => a.mes - b.mes);
  const sum = (pick: (m: MesRow) => string | null) => ordered.reduce((acc, m) => acc + Number(pick(m) ?? 0), 0);
  return {
    id: meta.id,
    anio: meta.anio,
    institucion: refs.institucion,
    proyecto: refs.proyecto,
    nombre: meta.nombre,
    descripcion: meta.descripcion,
    unidadMedida: meta.unidadMedida,
    fuenteFinanciamiento: meta.fuenteFinanciamiento as Pg2030FuenteFinanciamiento | null,
    beneficiariosDirectos: meta.beneficiariosDirectos,
    personalTecnico: meta.personalTecnico,
    responsablesInternos: meta.responsablesInternos,
    entidadesCoordinacion: meta.entidadesCoordinacion,
    meses: ordered.map((m) => toMes(m, ctx, caller, meta.institucionId)),
    totales: {
      fisicoPlanificado: fisico(sum((m) => m.fisicoPlanificado)),
      presupuestoPlanificado: dinero(sum((m) => m.presupuestoPlanificado)),
      fisicoEjecutado: fisico(sum((m) => m.fisicoEjecutado)),
      presupuestoDevengado: dinero(sum((m) => m.presupuestoDevengado)),
    },
    clasificacion,
    creadoPorNombre: meta.creadoPorNombre,
    createdAt: meta.createdAt.toISOString(),
    updatedAt: meta.updatedAt.toISOString(),
  };
}

async function loadRefs(db: any, metas: MetaRow[]): Promise<Map<string, Refs>> {
  const out = new Map<string, Refs>();
  if (metas.length === 0) return out;
  // Sequential: `db` may be a transaction (see mapMeta).
  const instituciones = await db
    .select({ id: pg2030Instituciones.id, nombre: pg2030Instituciones.nombre, sigla: pg2030Instituciones.sigla })
    .from(pg2030Instituciones)
    .where(inArray(pg2030Instituciones.id, [...new Set(metas.map((m) => m.institucionId))]));
  const proyectos = await db
    .select({
      id: pg2030Proyectos.id,
      codigo: pg2030Proyectos.codigo,
      nombre: pg2030Proyectos.nombre,
      metaPlanCodigo: pg2030MetasPlan.codigo,
    })
    .from(pg2030Proyectos)
    .innerJoin(pg2030MetasPlan, eq(pg2030MetasPlan.id, pg2030Proyectos.metaPlanId))
    .where(inArray(pg2030Proyectos.id, [...new Set(metas.map((m) => m.proyectoId))]));
  const instBy = new Map<string, Refs["institucion"]>(instituciones.map((i: Refs["institucion"]) => [i.id, i]));
  const proyBy = new Map<string, Refs["proyecto"]>(proyectos.map((p: Refs["proyecto"]) => [p.id, p]));
  for (const meta of metas) {
    out.set(meta.id, { institucion: instBy.get(meta.institucionId)!, proyecto: proyBy.get(meta.proyectoId)! });
  }
  return out;
}

async function loadMeses(db: any, metaIds: string[]): Promise<Map<string, MesRow[]>> {
  const out = new Map<string, MesRow[]>();
  if (metaIds.length === 0) return out;
  const rows: MesRow[] = await db.select().from(pg2030MetaMeses).where(inArray(pg2030MetaMeses.metaId, metaIds));
  for (const row of rows) {
    const list = out.get(row.metaId) ?? [];
    list.push(row);
    out.set(row.metaId, list);
  }
  return out;
}

async function mapMeta(db: any, meta: MetaRow, ctx: Contexto, caller: Caller): Promise<Pg2030MetaInstitucional> {
  // Sequential: `db` is usually a transaction, and one client can't run queries concurrently.
  const refs = await loadRefs(db, [meta]);
  const meses = await loadMeses(db, [meta.id]);
  const solicitudes = await solicitudesDe(db, [meta.id]);
  return toMeta(meta, meses.get(meta.id) ?? [], refs.get(meta.id)!, ctx, caller, clasificacionActual(solicitudes.get(meta.id)));
}

function callerOf(writer: Pg2030Writer): Caller {
  return { role: writer.role, institucionId: writer.institucionId };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * One institution's goals for a year, with what the caller may do on each
 * month. A reporter always gets their own institution, whatever they ask for.
 */
export async function listMetas(
  user: AccessTokenClaims,
  anio: number,
  institucionId: string | undefined,
  { now = new Date() }: Clock = {},
): Promise<Pg2030MetasPayload> {
  const db = getDb();
  const anioRow = await loadAnio(db, anio);

  let caller: Caller = { role: user.role, institucionId: null };
  let target = institucionId;
  if (user.role === "REPORTER") {
    const [link] = await db
      .select({ institucionId: pg2030UsuarioInstitucion.institucionId })
      .from(pg2030UsuarioInstitucion)
      .where(eq(pg2030UsuarioInstitucion.userId, user.sub))
      .limit(1);
    if (!link) {
      return { anio: toAnio(anioRow, now), institucion: null, sinAcciones: null, puedeEditar: false, metas: [] };
    }
    caller = { role: "REPORTER", institucionId: link.institucionId };
    target = link.institucionId;
  }
  if (!target) throw BadRequest("Elige una institución");

  const [institucion] = await db.select().from(pg2030Instituciones).where(eq(pg2030Instituciones.id, target)).limit(1);
  if (!institucion) throw NotFound("Institución no encontrada");
  const [declaracion] = await db
    .select()
    .from(pg2030SinAcciones)
    .where(and(eq(pg2030SinAcciones.anio, anio), eq(pg2030SinAcciones.institucionId, target)))
    .limit(1);
  const metas: MetaRow[] = await db
    .select()
    .from(pg2030MetasInstitucionales)
    .where(and(eq(pg2030MetasInstitucionales.anio, anio), eq(pg2030MetasInstitucionales.institucionId, target)))
    .orderBy(asc(pg2030MetasInstitucionales.createdAt));

  const ctx: Contexto = { cfg: toAnioCortes(anioRow), reaperturas: await reaperturasHasta(db, anio, target), now };
  const ids = metas.map((m) => m.id);
  const [refs, meses, solicitudes] = await Promise.all([loadRefs(db, metas), loadMeses(db, ids), solicitudesDe(db, ids)]);
  const metasOut = metas
    .map((m) => toMeta(m, meses.get(m.id) ?? [], refs.get(m.id)!, ctx, caller, clasificacionActual(solicitudes.get(m.id))))
    .sort((a, b) => a.proyecto.codigo.localeCompare(b.proyecto.codigo) || a.createdAt.localeCompare(b.createdAt));

  return {
    anio: toAnio(anioRow, now),
    institucion: {
      id: institucion.id,
      nombre: institucion.nombre,
      sigla: institucion.sigla,
      tipo: institucion.tipo as Pg2030InstitucionTipo,
      activa: institucion.activa,
    },
    sinAcciones: declaracion
      ? { declaradoPorNombre: declaracion.declaradoPorNombre, createdAt: declaracion.createdAt.toISOString() }
      : null,
    puedeEditar: caller.role === "ADMIN" || (caller.role === "REPORTER" && caller.institucionId === target),
    metas: metasOut,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export type MetaCampos = {
  nombre: string;
  descripcion?: string | null;
  unidadMedida: string;
  fuenteFinanciamiento?: Pg2030FuenteFinanciamiento | null;
  beneficiariosDirectos?: string | null;
  personalTecnico?: string | null;
  responsablesInternos?: string | null;
  entidadesCoordinacion?: string | null;
};

export type PlanMes = { mes: number; fisico: number; presupuesto: number };

export type CrearMetaInput = MetaCampos & {
  anio: number;
  institucionId: string;
  proyectoId: string;
  planificacion: PlanMes[];
};

function assertFuente(fuente: string | null | undefined, presupuestoTotal: number): void {
  if (presupuestoTotal > 0 && !fuente) {
    throw BadRequest("Indica la fuente de financiamiento: la meta tiene presupuesto planificado");
  }
}

async function assertProyecto(tx: any, proyectoId: string): Promise<void> {
  const [proyecto] = await tx
    .select({ id: pg2030Proyectos.id })
    .from(pg2030Proyectos)
    .where(eq(pg2030Proyectos.id, proyectoId))
    .limit(1);
  if (!proyecto) throw NotFound("El proyecto no existe en el catálogo del Plan");
}

export async function createMeta(
  actorId: string,
  input: CrearMetaInput,
  { now = new Date() }: Clock = {},
): Promise<Pg2030MetaInstitucional> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    assertPuedeTrabajarCon(writer, input.institucionId);
    const ctx = await loadContexto(tx, input.anio, input.institucionId, now);

    // Same lock as setSinAcciones: a goal and the declaration cannot race.
    const [institucion] = await tx
      .select({ id: pg2030Instituciones.id, activa: pg2030Instituciones.activa })
      .from(pg2030Instituciones)
      .where(eq(pg2030Instituciones.id, input.institucionId))
      .limit(1)
      .for("no key update");
    if (!institucion) throw NotFound("Institución no encontrada");
    if (!institucion.activa) throw BadRequest("La institución está inactiva");
    const [declaracion] = await tx
      .select({ anio: pg2030SinAcciones.anio })
      .from(pg2030SinAcciones)
      .where(and(eq(pg2030SinAcciones.anio, input.anio), eq(pg2030SinAcciones.institucionId, input.institucionId)))
      .limit(1);
    if (declaracion) {
      throw Conflict(`La institución declaró no tener acciones vinculadas en ${input.anio}: retira la declaración antes de crear metas`);
    }
    await assertProyecto(tx, input.proyectoId);

    const plan = new Map(input.planificacion.map((p) => [p.mes, { fisico: fisico(p.fisico), presupuesto: dinero(p.presupuesto) }]));
    const cerrados = MESES.filter((m) => bloqueado(ctx, m) && ((plan.get(m)?.fisico ?? 0) > 0 || (plan.get(m)?.presupuesto ?? 0) > 0));
    if (cerrados.length > 0) {
      throw Conflict(`Los meses ${mesesTexto(cerrados)} ya están cerrados: déjalos en 0 o pide una reapertura`);
    }
    assertFuente(input.fuenteFinanciamiento, [...plan.values()].reduce((s, p) => s + p.presupuesto, 0));

    const [meta] = await tx
      .insert(pg2030MetasInstitucionales)
      .values({
        anio: input.anio,
        institucionId: input.institucionId,
        proyectoId: input.proyectoId,
        nombre: input.nombre,
        descripcion: input.descripcion ?? null,
        unidadMedida: input.unidadMedida,
        fuenteFinanciamiento: input.fuenteFinanciamiento ?? null,
        beneficiariosDirectos: input.beneficiariosDirectos ?? null,
        personalTecnico: input.personalTecnico ?? null,
        responsablesInternos: input.responsablesInternos ?? null,
        entidadesCoordinacion: input.entidadesCoordinacion ?? null,
        creadoPor: writer.id,
        creadoPorNombre: writer.name,
      })
      .returning();
    await tx.insert(pg2030MetaMeses).values(MESES.map((mes) => ({
      metaId: meta.id,
      mes,
      fisicoPlanificado: String(plan.get(mes)?.fisico ?? 0),
      presupuestoPlanificado: String(plan.get(mes)?.presupuesto ?? 0),
    })));
    await encolarClasificacion(tx, meta.id);
    return mapMeta(tx, meta, ctx, callerOf(writer));
  });
}

async function lockMeta(tx: any, id: string): Promise<{ meta: MetaRow; meses: MesRow[] }> {
  const [meta] = await tx
    .select()
    .from(pg2030MetasInstitucionales)
    .where(eq(pg2030MetasInstitucionales.id, id))
    .limit(1)
    .for("update");
  if (!meta) throw NotFound("Meta institucional no encontrada");
  const meses: MesRow[] = await tx.select().from(pg2030MetaMeses).where(eq(pg2030MetaMeses.metaId, id));
  return { meta, meses };
}

export type ActualizarMetaInput = Partial<MetaCampos> & { proyectoId?: string };

const CAMPOS_META: Array<keyof ActualizarMetaInput> = [
  "proyectoId",
  "nombre",
  "descripcion",
  "unidadMedida",
  "fuenteFinanciamiento",
  "beneficiariosDirectos",
  "personalTecnico",
  "responsablesInternos",
  "entidadesCoordinacion",
];

/**
 * Edit a goal's descriptive fields (§5). They stay editable after a cutoff
 * closes — but then each change goes to the audit log. Moving the goal to
 * another project needs its locked months to be empty, or reopened.
 */
export async function updateMeta(
  actorId: string,
  id: string,
  patch: ActualizarMetaInput,
  { now = new Date() }: Clock = {},
): Promise<Pg2030MetaInstitucional> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    const { meta, meses } = await lockMeta(tx, id);
    assertPuedeTrabajarCon(writer, meta.institucionId);
    const ctx = await loadContexto(tx, meta.anio, meta.institucionId, now);

    const changed = CAMPOS_META.filter((k) => patch[k] !== undefined && patch[k] !== (meta as Record<string, unknown>)[k]);
    if (changed.length === 0) return mapMeta(tx, meta, ctx, callerOf(writer));

    if (changed.includes("proyectoId")) {
      const locked = mesesBloqueadosConDatos(ctx, meses);
      if (locked.length > 0) {
        throw Conflict(
          `La meta tiene valores en meses cerrados (${mesesTexto(locked)}): para cambiarla de proyecto hay que reabrir esos cortes`,
        );
      }
      await assertProyecto(tx, patch.proyectoId!);
    }
    const presupuestoTotal = meses.reduce((s, m) => s + Number(m.presupuestoPlanificado), 0);
    assertFuente(patch.fuenteFinanciamiento !== undefined ? patch.fuenteFinanciamiento : meta.fuenteFinanciamiento, presupuestoTotal);

    const [updated] = await tx
      .update(pg2030MetasInstitucionales)
      .set({ ...Object.fromEntries(changed.map((k) => [k, patch[k]])), updatedAt: new Date() })
      .where(eq(pg2030MetasInstitucionales.id, id))
      .returning();

    const cortes = cortesCerradosConDatos(ctx, meses);
    if (cortes.length > 0) {
      await registrarBitacora(tx, {
        anio: meta.anio,
        trimestre: cortes[0],
        institucionId: meta.institucionId,
        metaId: meta.id,
        accion: "meta_modificada",
        detalle: {
          cortes,
          cambios: Object.fromEntries(changed.map((k) => [k, { antes: (meta as Record<string, unknown>)[k] ?? null, despues: patch[k] ?? null }])),
        },
        usuario: writer,
      });
    }
    await encolarClasificacion(tx, id);
    return mapMeta(tx, updated, ctx, callerOf(writer));
  });
}

/**
 * Replace the twelve planned months. Locked months must come back unchanged;
 * months of a closed cutoff that is reopened change and are logged.
 */
export async function updatePlanificacion(
  actorId: string,
  id: string,
  planificacion: PlanMes[],
  { now = new Date() }: Clock = {},
): Promise<Pg2030MetaInstitucional> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    const { meta, meses } = await lockMeta(tx, id);
    assertPuedeTrabajarCon(writer, meta.institucionId);
    const ctx = await loadContexto(tx, meta.anio, meta.institucionId, now);

    const plan = new Map(planificacion.map((p) => [p.mes, { fisico: fisico(p.fisico), presupuesto: dinero(p.presupuesto) }]));
    const cambios = meses
      .map((m) => {
        const next = plan.get(m.mes) ?? { fisico: 0, presupuesto: 0 };
        const prev = { fisico: Number(m.fisicoPlanificado), presupuesto: Number(m.presupuestoPlanificado) };
        return { mes: m.mes, prev, next };
      })
      .filter((c) => c.prev.fisico !== c.next.fisico || c.prev.presupuesto !== c.next.presupuesto);

    const cerrados = cambios.filter((c) => bloqueado(ctx, c.mes)).map((c) => c.mes);
    if (cerrados.length > 0) {
      throw Conflict(`Los meses ${mesesTexto(cerrados)} están cerrados y su planificación no se puede cambiar`);
    }
    assertFuente(meta.fuenteFinanciamiento, [...MESES].reduce((s, mes) => s + (plan.get(mes)?.presupuesto ?? 0), 0));

    for (const c of cambios) {
      await tx
        .update(pg2030MetaMeses)
        .set({ fisicoPlanificado: String(c.next.fisico), presupuestoPlanificado: String(c.next.presupuesto), updatedAt: new Date() })
        .where(and(eq(pg2030MetaMeses.metaId, id), eq(pg2030MetaMeses.mes, c.mes)));
    }
    await logCambiosDeMeses(tx, ctx, meta, writer, cambios.map((c) => ({
      mes: c.mes,
      antes: { fisicoPlanificado: c.prev.fisico, presupuestoPlanificado: c.prev.presupuesto },
      despues: { fisicoPlanificado: c.next.fisico, presupuestoPlanificado: c.next.presupuesto },
    })));
    if (cambios.length > 0) {
      await tx.update(pg2030MetasInstitucionales).set({ updatedAt: new Date() }).where(eq(pg2030MetasInstitucionales.id, id));
    }
    return mapMeta(tx, meta, ctx, callerOf(writer));
  });
}

/** Log month changes that land in closed (hence reopened) cutoffs, one entry per cutoff. */
async function logCambiosDeMeses(
  tx: any,
  ctx: Contexto,
  meta: MetaRow,
  writer: Pg2030Writer,
  cambios: Array<{ mes: number; antes: Record<string, unknown>; despues: Record<string, unknown> }>,
): Promise<void> {
  const porCorte = new Map<Trimestre, typeof cambios>();
  for (const c of cambios) {
    const corte = corteDeMes(ctx.cfg, c.mes);
    if (!corteCerrado(ctx.cfg, corte, ctx.now)) continue;
    porCorte.set(corte, [...(porCorte.get(corte) ?? []), c]);
  }
  for (const [trimestre, lista] of porCorte) {
    await registrarBitacora(tx, {
      anio: meta.anio,
      trimestre,
      institucionId: meta.institucionId,
      metaId: meta.id,
      accion: "mes_modificado",
      detalle: { meses: lista },
      usuario: writer,
    });
  }
}

export type EjecucionInput = {
  fisicoEjecutado: number;
  presupuestoDevengado: number;
  hitosAlcanzados?: string | null;
  observaciones?: string | null;
};

/** Report one month (§6). Saving marks it reported, even with zeros. */
export async function reportarMes(
  actorId: string,
  id: string,
  mes: number,
  input: EjecucionInput,
  { now = new Date() }: Clock = {},
): Promise<Pg2030ReporteResultado> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    const { meta, meses } = await lockMeta(tx, id);
    assertPuedeTrabajarCon(writer, meta.institucionId);
    const ctx = await loadContexto(tx, meta.anio, meta.institucionId, now);

    if (bloqueado(ctx, mes)) throw Conflict(`${MES_NOMBRES[mes - 1]} ya está cerrado: pide una reapertura para corregirlo`);
    if (writer.role === "ADMIN" && !adminPuedeReportar(ctx.cfg, mes, now)) {
      throw Forbidden("El administrador solo reporta por una institución durante la carga inicial; fuera de ella reporta la institución");
    }
    const actual = meses.find((m) => m.mes === mes);
    if (!actual) throw NotFound("Mes no encontrado");

    const next = {
      fisicoEjecutado: fisico(input.fisicoEjecutado),
      presupuestoDevengado: dinero(input.presupuestoDevengado),
      hitosAlcanzados: input.hitosAlcanzados ?? null,
      observaciones: input.observaciones ?? null,
    };
    await tx
      .update(pg2030MetaMeses)
      .set({
        fisicoEjecutado: String(next.fisicoEjecutado),
        presupuestoDevengado: String(next.presupuestoDevengado),
        hitosAlcanzados: next.hitosAlcanzados,
        observaciones: next.observaciones,
        reportadoAt: new Date(),
        reportadoPor: writer.id,
        reportadoPorNombre: writer.name,
        updatedAt: new Date(),
      })
      .where(and(eq(pg2030MetaMeses.metaId, id), eq(pg2030MetaMeses.mes, mes)));
    await tx.update(pg2030MetasInstitucionales).set({ updatedAt: new Date() }).where(eq(pg2030MetasInstitucionales.id, id));

    await logCambiosDeMeses(tx, ctx, meta, writer, [{
      mes,
      antes: {
        fisicoEjecutado: num(actual.fisicoEjecutado),
        presupuestoDevengado: num(actual.presupuestoDevengado),
        hitosAlcanzados: actual.hitosAlcanzados,
        observaciones: actual.observaciones,
        reportado: actual.reportadoAt !== null,
      },
      despues: next,
    }]);
    // Milestones and notes are part of the model's input.
    await encolarClasificacion(tx, id);

    return {
      meta: await mapMeta(tx, meta, ctx, callerOf(writer)),
      avisoAcumulado: avisoAcumulado(Number(actual.fisicoPlanificado), next.fisicoEjecutado),
    };
  });
}

/** Delete a goal. Values in locked months block it until those cutoffs are reopened (§5). */
export async function deleteMeta(
  actorId: string,
  id: string,
  { now = new Date() }: Clock = {},
): Promise<{ ok: true; id: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const writer = await lockPg2030Writer(tx, actorId);
    const { meta, meses } = await lockMeta(tx, id);
    assertPuedeTrabajarCon(writer, meta.institucionId);
    const ctx = await loadContexto(tx, meta.anio, meta.institucionId, now);

    const locked = mesesBloqueadosConDatos(ctx, meses);
    if (locked.length > 0) {
      throw Conflict(`La meta tiene valores en meses cerrados (${mesesTexto(locked)}): para borrarla hay que reabrir esos cortes`);
    }
    const cortes = cortesCerradosConDatos(ctx, meses);
    if (cortes.length > 0) {
      const [proyecto] = await tx
        .select({ codigo: pg2030Proyectos.codigo })
        .from(pg2030Proyectos)
        .where(eq(pg2030Proyectos.id, meta.proyectoId));
      await registrarBitacora(tx, {
        anio: meta.anio,
        trimestre: cortes[0],
        institucionId: meta.institucionId,
        metaId: meta.id,
        accion: "meta_eliminada",
        detalle: { cortes, nombre: meta.nombre, proyecto: proyecto?.codigo ?? null },
        usuario: writer,
      });
    }
    await tx.delete(pg2030MetasInstitucionales).where(eq(pg2030MetasInstitucionales.id, id));
    return { ok: true as const, id };
  });
}
