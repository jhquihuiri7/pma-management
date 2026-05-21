export type UserRole = 'ADMIN' | 'REPORTER' | 'VIEWER';
export type AppKey = "pma" | "rgdp" | "geo";

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  passwordSet?: boolean;
  passwordSetToken?: string;
  passwordSetTokenExpiry?: string;
  role: UserRole;
  adminId: string;
  apps: AppKey[];
  unit?: string;
  position?: string;
  createdAt: string;
}

export interface Admin {
  id: string;
  email: string;
  name: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: number;
  driveRootFolderId: string;
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
  adminId: string;
  title: string;
  description: string;
  tipo?: PlanTipo;
  fase?: PlanFase;
  enfoque?: PlanEnfoque;
  report_per: PlanReporte;
  start_date?: string;
  visualization_url?: string;
  driveFolderId?: string;
  location?: {
    province: string;
    canton: string;
    parish: string;
    reference?: string;
  };
  ciiu?: {
    principal: { code: string; description: string };
    complementary1?: { code: string; description: string };
    complementary2?: { code: string; description: string };
  };
  zoneType?: "Urbana" | "Rural" | "Maritima" | "Fluvial";
  coordinateFormat?: string;
  geographicArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  };
  implantationArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  };
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

export interface Evidence {
  id: string;
  planId: string;
  planItemId?: string;
  uploadedBy: string;
  uploaderName: string;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  description: string;
  validationStatus: EvidenceValidationStatus;
  validationComment?: string;
  validatedBy?: string;
  validatedAt?: string;
  activityMonth?: string; // format: "YYYY-MM"
  createdAt: string;
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
  adminId: string;
  type: NotificationType;
  title: string;
  message: string;
  planId: string;
  planItemId?: string;
  evidenceId?: string;
  metadata?: Record<string, string>;
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
  direccion?: string;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  budget: number;
  report_per: PlanReporte;
  assignedUsers: ItemAssignment[];
  observation?: string;
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

export type FormatFunctionality = "descargar_anexos";

export interface Format {
  id: string;
  adminId: string;
  functionality: FormatFunctionality;
  functionalityLabel: string;
  driveFileId: string;
  driveUrl: string;
  fileName: string;
  formatsFolderId: string;
  uploadedAt: string;
}
