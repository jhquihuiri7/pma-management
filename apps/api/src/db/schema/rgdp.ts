import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  date,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import {
  planTipoEnum,
  planFaseEnum,
  planEnfoqueEnum,
  planReporteEnum,
  zoneTypeEnum,
  evidenceValidationStatusEnum,
  findingComponentEnum,
  periodComplianceStatusEnum,
  notificationTypeEnum,
  itemAssignmentCategoryEnum,
  formatFunctionalityEnum,
} from "./enums.js";
import { admins, users } from "./shared.js";

export const rgdpPlans = pgTable(
  "rgdp_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    tipo: planTipoEnum("tipo"),
    fase: planFaseEnum("fase"),
    enfoque: planEnfoqueEnum("enfoque"),
    reportPer: planReporteEnum("report_per").notNull(),
    startDate: date("start_date"),
    visualizationUrl: text("visualization_url"),
    storagePath: text("storage_path"),
    location: jsonb("location"),
    ciiu: jsonb("ciiu"),
    zoneType: zoneTypeEnum("zone_type"),
    coordinateFormat: text("coordinate_format"),
    geographicArea: jsonb("geographic_area"),
    implantationArea: jsonb("implantation_area"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    adminIdx: index("rgdp_plans_admin_idx").on(t.adminId),
  })
);

export const rgdpPlanItems = pgTable(
  "rgdp_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => rgdpPlans.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    subplan: text("subplan").notNull(),
    direccion: text("direccion"),
    environmentalActivity: text("environmental_activity").notNull().default(""),
    identifiedEnvironmentalImpact: text("identified_environmental_impact").notNull().default(""),
    proposedMeasure: text("proposed_measure").notNull().default(""),
    indicator: text("indicator").notNull().default(""),
    verificationMethod: text("verification_method").notNull().default(""),
    periodicity: text("periodicity").notNull().default(""),
    budget: numeric("budget", { precision: 14, scale: 2 }).notNull().default("0"),
    reportPer: planReporteEnum("report_per").notNull(),
    observation: text("observation"),
    storagePath: text("storage_path"),
    wasteCode: text("waste_code"),
    wasteName: text("waste_name"),
    wasteDescription: text("waste_description"),
    crtib: text("crtib"),
    annualGenerationKg: numeric("annual_generation_kg", { precision: 14, scale: 3 }),
    generationOrigin: text("generation_origin"),
    selfManagement: boolean("self_management").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    planIdx: index("rgdp_plan_items_plan_idx").on(t.planId),
  })
);

export const rgdpPlanAssignments = pgTable(
  "rgdp_plan_assignments",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => rgdpPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planId, t.userId] }),
  })
);

export const rgdpItemAssignments = pgTable(
  "rgdp_item_assignments",
  {
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => rgdpPlanItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: itemAssignmentCategoryEnum("category").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planItemId, t.userId] }),
  })
);

export const rgdpEvidences = pgTable(
  "rgdp_evidences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => rgdpPlans.id, { onDelete: "cascade" }),
    planItemId: uuid("plan_item_id").references(() => rgdpPlanItems.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "set null" } as any),
    uploaderName: text("uploader_name").notNull(),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    storageUrl: text("storage_url"),
    description: text("description").notNull().default(""),
    validationStatus: evidenceValidationStatusEnum("validation_status").notNull().default("pending"),
    validationComment: text("validation_comment"),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    activityMonth: text("activity_month"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    planIdx: index("rgdp_evidences_plan_idx").on(t.planId),
    itemIdx: index("rgdp_evidences_item_idx").on(t.planItemId),
  })
);

export const rgdpFindings = pgTable(
  "rgdp_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => rgdpPlans.id, { onDelete: "cascade" }),
    component: findingComponentEnum("component").notNull(),
    nudosCriticos: text("nudos_criticos").notNull().default(""),
    alarmas: text("alarmas").notNull().default(""),
    riesgos: text("riesgos").notNull().default(""),
    propuestasSolucion: text("propuestas_solucion").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    planIdx: index("rgdp_findings_plan_idx").on(t.planId),
  })
);

export const rgdpPeriodCompliance = pgTable(
  "rgdp_period_compliance",
  {
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => rgdpPlanItems.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    status: periodComplianceStatusEnum("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planItemId, t.periodKey] }),
  })
);

export const rgdpMonthlyGenerations = pgTable(
  "rgdp_monthly_generations",
  {
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => rgdpPlanItems.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    generationKg: numeric("generation_kg", { precision: 14, scale: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.planItemId, t.periodKey] }),
  })
);

export const rgdpNotifications = pgTable(
  "rgdp_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    planId: uuid("plan_id").references(() => rgdpPlans.id, { onDelete: "cascade" }),
    planItemId: uuid("plan_item_id").references(() => rgdpPlanItems.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id").references(() => rgdpEvidences.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("rgdp_notifications_user_idx").on(t.userId),
  })
);

export const rgdpFormats = pgTable("rgdp_formats", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => admins.id, { onDelete: "cascade" }),
  functionality: formatFunctionalityEnum("functionality").notNull(),
  functionalityLabel: text("functionality_label").notNull(),
  storagePath: text("storage_path").notNull(),
  fileName: text("file_name").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});
