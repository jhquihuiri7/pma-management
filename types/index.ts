export type UserRole = 'ADMIN' | 'REPORTER' | 'VIEWER';

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

export type PlanReporte = "6 meses" | "1 año" | "2 años";
export type PlanTipo = "Licencia" | "Registro Ambiental";
export type PlanFase = "Planificación" | "Construcción" | "Operación" | "Cierre";
export type PlanEnfoque = "Prevenir impactos" | "Controlar impactos" | "Monitorear y optimizar" | "Restaurar el ambiente";

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
  driveFolderId?: string;
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
  activityMonth?: string; // format: "YYYY-MM"
  createdAt: string;
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
  type: string;
  subplan: string;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  start_date: string;
  budget: number;
  report_per: PlanReporte;
  assignedUsers: ItemAssignment[];
  observation?: string;
  driveFolderId?: string;
  createdAt: string;
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
