export type UserRole = 'ADMIN' | 'REPORTER' | 'VIEWER';
export type AppKey = "pma" | "rgdp" | "geo" | "previene";

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
