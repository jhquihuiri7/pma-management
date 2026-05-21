import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "REPORTER", "VIEWER"]);

export const appKeyEnum = pgEnum("app_key", ["pma", "rgdp", "geo"]);

export const planTipoEnum = pgEnum("plan_tipo", ["Licencia", "Registro Ambiental", "N/A"]);

export const planFaseEnum = pgEnum("plan_fase", [
  "Planificación",
  "Construcción",
  "Operación",
  "Cierre",
]);

export const planEnfoqueEnum = pgEnum("plan_enfoque", [
  "Prevenir impactos",
  "Controlar impactos",
  "Monitorear y optimizar",
  "Restaurar el ambiente",
]);

export const planReporteEnum = pgEnum("plan_reporte", ["6 meses", "1 año", "2 años"]);

export const zoneTypeEnum = pgEnum("zone_type", ["Urbana", "Rural", "Maritima", "Fluvial"]);

export const evidenceValidationStatusEnum = pgEnum("evidence_validation_status", [
  "pending",
  "valid",
  "invalid",
]);

export const findingComponentEnum = pgEnum("finding_component", [
  "LEGAL",
  "OPERACIONAL",
  "AMBIENTAL",
]);

export const periodComplianceStatusEnum = pgEnum("period_compliance_status", [
  "C",
  "NC+",
  "NC-",
  "N/A",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "evidence_submitted",
  "evidence_approved",
  "evidence_rejected",
  "generation_threshold_reached",
]);

export const itemAssignmentCategoryEnum = pgEnum("item_assignment_category", [
  "Responsable",
  "Colaborador",
]);

export const formatFunctionalityEnum = pgEnum("format_functionality", ["descargar_anexos"]);
