import {
  pgTable,
  uuid,
  text,
  timestamp,
  doublePrecision,
  integer,
  bigint,
  boolean,
  index,
} from "drizzle-orm/pg-core";

/**
 * Galápagos Previene — local cache of citizen reports.
 *
 * The reports themselves live in an external read-only API fed by a Telegram
 * bot. SIGTAR never lets the browser talk to that API (no CORS, loopback-only,
 * and every call needs a bearer key that must stay server-side), so this table
 * is the copy the viewer actually reads.
 *
 * `reporter_id` is intentionally not modelled. Upstream sends a stable
 * anonymous UUID per reporter; omitting the column makes the privacy promise
 * structural rather than a rule someone has to remember on each new query.
 */
export const previeneReports = pgTable(
  "previene_reports",
  {
    /** Upstream id — the upsert key that makes re-reading a report idempotent. */
    id: uuid("id").primaryKey(),
    reportKind: text("report_kind").notNull(), // EVENT | INCIDENT
    /** Null on INCIDENT: an incident is a different report class, not a type. */
    eventTypeCode: text("event_type_code"),
    eventTypeName: text("event_type_name"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationAccuracy: doublePrecision("location_accuracy"), // metres
    description: text("description").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    remoteCreatedAt: timestamp("remote_created_at", { withTimezone: true }),
    /** Upstream updated_at — drives the incremental cursor. */
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    cursorIdx: index("previene_reports_cursor_idx").on(t.remoteUpdatedAt, t.id),
    submittedIdx: index("previene_reports_submitted_idx").on(t.submittedAt),
    typeIdx: index("previene_reports_type_idx").on(t.eventTypeCode),
  })
);

/**
 * One row per photo/video. The bytes are NOT stored: they live on Telegram's
 * servers and are streamed through the API's media proxy on demand. What is
 * stored is enough to render a thumbnail card (type, size, dimensions) and to
 * authorize a proxy request without asking upstream first.
 */
export const previeneMedia = pgTable(
  "previene_media",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => previeneReports.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull(), // PHOTO | VIDEO
    /** Upstream-relative path, e.g. /v1/media/<id>/content. */
    contentPath: text("content_path").notNull(),
    mimeType: text("mime_type"),
    // bigint (not integer): a video can exceed the int4 ceiling.
    fileSize: bigint("file_size", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    caption: text("caption"),
    /** unknown | ok | gone — 'gone' after upstream answered 404 (Telegram expiry). */
    availability: text("availability").notNull().default("unknown"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    remoteCreatedAt: timestamp("remote_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    reportIdx: index("previene_media_report_idx").on(t.reportId),
  })
);

/**
 * Cached /v1/event-types. The catalog will grow, so legend, filter and palette
 * are derived from this table; unknown codes get a neutral colour and glyph
 * instead of disappearing from the map.
 */
export const previeneEventTypes = pgTable("previene_event_types", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Single-row cursor state. Persisted (not in-memory) so a restart resumes
 * instead of re-reading the whole catalog, and so the viewer can show how old
 * the cached data is when upstream goes quiet.
 */
export const previeneSyncState = pgTable("previene_sync_state", {
  id: text("id").primaryKey().default("default"),
  /**
   * Opaque cursor token, stored as text rather than a timestamp. Upstream
   * timestamps carry microseconds; a JS Date truncates to milliseconds, so
   * echoing a converted value back makes upstream resend the boundary report
   * forever. The raw string round-trips exactly.
   */
  sinceCursor: text("since_cursor"),
  cursorId: uuid("cursor_id"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastRunReports: integer("last_run_reports").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const PREVIENE_SYNC_STATE_ID = "default";
