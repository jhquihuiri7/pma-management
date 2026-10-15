export type UserRole = 'ADMIN' | 'REPORTER' | 'VIEWER';
export type AppKey = "pma" | "rgdp" | "geo" | "previene" | "pg2030" | "plan_familiar";

export type FamilyPlanPriority = "Alta" | "Media" | "Baja";
export type FamilyPlanMoment = "Antes" | "Durante" | "Después";
export type FamilyPlanMapLayer = "Mapa" | "Satélite";

export interface FamilyEmergencyPlan {
  submissionId: string;
  family: string;
  island: string;
  sector: string;
  address: string;
  date: string;
  phone: string;
  altPhone: string;
  contact: string;
  contactPhone: string;
  meeting: string;
  noSignal: string;
  members: Array<{
    name: string;
    age: number;
    relation: string;
    phone: string;
    support: string;
    role: string;
  }>;
  pets: Array<{ name: string; keeper: string; needs: string }>;
  risks: Array<{
    type: string;
    effect: string;
    prevention: string;
    first: string;
    priority: FamilyPlanPriority;
  }>;
  routes: Array<{ situation: string; route: string; point: string; notice: string }>;
  sketch: string;
  reference: string;
  location: {
    lat: number;
    lng: number;
    snapshot: string;
    layer: FamilyPlanMapLayer;
  } | null;
  resources: Array<{
    item: string;
    status: "Sí" | "No";
    amount: string;
    location: string;
  }>;
  usefulPhones: string;
  actions: Array<{
    moment: FamilyPlanMoment;
    action: string;
    person: string;
  }>;
  practice: { date: string; exercise: string; person: string };
  signature: string;
  consent: true;
}

export interface FamilyPlanListItem {
  id: string;
  code: string;
  createdAt: string;
  family: string;
  island: string;
  sector: string;
  phone: string;
  membersCount: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  passwordSet?: boolean;
  role: UserRole;
  /** Present in authenticated-session payloads; omitted by management lists. */
  adminId?: string;
  apps: AppKey[];
  unit?: string | null;
  position?: string | null;
  createdAt: string;
  /** Management lists only: the REPORTER's PG2030 institution, if any. */
  pg2030Institucion?: Pg2030InstitucionRef | null;
}

export const PLAN_REPORTE_VALUES = ["6 meses", "1 año", "2 años"] as const;
export type PlanReporte = typeof PLAN_REPORTE_VALUES[number];

/** RGDP's permit categories. PMA uses `PMA_PLAN_TIPO_VALUES` instead. */
export const PLAN_TIPO_VALUES = ["Licencia", "Registro Ambiental","N/A"] as const;
export type PlanTipo = typeof PLAN_TIPO_VALUES[number];

/**
 * PMA's permit categories, which diverged from RGDP's in migration 0025. Each
 * one names the instrument of regularización ambiental in full — "Licencia
 * Ambiental", not the bare "Licencia", which did not say which licence — and
 * the opt-out reads "No Aplica" rather than the abbreviation "N/A", so the
 * stored value matches the category as the regulation names it.
 */
export const PMA_PLAN_TIPO_VALUES = [
  "Licencia Ambiental",
  "Registro Ambiental",
  "Certificado Ambiental",
  "No Aplica",
] as const;
export type PmaPlanTipo = typeof PMA_PLAN_TIPO_VALUES[number];

/**
 * Whether the instrument behind a PMA plan is still in force. Declared by an
 * administrator rather than derived — nothing computes it from a date — but no
 * longer only a label: 'Vencida' requires an `end_date`, and that date is where
 * the plan's calendar, reporting periods and charts stop. PMA-only, like
 * `PMA_PLAN_TIPO_VALUES` — RGDP plans have no equivalent and the API rejects
 * the field on RGDP routes.
 */
export const PMA_PLAN_ESTADO_VALUES = ["Vigente", "Vencida"] as const;
export type PmaPlanEstado = typeof PMA_PLAN_ESTADO_VALUES[number];

export const PLAN_FASE_VALUES = ["Planificación", "Construcción", "Operación", "Cierre"] as const;
export type PlanFase = typeof PLAN_FASE_VALUES[number];

export interface Plan {
  id: string;
  adminId: string | null;
  createdBy?: string | null;
  title: string;
  description: string;
  tipo?: PlanTipo | PmaPlanTipo | null;
  fase?: PlanFase | null;
  /** PMA only. Absent on RGDP plans, which have no vigencia. */
  estado?: PmaPlanEstado;
  /**
   * PMA only. Read-only here: it is flipped by
   * `POST /pma/plans/:planId/action-plan`, never by a plan update, so that no
   * transition exists without its `PmaActionPlanActivation` row.
   */
  actionPlanActive?: boolean;
  report_per: PlanReporte;
  start_date?: string | null;
  /**
   * PMA only. Last day the plan was in force, set with `estado: "Vencida"` and
   * cleared on the way back to "Vigente". Non-null caps the calendar: no month,
   * reporting period or chart column past the month it falls in — that month
   * included, since the plan was in force for part of it.
   */
  end_date?: string | null;
  visualization_url?: string | null;
  storagePath?: string | null;
  driveFolderId?: string;
  location?: {
    province: string;
    canton: string;
    parish: string;
    reference?: string;
  } | null;
  ciiu?: {
    principal: { code: string; description: string };
    complementary1?: { code: string; description: string };
    complementary2?: { code: string; description: string };
  } | null;
  zoneType?: "Urbana" | "Rural" | "Maritima" | "Fluvial" | null;
  coordinateFormat?: string | null;
  geographicArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  } | null;
  implantationArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  userId: string;
  planId: string;
  createdAt: string;
}

export type EvidenceValidationStatus = "pending" | "valid" | "invalid";

export const EVIDENCE_TYPE_VALUES = [
  "Informe",
  "Registro Fotográfico",
  "Certificado",
  "Acta",
  "Otros",
] as const;
export type EvidenceType = typeof EVIDENCE_TYPE_VALUES[number];

export interface Evidence {
  id: string;
  planId: string;
  planItemId?: string;
  uploadedBy: string | null;
  uploaderName: string;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  description: string;
  /** PMA only. RGDP evidence has no type; use PmaEvidence where it is required. */
  evidenceType?: EvidenceType;
  validationStatus: EvidenceValidationStatus;
  validationComment?: string;
  validatedBy?: string;
  validatedAt?: string;
  activityMonth?: string; // format: "YYYY-MM"
  createdAt: string;
}

/**
 * PMA evidence always carries a type: it is mandatory on upload and migration
 * 0016 backfilled every historical row, so the column is NOT NULL.
 */
export interface PmaEvidence extends Evidence {
  evidenceType: EvidenceType;
}

export type FindingComponent = "LEGAL" | "OPERACIONAL" | "AMBIENTAL";

export interface Finding {
  id: string;
  planId: string;
  component: FindingComponent;
  nudosCriticos: string;
  alarmas: string;
  riesgos: string;
  propuestasSolucion: string;
  createdByName: string;
  createdAt: string;
}

export type NotificationType =
  | "evidence_submitted"
  | "evidence_approved"
  | "evidence_rejected"
  | "generation_threshold_reached";

export interface AppNotification {
  id: string;
  userId: string;
  adminId?: string;
  type: NotificationType;
  title: string;
  message: string;
  planId: string | null;
  planItemId?: string | null;
  evidenceId?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: string | null;
  createdAt: string;
  expiresAt: string;
}

export type ItemAssignmentCategory = "Responsable" | "Colaborador";

export interface ItemAssignment {
  userId: string;
  category: ItemAssignmentCategory;
}

export interface PlanItem {
  id: string;
  planId: string;
  item: string;
  wasteCode?: string;
  wasteName?: string;
  wasteDescription?: string;
  crtib?: string;
  annualGenerationKg?: number;
  generationOrigin?: string;
  selfManagement?: boolean;
  subplan: string;
  direccion?: string | null;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  budget: number;
  report_per: PlanReporte;
  assignedUsers: ItemAssignment[];
  observation?: string | null;
  driveFolderId?: string;
  createdAt: string;
}

export type PeriodComplianceStatus = "C" | "NC+" | "NC-" | "N/A";

export interface PeriodCompliance {
  id: string;
  planId: string;
  planItemId: string;
  periodKey: string;
  status: PeriodComplianceStatus;
  updatedAt: string;
}

export interface MonthlyGeneration {
  id: string;
  planId: string;
  planItemId: string;
  periodKey: string; // YYYY-MM
  generationKg: number;
  updatedAt: string;
}

export interface RgdtWasteCatalogEntry {
  codigo: string;
  descripcion: string;
  crtib: string;
}

/** Canonical request used by RGDP for one catalog-backed waste item. */
export interface RgdpWastePlanItemInput {
  wasteCode: string;
  wasteName: string;
  wasteDescription?: string;
  crtib: string;
  annualGenerationKg: number;
  generationOrigin: string;
  selfManagement: boolean;
  observation?: string;
}

export interface BulkCreateFailure {
  index: number;
  message: string;
}

export interface BulkCreateResult<T> {
  created: number;
  failed: BulkCreateFailure[];
  items: T[];
}

export type FormatFunctionality = "descargar_anexos";

export interface Format {
  id: string;
  adminId: string;
  createdBy?: string | null;
  functionality: FormatFunctionality;
  functionalityLabel: string;
  driveFileId: string;
  driveUrl: string;
  storagePath?: string;
  fileName: string;
  formatsFolderId: string;
  uploadedAt: string;
}

// ── PMA: notificación de actividades pendientes ─────────────────────────────

/**
 * What the reporter sees in the status column of the email.
 *
 * The trigger for chasing a period is that it has no row in
 * `pma_period_compliance` — nobody has graded it. This status is informative
 * only: it summarises the evidence attached to that period so the reporter
 * knows whether anything is actually missing on their side.
 */
export type PendingActivityStatus =
  | "Sin entregar"
  | "Rechazado"
  | "Pendiente de revisión"
  | "Entregado, sin calificar";

export interface PendingActivity {
  planItemId: string;
  itemCode: string;
  medida: string;
  direccion: string;
  periodicidad: string;
  /** Last month of the reporting period, "YYYY-MM". */
  limitMonthKey: string;
  /** Last month of the reporting period, e.g. "ago 2026". */
  limitMonth: string;
  status: PendingActivityStatus;
}

export interface PendingReporter {
  reporterId: string;
  name: string;
  email: string;
  /** Direcciones of the reporter's pending items, joined with " / ". */
  direccion: string;
  activities: PendingActivity[];
}

export interface PendingPeriodCount {
  key: string;
  label: string;
  pending: number;
}

/** Payload of `GET /pma/plans/:planId/pending-notifications`. */
export interface PendingNotificationsPayload {
  planId: string;
  planTitle: string;
  /** Echo of the resolved period; the newest one when the caller sent none. */
  periodKey: string;
  periods: PendingPeriodCount[];
  reporters: PendingReporter[];
}

export interface PendingNotificationFailure {
  reporterId: string;
  name: string;
  email: string;
  message: string;
}

/** Payload of `POST /pma/plans/:planId/pending-notifications`. */
export interface PendingNotificationsResult {
  ok: true;
  /** Reporters whose email was accepted by the SMTP server. */
  sent: number;
  /** Reporters the request tried to notify. */
  total: number;
  activities: number;
  ccCount: number;
  periodKey: string;
  failures: PendingNotificationFailure[];
}

/**
 * One transition of a plan's Plan de Acción. Activations and deactivations are
 * both recorded, so a plan's history is the whole cycle and not just its
 * current state.
 */
export interface PmaActionPlanActivation {
  id: string;
  planId: string;
  /** True for an activation, false for a deactivation. */
  active: boolean;
  reason: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  createdAt: string;
}

/** Payload of `GET /pma/plans/:planId/action-plan`. */
export interface PmaActionPlanPayload {
  planId: string;
  active: boolean;
  /** Newest transition first. */
  activations: PmaActionPlanActivation[];
}

/** Payload of `POST /pma/plans/:planId/action-plan`. */
export interface PmaActionPlanResult {
  ok: true;
  active: boolean;
  activation: PmaActionPlanActivation;
}

// ---------------------------------------------------------------------------
// PG2030 — seguimiento al Plan Galápagos 2030
// ---------------------------------------------------------------------------

export const PG2030_PROYECTO_TIPO_VALUES = ["Acción", "Proyecto"] as const;
export type Pg2030ProyectoTipo = typeof PG2030_PROYECTO_TIPO_VALUES[number];

export const PG2030_PRESUPUESTO_ESTADO_VALUES = [
  "Monto",
  "SPI",
  "No disponible",
  "A definirse en la LISS",
  "Sin dato",
] as const;
export type Pg2030PresupuestoEstado = typeof PG2030_PRESUPUESTO_ESTADO_VALUES[number];

export const PG2030_INSTITUCION_TIPO_VALUES = ["Ejecutivo", "GAD", "Otro"] as const;
export type Pg2030InstitucionTipo = typeof PG2030_INSTITUCION_TIPO_VALUES[number];

/** A project field that differed between rows of the imported matrix. */
export interface Pg2030Conflicto {
  id: string;
  campo: string;
  valorUsado: string | null;
  valoresAlternativos: string[];
  revisado: boolean;
  revisadoPorNombre: string | null;
  revisadoAt: string | null;
}

export interface Pg2030Proyecto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: Pg2030ProyectoTipo;
  plazo: string | null;
  presupuestoEstado: Pg2030PresupuestoEstado;
  /** Present exactly when `presupuestoEstado` is "Monto". */
  presupuestoReferencial: number | null;
  tipoEntidadResponsable: string | null;
  responsablesPlan: string | null;
  entidadesEjecutoras: string | null;
  hito2023: string | null;
  hito2030: string | null;
  conflictos: Pg2030Conflicto[];
}

export interface Pg2030MetaPlan {
  id: string;
  codigo: string;
  texto: string;
  cuantificable: boolean;
  proyectos: Pg2030Proyecto[];
}

export interface Pg2030Estrategia {
  id: string;
  codigo: string;
  texto: string;
  metas: Pg2030MetaPlan[];
}

export interface Pg2030Politica {
  id: string;
  codigo: string;
  texto: string;
  estrategias: Pg2030Estrategia[];
}

export interface Pg2030Objetivo {
  id: string;
  codigo: string;
  texto: string;
  politicas: Pg2030Politica[];
}

export interface Pg2030Eje {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  objetivos: Pg2030Objetivo[];
}

/** Cuadro 1 of the dashboard: what the plan contains. */
export interface Pg2030CatalogoResumen {
  ejes: number;
  objetivos: number;
  politicas: number;
  estrategias: number;
  metas: number;
  metasCuantificables: number;
  proyectos: number;
  /** Distinct milestone texts, counted from the catalog (decision D4). */
  hitos2030: number;
  presupuesto: {
    proyectosConMonto: number;
    total: number;
    porEstado: Record<Pg2030PresupuestoEstado, number>;
  };
  conflictosPendientes: number;
}

/** Payload of `GET /pg2030/catalogo`. */
export interface Pg2030Catalogo {
  resumen: Pg2030CatalogoResumen;
  ejes: Pg2030Eje[];
}

export interface Pg2030InstitucionRef {
  id: string;
  nombre: string;
  sigla: string;
}

export interface Pg2030Institucion extends Pg2030InstitucionRef {
  tipo: Pg2030InstitucionTipo;
  activa: boolean;
  createdAt: string;
  updatedAt: string;
  usuarios: Array<{ id: string; name: string; email: string }>;
}

/** Payload of `GET /pg2030/me`. */
export interface Pg2030Me {
  role: UserRole;
  institucion: (Pg2030InstitucionRef & { tipo: Pg2030InstitucionTipo; activa: boolean }) | null;
  /**
   * Whether this user can write PG2030 data. A REPORTER without an
   * institution cannot, and the web shows them a notice instead.
   */
  puedeEscribir: boolean;
}

// PG2030 phases 2 and 3: years, cutoffs, institutional goals and monthly report.

export const PG2030_FUENTE_FINANCIAMIENTO_VALUES = ["Corriente", "Inversión", "Cooperación"] as const;
export type Pg2030FuenteFinanciamiento = typeof PG2030_FUENTE_FINANCIAMIENTO_VALUES[number];

export type Pg2030Trimestre = 1 | 2 | 3 | 4;
export type Pg2030EstadoCorte = "no_habilitado" | "abierto" | "en_carga" | "cerrado";

export interface Pg2030Corte {
  trimestre: Pg2030Trimestre;
  habilitado: boolean;
  /** Last day to complete it, before any initial load or reopening. */
  plazoBase: string;
  /** Last day for everyone: the base one, or the load deadline when in the load. */
  plazoCierre: string;
  enCarga: boolean;
  estado: Pg2030EstadoCorte;
}

export interface Pg2030Anio {
  anio: number;
  primerCorte: Pg2030Trimestre;
  fechaLimiteCarga: string | null;
  abiertoPorNombre: string;
  createdAt: string;
  cortes: Pg2030Corte[];
}

export type Pg2030EstadoInstitucionAnio = "con_metas" | "sin_acciones" | "sin_respuesta" | "no_convocada";

/** One institution's standing in a year (cuadro 2 of the dashboard). */
export interface Pg2030InstitucionAnio {
  institucion: Pg2030InstitucionRef & { tipo: Pg2030InstitucionTipo; activa: boolean };
  convocada: boolean;
  metas: number;
  sinAcciones: { declaradoPorNombre: string; createdAt: string } | null;
  estado: Pg2030EstadoInstitucionAnio;
}

export interface Pg2030MetaMes {
  mes: number;
  fisicoPlanificado: number;
  presupuestoPlanificado: number;
  /** Null until the month is reported; a reported month may carry 0. */
  fisicoEjecutado: number | null;
  presupuestoDevengado: number | null;
  hitosAlcanzados: string | null;
  observaciones: string | null;
  reportadoAt: string | null;
  reportadoPorNombre: string | null;
  bloqueado: boolean;
  /** What the caller may do with this month right now. */
  puedePlanificar: boolean;
  puedeReportar: boolean;
}

export interface Pg2030MetaInstitucional {
  id: string;
  anio: number;
  institucion: Pg2030InstitucionRef;
  proyecto: { id: string; codigo: string; nombre: string; metaPlanCodigo: string };
  nombre: string;
  descripcion: string | null;
  unidadMedida: string;
  fuenteFinanciamiento: Pg2030FuenteFinanciamiento | null;
  beneficiariosDirectos: string | null;
  personalTecnico: string | null;
  responsablesInternos: string | null;
  entidadesCoordinacion: string | null;
  meses: Pg2030MetaMes[];
  /** Sums of the twelve months; an unreported month counts as 0. */
  totales: {
    fisicoPlanificado: number;
    presupuestoPlanificado: number;
    fisicoEjecutado: number;
    presupuestoDevengado: number;
  };
  /** AI classification in force (plan §8): read-only, nobody edits it. */
  clasificacion: Pg2030Clasificacion;
  creadoPorNombre: string;
  createdAt: string;
  updatedAt: string;
}

export const PG2030_CONTRIBUCION_VALUES = [
  "Contribución directa",
  "Contribución complementaria",
  "Alineación relativa",
  "Sin alineación",
] as const;
export type Pg2030Contribucion = typeof PG2030_CONTRIBUCION_VALUES[number];

export const PG2030_TIPO_INVERSION_VALUES = [
  "Adquisición de bienes",
  "Bienes-servicios",
  "Estudios",
  "Obras",
  "Servicios",
  "Contratación de personal",
  "Sin datos",
] as const;
export type Pg2030TipoInversion = typeof PG2030_TIPO_INVERSION_VALUES[number];

export interface Pg2030Clasificacion {
  /** "analizando" while queued; "pendiente_clasificacion" when the model never gave a valid answer. */
  estado: "analizando" | "clasificada" | "pendiente_clasificacion";
  contribucion: string | null;
  tipoInversion: string | null;
  actualizadaAt: string | null;
}

/** Payload of `GET /pg2030/metas?anio=&institucionId=`. */
export interface Pg2030MetasPayload {
  anio: Pg2030Anio;
  institucion: (Pg2030InstitucionRef & { tipo: Pg2030InstitucionTipo; activa: boolean }) | null;
  sinAcciones: { declaradoPorNombre: string; createdAt: string } | null;
  /** Whether the caller can create goals or change the declaration for this institution. */
  puedeEditar: boolean;
  metas: Pg2030MetaInstitucional[];
}

/** Payload of `PUT /pg2030/metas/:id/meses/:mes/ejecucion`. */
export interface Pg2030ReporteResultado {
  meta: Pg2030MetaInstitucional;
  /** The month looks cumulative (executed with nothing planned, or at twice the plan). */
  avisoAcumulado: boolean;
}

export interface Pg2030Reapertura {
  id: string;
  anio: number;
  trimestre: Pg2030Trimestre;
  institucion: Pg2030InstitucionRef;
  fechaLimite: string;
  motivo: string;
  creadoPorNombre: string;
  createdAt: string;
  vigente: boolean;
}

export type Pg2030BitacoraAccion = "reapertura" | "mes_modificado" | "meta_modificada" | "meta_eliminada";

export interface Pg2030BitacoraEntrada {
  id: string;
  anio: number;
  trimestre: Pg2030Trimestre;
  institucion: Pg2030InstitucionRef;
  metaId: string | null;
  accion: Pg2030BitacoraAccion;
  detalle: Record<string, unknown>;
  usuarioNombre: string;
  createdAt: string;
}

// PG2030 phase 5: dashboard (plan §9, §10). Fractions run 0–1.

export type Pg2030Semaforo = "verde" | "amarillo" | "rojo" | "sin_avance";
export type Pg2030Coherencia = "coherente" | "sin_financiamiento" | "incoherencia_brecha" | "no_aplica";
export type Pg2030EstadoReporte = "cumplio" | "parcial" | "no_cumplio" | "no_obligada";

/** Labels and colors defined once, in the API (plan §12), and sent with the data. */
export interface Pg2030Leyenda {
  semaforo: Record<Pg2030Semaforo, { label: string; color: string }>;
  coherencia: Record<Pg2030Coherencia, { label: string; color: string }>;
  contribucion: Array<{ key: string; label: string; color: string }>;
  serie: { planificado: string; devengado: string };
}

export interface Pg2030Avance {
  valor: number | null;
  semaforo: Pg2030Semaforo | null;
}

export interface Pg2030Dinero {
  planificado: number;
  /** min(accrued, planned) per goal: what the percentages use. */
  computable: number;
  /** Accrued as reported, uncapped (informative). */
  devengado: number;
  avance: number | null;
  semaforo: Pg2030Semaforo | null;
  metas: number;
}

export interface Pg2030DashboardMeta {
  id: string;
  nombre: string;
  unidadMedida: string;
  proyectoCodigo: string;
  ejeCodigo: string;
  fuenteFinanciamiento: string | null;
  aReportar: boolean;
  reportada: boolean;
  /** Counts in charts 4–8: a goal to report that was reported. */
  cuenta: boolean;
  fisico: { planificado: number; ejecutado: number; avance: number | null; semaforo: Pg2030Semaforo | null; estado: "calculable" | "sin_programacion" | "ejecutado_sin_programacion" };
  presupuesto: { planificado: number; devengado: number; computable: number; avance: number | null; semaforo: Pg2030Semaforo | null; estado: "calculable" | "no_aplica" | "devengado_sin_programacion" };
  clasificacion: Pg2030Clasificacion;
}

export interface Pg2030DashboardInstitucion {
  institucion: Pg2030InstitucionRef & { tipo: Pg2030InstitucionTipo };
  aReportar: number;
  reportadas: number;
  cumplimiento: number | null;
  estadoReporte: Pg2030EstadoReporte;
  fisico: Pg2030Avance;
  presupuesto: Pg2030Avance & { sinPresupuesto: boolean };
  coherencia: Pg2030Coherencia;
  /** Whether it appears in charts 5 and 7 (it has goals that count). */
  cuenta: boolean;
  metas: Pg2030DashboardMeta[];
}

/** Payload of `GET /pg2030/dashboard`. */
export interface Pg2030Dashboard {
  anio: Pg2030Anio | null;
  corte: {
    trimestre: Pg2030Trimestre;
    habilitado: boolean;
    estado: Pg2030EstadoCorte;
    /** Last month counted: the quarter's end, or the last finished month while it is open. */
    hasta: number;
    enCurso: boolean;
  } | null;
  leyenda: Pg2030Leyenda;
  resumenPlan: Pg2030CatalogoResumen;
  ejes: Array<{ id: string; codigo: string; nombre: string }>;
  planificacion: {
    convocadas: number;
    conMetas: number;
    sinAcciones: number;
    sinRespuesta: number;
    institucionesSinRespuesta: Pg2030InstitucionRef[];
    metas: number;
    metasConPresupuesto: number;
  };
  cumplimiento: {
    obligadas: number;
    cumplio: number;
    parcial: number;
    noCumplio: number;
    aReportar: number;
    reportadas: number;
  };
  alineacion: {
    categorias: string[];
    porEje: Array<{ eje: { id: string; codigo: string; nombre: string }; total: number; porCategoria: Record<string, number> }>;
  };
  avanceFisico: Pg2030Avance;
  presupuesto: {
    total: Pg2030Dinero;
    porFuente: Array<{ fuente: string; dinero: Pg2030Dinero }>;
    metasAReportarConPresupuesto: number;
    metasConPresupuestoReportadas: number;
    presupuestoSinReporte: { planificado: number; proporcion: number | null };
    institucionesPorSemaforo: Record<Pg2030Semaforo | "sin_presupuesto", number>;
  };
  coherenciaConteo: Record<Pg2030Coherencia, number>;
  inversion: Array<{ tipo: string; total: Pg2030Dinero; porFuente: Array<{ fuente: string; dinero: Pg2030Dinero }> }>;
  instituciones: Pg2030DashboardInstitucion[];
}
