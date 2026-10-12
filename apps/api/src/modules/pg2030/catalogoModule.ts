import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pg2030ConflictosImportacion,
  pg2030Ejes,
  pg2030Estrategias,
  pg2030MetasPlan,
  pg2030Objetivos,
  pg2030Politicas,
  pg2030Proyectos,
} from "../../db/schema/pg2030.js";
import type {
  Pg2030Catalogo,
  Pg2030CatalogoResumen,
  Pg2030Conflicto,
  Pg2030Eje,
  Pg2030PresupuestoEstado,
  Pg2030Proyecto,
  Pg2030ProyectoTipo,
} from "@pma/types";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { lockAndAssertActor } from "../shared/transactionalActor.js";
import { encolarMetasDeMetaPlan } from "./clasificacionModule.js";

type ProyectoRow = typeof pg2030Proyectos.$inferSelect;
type ConflictoRow = typeof pg2030ConflictosImportacion.$inferSelect;

/** Natural order for plan codes: "G2" before "G11", "H11 (M2)" before "H11 (M10)". */
function byCodigo(a: { codigo: string }, b: { codigo: string }): number {
  return a.codigo.localeCompare(b.codigo, "es", { numeric: true });
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(key(row));
    if (list) list.push(row);
    else out.set(key(row), [row]);
  }
  return out;
}

function toConflicto(row: ConflictoRow): Pg2030Conflicto {
  return {
    id: row.id,
    campo: row.campo,
    valorUsado: row.valorUsado,
    valoresAlternativos: row.valoresAlternativos,
    revisado: row.revisado,
    revisadoPorNombre: row.revisadoPorNombre,
    revisadoAt: row.revisadoAt ? row.revisadoAt.toISOString() : null,
  };
}

function toProyecto(row: ProyectoRow, conflictos: ConflictoRow[]): Pg2030Proyecto {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    tipo: row.tipo as Pg2030ProyectoTipo,
    plazo: row.plazo,
    presupuestoEstado: row.presupuestoEstado as Pg2030PresupuestoEstado,
    presupuestoReferencial: row.presupuestoReferencial === null ? null : Number(row.presupuestoReferencial),
    tipoEntidadResponsable: row.tipoEntidadResponsable,
    responsablesPlan: row.responsablesPlan,
    entidadesEjecutoras: row.entidadesEjecutoras,
    hito2023: row.hito2023,
    hito2030: row.hito2030,
    conflictos: conflictos.map(toConflicto).sort((a, b) => a.campo.localeCompare(b.campo)),
  };
}

export async function getCatalogo(): Promise<Pg2030Catalogo> {
  const db = getDb();
  const [ejes, objetivos, politicas, estrategias, metas, proyectos, conflictos] = await Promise.all([
    db.select().from(pg2030Ejes),
    db.select().from(pg2030Objetivos),
    db.select().from(pg2030Politicas),
    db.select().from(pg2030Estrategias),
    db.select().from(pg2030MetasPlan),
    db.select().from(pg2030Proyectos),
    db.select().from(pg2030ConflictosImportacion),
  ]);

  const conflictosByProyecto = groupBy(conflictos, (c) => c.proyectoId);
  const proyectosByMeta = groupBy(proyectos, (p) => p.metaPlanId);
  const metasByEstrategia = groupBy(metas, (m) => m.estrategiaId);
  const estrategiasByPolitica = groupBy(estrategias, (e) => e.politicaId);
  const politicasByObjetivo = groupBy(politicas, (p) => p.objetivoId);
  const objetivosByEje = groupBy(objetivos, (o) => o.ejeId);

  const tree: Pg2030Eje[] = [...ejes]
    .sort((a, b) => a.orden - b.orden)
    .map((eje) => ({
      id: eje.id,
      codigo: eje.codigo,
      nombre: eje.nombre,
      orden: eje.orden,
      objetivos: (objetivosByEje.get(eje.id) ?? []).sort(byCodigo).map((objetivo) => ({
        id: objetivo.id,
        codigo: objetivo.codigo,
        texto: objetivo.texto,
        politicas: (politicasByObjetivo.get(objetivo.id) ?? []).sort(byCodigo).map((politica) => ({
          id: politica.id,
          codigo: politica.codigo,
          texto: politica.texto,
          estrategias: (estrategiasByPolitica.get(politica.id) ?? []).sort(byCodigo).map((estrategia) => ({
            id: estrategia.id,
            codigo: estrategia.codigo,
            texto: estrategia.texto,
            metas: (metasByEstrategia.get(estrategia.id) ?? []).sort(byCodigo).map((meta) => ({
              id: meta.id,
              codigo: meta.codigo,
              texto: meta.texto,
              cuantificable: meta.cuantificable,
              proyectos: (proyectosByMeta.get(meta.id) ?? [])
                .sort(byCodigo)
                .map((p) => toProyecto(p, conflictosByProyecto.get(p.id) ?? [])),
            })),
          })),
        })),
      })),
    }));

  return { resumen: buildResumen({ ejes, objetivos, politicas, estrategias, metas, proyectos, conflictos }), ejes: tree };
}

function buildResumen(rows: {
  ejes: unknown[];
  objetivos: unknown[];
  politicas: unknown[];
  estrategias: unknown[];
  metas: Array<{ cuantificable: boolean }>;
  proyectos: ProyectoRow[];
  conflictos: ConflictoRow[];
}): Pg2030CatalogoResumen {
  const porEstado: Record<Pg2030PresupuestoEstado, number> = {
    Monto: 0,
    SPI: 0,
    "No disponible": 0,
    "A definirse en la LISS": 0,
    "Sin dato": 0,
  };
  // Sum in cents: the column is numeric(14,2) and a float sum of 74 amounts
  // could otherwise drift away from the exact total.
  let totalCentavos = 0;
  for (const p of rows.proyectos) {
    porEstado[p.presupuestoEstado as Pg2030PresupuestoEstado] += 1;
    if (p.presupuestoReferencial !== null) totalCentavos += Math.round(Number(p.presupuestoReferencial) * 100);
  }
  return {
    ejes: rows.ejes.length,
    objetivos: rows.objetivos.length,
    politicas: rows.politicas.length,
    estrategias: rows.estrategias.length,
    metas: rows.metas.length,
    metasCuantificables: rows.metas.filter((m) => m.cuantificable).length,
    proyectos: rows.proyectos.length,
    // Decision D4: counted from the catalog, so correcting a milestone's text
    // changes the figure. A shared milestone must be corrected on every one of
    // its projects or it counts twice.
    hitos2030: new Set(rows.proyectos.map((p) => p.hito2030).filter((h): h is string => Boolean(h))).size,
    presupuesto: {
      proyectosConMonto: porEstado.Monto,
      total: totalCentavos / 100,
      porEstado,
    },
    conflictosPendientes: rows.conflictos.filter((c) => !c.revisado).length,
  };
}

// ---------------------------------------------------------------------------
// Corrections. The administrator fixes texts and data; nobody adds or deletes
// catalog rows (docs/pg2030-plan.md §3).
// ---------------------------------------------------------------------------

export type ProyectoPatch = {
  nombre?: string;
  tipo?: Pg2030ProyectoTipo;
  plazo?: string | null;
  presupuestoEstado?: Pg2030PresupuestoEstado;
  presupuestoReferencial?: number | null;
  tipoEntidadResponsable?: string | null;
  responsablesPlan?: string | null;
  entidadesEjecutoras?: string | null;
  hito2023?: string | null;
  hito2030?: string | null;
};

/**
 * Resolve the budget pair the row will hold after the patch. An amount exists
 * exactly when the state is "Monto" (a CHECK in 0031 enforces the same), so
 * leaving "Monto" drops the amount and entering it requires one.
 */
export function resolvePresupuesto(
  current: { estado: Pg2030PresupuestoEstado; monto: number | null },
  patch: Pick<ProyectoPatch, "presupuestoEstado" | "presupuestoReferencial">,
): { estado: Pg2030PresupuestoEstado; monto: number | null } {
  const estado = patch.presupuestoEstado ?? current.estado;
  if (estado !== "Monto") {
    if (patch.presupuestoReferencial !== undefined && patch.presupuestoReferencial !== null) {
      throw BadRequest(`El monto solo aplica cuando el presupuesto es un monto; ahora es "${estado}"`);
    }
    return { estado, monto: null };
  }
  const monto = patch.presupuestoReferencial !== undefined ? patch.presupuestoReferencial : current.monto;
  if (monto === null) throw BadRequest("Indica el monto del presupuesto referencial");
  return { estado, monto };
}

export async function updateProyecto(actorId: string, id: string, patch: ProyectoPatch): Promise<Pg2030Proyecto> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [current] = await tx.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.id, id)).limit(1).for("update");
    if (!current) throw NotFound("Proyecto no encontrado");

    const presupuesto = resolvePresupuesto(
      {
        estado: current.presupuestoEstado as Pg2030PresupuestoEstado,
        monto: current.presupuestoReferencial === null ? null : Number(current.presupuestoReferencial),
      },
      patch,
    );
    const [updated] = await tx
      .update(pg2030Proyectos)
      .set({
        ...(patch.nombre !== undefined ? { nombre: patch.nombre } : {}),
        ...(patch.tipo !== undefined ? { tipo: patch.tipo } : {}),
        ...(patch.plazo !== undefined ? { plazo: patch.plazo } : {}),
        ...(patch.tipoEntidadResponsable !== undefined ? { tipoEntidadResponsable: patch.tipoEntidadResponsable } : {}),
        ...(patch.responsablesPlan !== undefined ? { responsablesPlan: patch.responsablesPlan } : {}),
        ...(patch.entidadesEjecutoras !== undefined ? { entidadesEjecutoras: patch.entidadesEjecutoras } : {}),
        ...(patch.hito2023 !== undefined ? { hito2023: patch.hito2023 } : {}),
        ...(patch.hito2030 !== undefined ? { hito2030: patch.hito2030 } : {}),
        presupuestoEstado: presupuesto.estado,
        presupuestoReferencial: presupuesto.monto === null ? null : presupuesto.monto.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(pg2030Proyectos.id, id))
      .returning();
    const conflictos = await tx
      .select()
      .from(pg2030ConflictosImportacion)
      .where(eq(pg2030ConflictosImportacion.proyectoId, id));
    return toProyecto(updated, conflictos);
  });
}

export type NivelTexto = "objetivos" | "politicas" | "estrategias";

const NIVEL_TABLES = {
  objetivos: pg2030Objetivos,
  politicas: pg2030Politicas,
  estrategias: pg2030Estrategias,
} as const;

const NIVEL_LABELS: Record<NivelTexto, string> = {
  objetivos: "Objetivo",
  politicas: "Política",
  estrategias: "Estrategia",
};

export async function updateTextoNivel(
  actorId: string,
  nivel: NivelTexto,
  id: string,
  texto: string,
): Promise<{ id: string; codigo: string; texto: string }> {
  const table = NIVEL_TABLES[nivel];
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [updated] = await tx
      .update(table)
      .set({ texto, updatedAt: new Date() })
      .where(eq(table.id, id))
      .returning({ id: table.id, codigo: table.codigo, texto: table.texto });
    if (!updated) throw NotFound(`${NIVEL_LABELS[nivel]} no encontrado`);
    return updated;
  });
}

export async function updateEje(
  actorId: string,
  id: string,
  nombre: string,
): Promise<{ id: string; codigo: string; nombre: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [updated] = await tx
      .update(pg2030Ejes)
      .set({ nombre, updatedAt: new Date() })
      .where(eq(pg2030Ejes.id, id))
      .returning({ id: pg2030Ejes.id, codigo: pg2030Ejes.codigo, nombre: pg2030Ejes.nombre });
    if (!updated) throw NotFound("Eje no encontrado");
    return updated;
  });
}

export async function updateMetaPlan(
  actorId: string,
  id: string,
  patch: { texto?: string; cuantificable?: boolean },
): Promise<{ id: string; codigo: string; texto: string; cuantificable: boolean }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [updated] = await tx
      .update(pg2030MetasPlan)
      .set({
        ...(patch.texto !== undefined ? { texto: patch.texto } : {}),
        ...(patch.cuantificable !== undefined ? { cuantificable: patch.cuantificable } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pg2030MetasPlan.id, id))
      .returning({
        id: pg2030MetasPlan.id,
        codigo: pg2030MetasPlan.codigo,
        texto: pg2030MetasPlan.texto,
        cuantificable: pg2030MetasPlan.cuantificable,
      });
    if (!updated) throw NotFound("Meta del Plan no encontrada");
    // The Plan goal's text is the model's `meta`: its institutional goals are re-queued.
    if (patch.texto !== undefined) await encolarMetasDeMetaPlan(tx, id);
    return updated;
  });
}

/** Mark an import conflict as reviewed. Reviewing twice keeps the first review. */
export async function marcarConflictoRevisado(actorId: string, id: string): Promise<Pg2030Conflicto> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const actor = await lockAndAssertActor(tx, actorId, "pg2030", ["ADMIN"]);
    const [current] = await tx
      .select()
      .from(pg2030ConflictosImportacion)
      .where(eq(pg2030ConflictosImportacion.id, id))
      .limit(1)
      .for("update");
    if (!current) throw NotFound("Conflicto no encontrado");
    if (current.revisado) return toConflicto(current);

    const [updated] = await tx
      .update(pg2030ConflictosImportacion)
      .set({ revisado: true, revisadoPor: actor.id, revisadoPorNombre: actor.name, revisadoAt: new Date() })
      .where(eq(pg2030ConflictosImportacion.id, id))
      .returning();
    return toConflicto(updated);
  });
}
