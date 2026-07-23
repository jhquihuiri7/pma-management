export type UserRole = 'ADMIN' | 'REPORTER' | 'VIEWER';
export type AppKey = "pma" | "rgdp" | "geo";

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

export const PLAN_TIPO_VALUES = ["Licencia", "Registro Ambiental","N/A"] as const;
export type PlanTipo = typeof PLAN_TIPO_VALUES[number];

export const PLAN_FASE_VALUES = ["Planificación", "Construcción", "Operación", "Cierre"] as const;
export type PlanFase = typeof PLAN_FASE_VALUES[number];

export const PLAN_ENFOQUE_VALUES = ["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"] as const;
export type PlanEnfoque = typeof PLAN_ENFOQUE_VALUES[number];

export interface Plan {
  id: string;
  adminId: string | null;
  createdBy?: string | null;
  title: string;
  description: string;
  tipo?: PlanTipo | null;
  fase?: PlanFase | null;
  enfoque?: PlanEnfoque | null;
  report_per: PlanReporte;
  start_date?: string | null;
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
