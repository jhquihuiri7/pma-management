import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  pg2030Anios,
  pg2030Convocatorias,
  pg2030Ejes,
  pg2030Estrategias,
  pg2030Instituciones,
  pg2030MetaMeses,
  pg2030MetasInstitucionales,
  pg2030MetasPlan,
  pg2030Objetivos,
  pg2030Politicas,
  pg2030Proyectos,
  pg2030SinAcciones,
  pg2030UsuarioInstitucion,
} from "../../db/schema/pg2030.js";
import type {
  Pg2030Coherencia,
  Pg2030Dashboard,
  Pg2030DashboardInstitucion,
  Pg2030DashboardMeta,
  Pg2030InstitucionTipo,
  Pg2030Leyenda,
  Pg2030Semaforo,
} from "@pma/types";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { getCatalogo } from "./catalogoModule.js";
import { clasificacionAlCorte, solicitudesDe } from "./clasificacionModule.js";
import {
  corteCerrado,
  corteHabilitado,
  estadoCorte,
  finDelDia,
  mesesDeTrimestre,
  plazoEfectivo,
  type Trimestre,
} from "./cortes.js";
import { CONTRIBUCIONES, TIPOS_INVERSION } from "./ia/interpretar.js";
import {
  dinero,
  estadoReporte,
  institucionAlCorte,
  metaAlCorte,
  promedio,
  semaforo,
  type MetaAlCorte,
} from "./indicadores.js";
import { reaperturasHasta, toAnio, toAnioCortes } from "./shared.js";
import type { Clock } from "./aniosModule.js";

const PENDIENTE = "Pendiente de clasificación";
const FUENTES = ["Corriente", "Inversión", "Cooperación"];

/**
 * Labels and colors live here, in the API (plan §12). Status colors carry the
 * traffic light and coherence (always shown with a label); the categorical
 * slots carry identity. Validated with the dataviz palette checks.
 */
export const LEYENDA: Pg2030Leyenda = {
  semaforo: {
    verde: { label: "Avance esperado", color: "#0ca30c" },
    amarillo: { label: "Avance cercano al esperado", color: "#fab219" },
    rojo: { label: "Avance menor al esperado", color: "#d03b3b" },
    sin_avance: { label: "Sin avance", color: "#8a8985" },
  },
  coherencia: {
    coherente: { label: "Coherente", color: "#0ca30c" },
    sin_financiamiento: { label: "Sin financiamiento", color: "#ec835a" },
    incoherencia_brecha: { label: "Incoherencia: brecha", color: "#d03b3b" },
    no_aplica: { label: "No aplica", color: "#8a8985" },
  },
  contribucion: [
    { key: "Contribución directa", label: "Contribución directa", color: "#2a78d6" },
    { key: "Contribución complementaria", label: "Contribución complementaria", color: "#eb6834" },
    { key: "Alineación relativa", label: "Alineación relativa", color: "#1baf7a" },
    { key: "Sin alineación", label: "Sin alineación", color: "#eda100" },
    { key: PENDIENTE, label: PENDIENTE, color: "#b5b4ae" },
  ],
  serie: { planificado: "#2a78d6", devengado: "#eb6834" },
};

export type DashboardFiltros = {
  anio?: number;
  trimestre?: Trimestre;
  ejeId?: string;
  institucionId?: string;
  tipoInstitucion?: Pg2030InstitucionTipo;
};

/** Last calendar month of `anio` that has finished in Galápagos (0 if none, 12 if the year is over). */
function ultimoMesTerminado(anio: number, now: Date): number {
  let last = 0;
  for (let mes = 1; mes <= 12; mes++) {
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    if (now >= finDelDia(`${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`)) last = mes;
  }
  return last;
}

function vacio(resumenPlan: Pg2030Dashboard["resumenPlan"], ejes: Pg2030Dashboard["ejes"]): Pg2030Dashboard {
  const cero = { planificado: 0, computable: 0, devengado: 0, avance: null, semaforo: null, metas: 0 };
  return {
    anio: null,
    corte: null,
    leyenda: LEYENDA,
    resumenPlan,
    ejes,
    planificacion: { convocadas: 0, conMetas: 0, sinAcciones: 0, sinRespuesta: 0, institucionesSinRespuesta: [], metas: 0, metasConPresupuesto: 0 },
    cumplimiento: { obligadas: 0, cumplio: 0, parcial: 0, noCumplio: 0, aReportar: 0, reportadas: 0 },
    alineacion: { categorias: [], porEje: [] },
    avanceFisico: { valor: null, semaforo: null },
    presupuesto: {
      total: cero,
      porFuente: [],
      metasAReportarConPresupuesto: 0,
      metasConPresupuestoReportadas: 0,
      presupuestoSinReporte: { planificado: 0, proporcion: null },
      institucionesPorSemaforo: { verde: 0, amarillo: 0, rojo: 0, sin_avance: 0, sin_presupuesto: 0 },
    },
    coherenciaConteo: { coherente: 0, sin_financiamiento: 0, incoherencia_brecha: 0, no_aplica: 0 },
    inversion: [],
    instituciones: [],
  };
}

/**
 * The dashboard for one cutoff (plan §10), every figure by the rules of §9.
 * A reporter only ever sees their own institution.
 */
export async function getDashboard(
  user: AccessTokenClaims,
  filtros: DashboardFiltros,
  { now = new Date() }: Clock = {},
): Promise<Pg2030Dashboard> {
  const db = getDb();
  const catalogo = await getCatalogo();
  const ejesCatalogo = catalogo.ejes.map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre }));
  const base = vacio(catalogo.resumen, ejesCatalogo);

  const [anioRow] = filtros.anio
    ? await db.select().from(pg2030Anios).where(eq(pg2030Anios.anio, filtros.anio)).limit(1)
    : await db.select().from(pg2030Anios).orderBy(desc(pg2030Anios.anio)).limit(1);
  if (!anioRow) return base;
  const cfg = toAnioCortes(anioRow);
  const anio = cfg.anio;

  // Default cutoff: the one holding the last finished month (or the first habilitated).
  const terminado = ultimoMesTerminado(anio, now);
  const porDefecto = Math.max(cfg.primerCorte, Math.ceil(Math.max(terminado, 1) / 3)) as Trimestre;
  const trimestre = filtros.trimestre ?? porDefecto;
  const habilitado = corteHabilitado(cfg, trimestre);
  const cerrado = corteCerrado(cfg, trimestre, now);
  const hasta = !habilitado ? 0 : cerrado ? 3 * trimestre : Math.min(3 * trimestre, terminado);
  const exigidos = mesesDeTrimestre(trimestre).filter((m) => m <= hasta);

  // Institutions in scope: the reporter's own, or the filters'.
  let institucionId = filtros.institucionId;
  if (user.role === "REPORTER") {
    const [link] = await db
      .select({ institucionId: pg2030UsuarioInstitucion.institucionId })
      .from(pg2030UsuarioInstitucion)
      .where(eq(pg2030UsuarioInstitucion.userId, user.sub))
      .limit(1);
    institucionId = link?.institucionId ?? "00000000-0000-0000-0000-000000000000";
  }
  const instituciones = (await db.select().from(pg2030Instituciones)).filter(
    (i) => (!institucionId || i.id === institucionId) && (!filtros.tipoInstitucion || i.tipo === filtros.tipoInstitucion),
  );
  const instIds = instituciones.map((i) => i.id);

  const result: Pg2030Dashboard = {
    ...base,
    anio: toAnio(anioRow, now),
    corte: { trimestre, habilitado, estado: estadoCorte(cfg, trimestre, now), hasta, enCurso: habilitado && !cerrado },
  };
  if (instIds.length === 0) return result;

  // Chart 2 — the year's call. The axis filter never changes these counts (§10).
  const [convocadas, declaraciones] = await Promise.all([
    db.select().from(pg2030Convocatorias).where(and(eq(pg2030Convocatorias.anio, anio), inArray(pg2030Convocatorias.institucionId, instIds))),
    db.select().from(pg2030SinAcciones).where(and(eq(pg2030SinAcciones.anio, anio), inArray(pg2030SinAcciones.institucionId, instIds))),
  ]);

  // Goals of the year, with their axis.
  const metasRows = await db
    .select({ meta: pg2030MetasInstitucionales, proyectoCodigo: pg2030Proyectos.codigo, ejeId: pg2030Ejes.id, ejeCodigo: pg2030Ejes.codigo })
    .from(pg2030MetasInstitucionales)
    .innerJoin(pg2030Proyectos, eq(pg2030Proyectos.id, pg2030MetasInstitucionales.proyectoId))
    .innerJoin(pg2030MetasPlan, eq(pg2030MetasPlan.id, pg2030Proyectos.metaPlanId))
    .innerJoin(pg2030Estrategias, eq(pg2030Estrategias.id, pg2030MetasPlan.estrategiaId))
    .innerJoin(pg2030Politicas, eq(pg2030Politicas.id, pg2030Estrategias.politicaId))
    .innerJoin(pg2030Objetivos, eq(pg2030Objetivos.id, pg2030Politicas.objetivoId))
    .innerJoin(pg2030Ejes, eq(pg2030Ejes.id, pg2030Objetivos.ejeId))
    .where(and(eq(pg2030MetasInstitucionales.anio, anio), inArray(pg2030MetasInstitucionales.institucionId, instIds)));
  const conMetaIds = new Set(metasRows.map((r) => r.meta.institucionId));
  const enEje = metasRows.filter((r) => !filtros.ejeId || r.ejeId === filtros.ejeId);

  const metaIds = enEje.map((r) => r.meta.id);
  const [mesesRows, solicitudes] = await Promise.all([
    metaIds.length === 0 ? [] : db.select().from(pg2030MetaMeses).where(inArray(pg2030MetaMeses.metaId, metaIds)),
    solicitudesDe(db, metaIds),
  ]);
  const mesesPorMeta = new Map<string, typeof mesesRows>();
  for (const m of mesesRows) mesesPorMeta.set(m.metaId, [...(mesesPorMeta.get(m.metaId) ?? []), m]);

  // The deadline that picks each institution's classification (§8): only for a closed cutoff.
  const limiteClasificacion = new Map<string, Date | null>();
  for (const id of instIds) {
    if (!habilitado || !cerrado) {
      limiteClasificacion.set(id, null);
      continue;
    }
    const reaperturas = await reaperturasHasta(db, anio, id);
    limiteClasificacion.set(id, finDelDia(plazoEfectivo(cfg, trimestre, reaperturas.get(trimestre) ?? null)));
  }

  const declaradas = new Set(declaraciones.map((d) => d.institucionId));
  const convocadaIds = new Set(convocadas.map((c) => c.institucionId));
  const sinRespuesta = instituciones.filter((i) => convocadaIds.has(i.id) && !conMetaIds.has(i.id) && !declaradas.has(i.id));
  const presupuestoAnual = (id: string) => (mesesPorMeta.get(id) ?? []).reduce((s, m) => s + Number(m.presupuestoPlanificado), 0);
  result.planificacion = {
    convocadas: convocadaIds.size,
    conMetas: instituciones.filter((i) => conMetaIds.has(i.id)).length,
    sinAcciones: declaradas.size,
    sinRespuesta: sinRespuesta.length,
    institucionesSinRespuesta: sinRespuesta.map((i) => ({ id: i.id, nombre: i.nombre, sigla: i.sigla })),
    metas: enEje.length,
    metasConPresupuesto: enEje.filter((r) => presupuestoAnual(r.meta.id) > 0).length,
  };
  if (!habilitado) return result;

  // Every goal at the cutoff.
  type Calc = { row: (typeof enEje)[number]; calc: MetaAlCorte; vista: Pg2030DashboardMeta };
  const calcs: Calc[] = enEje.map((row) => {
    const meses = (mesesPorMeta.get(row.meta.id) ?? []).map((m) => ({
      mes: m.mes,
      fisicoPlanificado: Number(m.fisicoPlanificado),
      presupuestoPlanificado: Number(m.presupuestoPlanificado),
      fisicoEjecutado: m.fisicoEjecutado === null ? null : Number(m.fisicoEjecutado),
      presupuestoDevengado: m.presupuestoDevengado === null ? null : Number(m.presupuestoDevengado),
      reportado: m.reportadoAt !== null,
    }));
    const calc = metaAlCorte(meses, hasta, exigidos);
    const cuenta = calc.aReportar && calc.reportada;
    return {
      row,
      calc,
      vista: {
        id: row.meta.id,
        nombre: row.meta.nombre,
        unidadMedida: row.meta.unidadMedida,
        proyectoCodigo: row.proyectoCodigo,
        ejeCodigo: row.ejeCodigo,
        fuenteFinanciamiento: row.meta.fuenteFinanciamiento,
        aReportar: calc.aReportar,
        reportada: calc.reportada,
        cuenta,
        fisico: { ...calc.fisico, semaforo: calc.fisico.avance === null ? null : semaforo(calc.fisico.avance) },
        presupuesto: { ...calc.presupuesto, semaforo: calc.presupuesto.avance === null ? null : semaforo(calc.presupuesto.avance) },
        clasificacion: clasificacionAlCorte(solicitudes.get(row.meta.id), limiteClasificacion.get(row.meta.institucionId) ?? null),
      },
    };
  });
  const cuentan = calcs.filter((c) => c.vista.cuenta);
  const aReportar = calcs.filter((c) => c.calc.aReportar);

  // Per institution: charts 3, 5 and 7, and the detail.
  const porInstitucion: Pg2030DashboardInstitucion[] = instituciones
    .map((inst) => {
      const suyas = calcs.filter((c) => c.row.meta.institucionId === inst.id);
      const suyasCuentan = suyas.filter((c) => c.vista.cuenta);
      const agg = institucionAlCorte(suyasCuentan.map((c) => c.calc));
      const nAReportar = suyas.filter((c) => c.calc.aReportar).length;
      const nReportadas = suyas.filter((c) => c.calc.aReportar && c.calc.reportada).length;
      return {
        institucion: { id: inst.id, nombre: inst.nombre, sigla: inst.sigla, tipo: inst.tipo as Pg2030InstitucionTipo },
        aReportar: nAReportar,
        reportadas: nReportadas,
        cumplimiento: nAReportar > 0 ? nReportadas / nAReportar : null,
        estadoReporte: estadoReporte(nAReportar, nReportadas),
        fisico: { valor: agg.fisico, semaforo: agg.fisico === null ? null : semaforo(agg.fisico) },
        presupuesto: {
          valor: agg.presupuesto,
          semaforo: agg.presupuesto === null ? null : semaforo(agg.presupuesto),
          sinPresupuesto: agg.sinPresupuesto,
        },
        coherencia: agg.coherencia,
        cuenta: suyasCuentan.length > 0,
        metas: suyas.map((c) => c.vista),
      };
    })
    .filter((i) => i.metas.length > 0)
    .sort((a, b) => a.institucion.sigla.localeCompare(b.institucion.sigla));
  result.instituciones = porInstitucion;

  // Chart 3 — reporting compliance.
  result.cumplimiento = {
    obligadas: porInstitucion.filter((i) => i.estadoReporte !== "no_obligada").length,
    cumplio: porInstitucion.filter((i) => i.estadoReporte === "cumplio").length,
    parcial: porInstitucion.filter((i) => i.estadoReporte === "parcial").length,
    noCumplio: porInstitucion.filter((i) => i.estadoReporte === "no_cumplio").length,
    aReportar: aReportar.length,
    reportadas: aReportar.filter((c) => c.calc.reportada).length,
  };

  // Chart 4 — alignment by axis, counting goals that were reported.
  const contribucionDe = (c: Calc) => c.vista.clasificacion.contribucion ?? PENDIENTE;
  const hayPendientes = cuentan.some((c) => contribucionDe(c) === PENDIENTE);
  const categorias = [...CONTRIBUCIONES, ...(hayPendientes ? [PENDIENTE] : [])];
  result.alineacion = {
    categorias,
    porEje: ejesCatalogo
      .filter((e) => !filtros.ejeId || e.id === filtros.ejeId)
      .map((eje) => {
        const delEje = cuentan.filter((c) => c.row.ejeId === eje.id);
        return {
          eje,
          total: delEje.length,
          porCategoria: Object.fromEntries(categorias.map((cat) => [cat, delEje.filter((c) => contribucionDe(c) === cat).length])),
        };
      }),
  };

  // Chart 5 — physical progress: simple average of the institutional averages.
  const fisicos = porInstitucion.flatMap((i) => (i.cuenta && i.fisico.valor !== null ? [i.fisico.valor] : []));
  const avg = promedio(fisicos);
  result.avanceFisico = { valor: avg, semaforo: avg === null ? null : semaforo(avg) };

  // Chart 6 — budget by funding source, in dollars.
  const conPresupuestoAReportar = aReportar.filter((c) => c.calc.presupuesto.planificado > 0);
  const sinReporte = conPresupuestoAReportar.filter((c) => !c.calc.reportada);
  const planificadoAReportar = conPresupuestoAReportar.reduce((s, c) => s + c.calc.presupuesto.planificado, 0);
  const planificadoSinReporte = sinReporte.reduce((s, c) => s + c.calc.presupuesto.planificado, 0);
  const institucionesPorSemaforo: Record<Pg2030Semaforo | "sin_presupuesto", number> = {
    verde: 0, amarillo: 0, rojo: 0, sin_avance: 0, sin_presupuesto: 0,
  };
  for (const i of porInstitucion.filter((x) => x.cuenta)) {
    if (i.presupuesto.sinPresupuesto || !i.presupuesto.semaforo) institucionesPorSemaforo.sin_presupuesto += 1;
    else institucionesPorSemaforo[i.presupuesto.semaforo] += 1;
  }
  const fuentes = [...FUENTES, ...new Set(cuentan.map((c) => c.row.meta.fuenteFinanciamiento ?? "Sin fuente").filter((f) => !FUENTES.includes(f)))];
  result.presupuesto = {
    total: dinero(cuentan.map((c) => c.calc)),
    porFuente: fuentes.map((fuente) => ({
      fuente,
      dinero: dinero(cuentan.filter((c) => (c.row.meta.fuenteFinanciamiento ?? "Sin fuente") === fuente).map((c) => c.calc)),
    })),
    metasAReportarConPresupuesto: conPresupuestoAReportar.length,
    metasConPresupuestoReportadas: conPresupuestoAReportar.length - sinReporte.length,
    presupuestoSinReporte: {
      planificado: planificadoSinReporte,
      proporcion: planificadoAReportar > 0 ? planificadoSinReporte / planificadoAReportar : null,
    },
    institucionesPorSemaforo,
  };

  // Chart 7 — coherence counts over the institutions that appear in it.
  const coherenciaConteo: Record<Pg2030Coherencia, number> = { coherente: 0, sin_financiamiento: 0, incoherencia_brecha: 0, no_aplica: 0 };
  for (const i of porInstitucion.filter((x) => x.cuenta)) coherenciaConteo[i.coherencia] += 1;
  result.coherenciaConteo = coherenciaConteo;

  // Chart 8 — budget by investment type (the AI's), split by funding source.
  const tipoDe = (c: Calc) => c.vista.clasificacion.tipoInversion ?? PENDIENTE;
  const tipos = [...TIPOS_INVERSION, ...(cuentan.some((c) => tipoDe(c) === PENDIENTE) ? [PENDIENTE] : [])];
  result.inversion = tipos
    .map((tipo) => {
      const delTipo = cuentan.filter((c) => tipoDe(c) === tipo);
      return {
        tipo,
        total: dinero(delTipo.map((c) => c.calc)),
        porFuente: fuentes.map((fuente) => ({
          fuente,
          dinero: dinero(delTipo.filter((c) => (c.row.meta.fuenteFinanciamiento ?? "Sin fuente") === fuente).map((c) => c.calc)),
        })),
      };
    })
    .filter((t) => t.total.metas > 0);

  return result;
}

