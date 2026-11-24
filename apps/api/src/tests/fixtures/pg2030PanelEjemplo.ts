import type { Pg2030Dashboard, Pg2030DashboardInstitucion, Pg2030Semaforo } from "@pma/types";
import { LEYENDA } from "../../modules/pg2030/dashboardModule.js";
import type { CamposInforme } from "../../modules/pg2030/informe/documento.js";

/**
 * A made-up closed first quarter, shaped as the dashboard payload: fictitious
 * institutions (ALFA, BETA…) and figures, never real ones (the repository is
 * public). Used by the report tests and to try a model by hand.
 */
export const sem = (v: number | null): Pg2030Semaforo | null => (v === null ? null : v >= 0.85 ? "verde" : v >= 0.7 ? "amarillo" : v > 0 ? "rojo" : "sin_avance");

export function inst(
  sigla: string,
  aReportar: number,
  reportadas: number,
  fisico: number | null,
  presupuesto: number | null,
  coherencia: Pg2030DashboardInstitucion["coherencia"],
): Pg2030DashboardInstitucion {
  const cuenta = reportadas > 0;
  return {
    institucion: { id: `id-${sigla}`, nombre: sigla, sigla, tipo: "Ejecutivo" },
    aReportar,
    reportadas,
    cumplimiento: aReportar ? reportadas / aReportar : null,
    estadoReporte: reportadas === aReportar ? "cumplio" : reportadas === 0 ? "no_cumplio" : "parcial",
    fisico: { valor: fisico, semaforo: sem(fisico) },
    presupuesto: { valor: presupuesto, semaforo: sem(presupuesto), sinPresupuesto: cuenta && presupuesto === null },
    coherencia,
    cuenta,
    metas: Array.from({ length: aReportar }, (_, i) => ({ cuenta: i < reportadas }) as Pg2030DashboardInstitucion["metas"][number]),
  };
}

export const dinero = (planificado: number, computable: number, metas: number) => {
  const avance = planificado > 0 ? computable / planificado : null;
  return { planificado, computable, devengado: computable, avance, semaforo: sem(avance), metas };
};

export function panelEjemplo(): Pg2030Dashboard {
  const eje = (id: string, codigo: string, nombre: string) => ({ id, codigo, nombre });
  // The Plan's axes are public (catalog of the Plan Galápagos 2030).
  const ejes = [
    eje("e-gob", "GOB", "Nuestra GOBERNANZA (G): Consolidando una ciudadanía empoderada y buen gobierno"),
    eje("e-com", "COM", "Nuestra COMUNIDAD (C): Generación de Bienestar y Calidad de Vida"),
    eje("e-ent", "ENT", "Nuestro ENTORNO (E): Custodios del valor patrimonial humano y natural de Galápagos"),
    eje("e-hab", "E.H", "Nuestro HÁBITAT (H): Territorios inclusivos y sostenibles"),
    eje("e-eco", "ECO", "Nuestra ECONOMIA (N): Impulso productivo, emprendimiento y oportunidades para todos"),
  ];
  const cat = (rel: number, comp: number, dir: number, sin: number) => ({
    "Contribución directa": dir,
    "Contribución complementaria": comp,
    "Alineación relativa": rel,
    "Sin alineación": sin,
  });
  return {
    anio: { anio: 2026, primerCorte: 1, fechaLimiteCarga: null, abiertoPorNombre: "Admin", createdAt: "2026-01-01", cortes: [] },
    corte: { trimestre: 1, habilitado: true, estado: "cerrado", hasta: 3, enCurso: false },
    leyenda: LEYENDA,
    resumenPlan: {} as Pg2030Dashboard["resumenPlan"],
    ejes,
    planificacion: {
      convocadas: 24,
      conMetas: 18,
      sinAcciones: 2,
      sinRespuesta: 4,
      institucionesSinRespuesta: ["PI", "CHI", "PSI", "TAU"].map((s) => ({ id: s, nombre: s, sigla: s })),
      metas: 52,
      metasConPresupuesto: 20,
    },
    cumplimiento: { obligadas: 11, cumplio: 7, parcial: 0, noCumplio: 4, aReportar: 26, reportadas: 17 },
    alineacion: {
      categorias: ["Contribución directa", "Contribución complementaria", "Alineación relativa", "Sin alineación"],
      porEje: [
        { eje: ejes[0], total: 0, porCategoria: cat(0, 0, 0, 0) },
        { eje: ejes[1], total: 5, porCategoria: cat(1, 3, 1, 0) },
        { eje: ejes[2], total: 4, porCategoria: cat(2, 0, 1, 1) },
        { eje: ejes[3], total: 5, porCategoria: cat(0, 2, 3, 0) },
        { eje: ejes[4], total: 3, porCategoria: cat(0, 2, 0, 1) },
      ],
    },
    avanceFisico: { valor: 0.8, semaforo: "amarillo" },
    presupuesto: {
      total: dinero(500000, 300000, 11),
      porFuente: [
        { fuente: "Corriente", dinero: dinero(60000, 57000, 4) },
        { fuente: "Inversión", dinero: dinero(440000, 243000, 7) },
        { fuente: "Cooperación", dinero: dinero(0, 0, 0) },
      ],
      metasAReportarConPresupuesto: 12,
      metasConPresupuestoReportadas: 11,
      presupuestoSinReporte: { planificado: 40000, proporcion: 0.08 },
      institucionesPorSemaforo: { verde: 3, amarillo: 0, rojo: 2, sin_avance: 0, sin_presupuesto: 2 },
    },
    coherenciaConteo: { coherente: 2, sin_financiamiento: 2, incoherencia_brecha: 3, no_aplica: 0 },
    inversion: [
      { tipo: "Servicios", total: dinero(320000, 170000, 6), porFuente: [] },
      { tipo: "Obras", total: dinero(180000, 130000, 5), porFuente: [] },
    ],
    instituciones: [
      inst("ALFA", 3, 3, 0.6, null, "sin_financiamiento"),
      inst("BETA", 1, 1, 1, 1, "coherente"),
      inst("GAMA", 5, 5, 0.9, 0.45, "incoherencia_brecha"),
      inst("DELTA", 2, 2, 0.75, 0.98, "incoherencia_brecha"),
      inst("SIGMA", 3, 3, 0.95, 0.88, "incoherencia_brecha"),
      inst("OMEGA", 2, 2, 1, null, "sin_financiamiento"),
      inst("KAPA", 1, 1, 0.4, 0.37, "coherente"),
      inst("IOTA", 3, 0, null, null, "no_aplica"),
      inst("LAMBDA", 2, 0, null, null, "no_aplica"),
      inst("OMICRON", 2, 0, null, null, "no_aplica"),
      inst("RHO", 2, 0, null, null, "no_aplica"),
    ],
  };
}

export const CAMPOS: CamposInforme = {
  numeroInforme: "CGREG-DGTAR-2026-099",
  fecha: "2026-04-15",
  oficiosMetas: "Oficio Nro. CGREG-P-2025-0001-OF, del 3 de noviembre de 2025",
  oficioAvances: "Oficio Nro. CGREG-P-2026-0002-OF, del 2 de marzo de 2026",
  fechaLimite: "2026-03-20",
  enlaceAnexo: "https://drive.example.org/matriz",
  observaciones: "La institución ALFA remitió la matriz sin la programación mensual de 3 metas.",
};
