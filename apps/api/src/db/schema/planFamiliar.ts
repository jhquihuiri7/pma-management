import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FamilyEmergencyPlan } from "@pma/types";

export const familyEmergencyPlans = pgTable(
  "family_emergency_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull(),
    downloadHash: text("download_hash").notNull(),
    family: text("family").notNull(),
    island: text("island").notNull(),
    sector: text("sector").notNull(),
    phone: text("phone").notNull(),
    membersCount: integer("members_count").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    planJson: jsonb("plan_json").$type<FamilyEmergencyPlan>().notNull(),
    pdfStoragePath: text("pdf_storage_path").notNull(),
    sourceHash: text("source_hash").notNull(),
    consentVersion: text("consent_version").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    submissionIdx: uniqueIndex("family_emergency_plans_submission_idx").on(table.submissionId),
    storageIdx: uniqueIndex("family_emergency_plans_storage_idx").on(table.pdfStoragePath),
    createdIdx: index("family_emergency_plans_created_idx").on(table.createdAt),
    islandIdx: index("family_emergency_plans_island_idx").on(table.island),
    sourceIdx: index("family_emergency_plans_source_idx").on(table.sourceHash, table.createdAt),
  }),
);
