import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { userRoleEnum, appKeyEnum } from "./enums.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash"),
    passwordSet: boolean("password_set").notNull().default(false),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("VIEWER"),
    unit: text("unit"),
    position: text("position"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export const userApps = pgTable(
  "user_apps",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appKey: appKeyEnum("app_key").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.appKey] }),
  })
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("refresh_tokens_user_idx").on(table.userId),
    tokenIdx: index("refresh_tokens_token_idx").on(table.tokenHash),
  })
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: index("password_resets_token_idx").on(table.tokenHash),
  })
);

/** Durable outbox for files whose owning DB rows are removed by a cascade. */
export const storageCleanupJobs = pgTable(
  "storage_cleanup_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storagePath: text("storage_path").notNull().unique(),
    reason: text("reason").notNull(),
    isDirectory: boolean("is_directory").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("storage_cleanup_jobs_created_at_idx").on(table.createdAt),
    availableIdx: index("storage_cleanup_jobs_available_idx").on(table.availableAt),
  })
);

/** Transactional outbox: business commits never wait on SMTP or claim delivery. */
export const mailOutboxJobs = pgTable(
  "mail_outbox_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    textBody: text("text_body"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    availableIdx: index("mail_outbox_jobs_available_idx").on(table.availableAt),
  })
);

/** Shared, privacy-preserving fixed-window counters for public auth routes. */
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    attemptCount: integer("attempt_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index("auth_rate_limits_expires_at_idx").on(table.expiresAt),
  }),
);
