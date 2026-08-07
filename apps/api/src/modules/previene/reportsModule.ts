import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { previeneReports, previeneMedia, previeneEventTypes } from "../../db/schema/previene.js";
import { isPrevieneConfigured } from "./client.js";
import { getSyncState } from "./syncModule.js";
import { env } from "../../lib/env.js";

/**
 * Read side of the module: everything the browser sees comes from the local
 * cache, in one request per page load. The viewer never triggers a walk of the
 * upstream catalog, and never talks to the reports API at all.
 */

export type ReportFilters = {
  desde?: Date | null;
  hasta?: Date | null;
  /** Event type codes. `INCIDENT` reports have no code and are selected by `clases`. */
  tipos?: string[] | null;
  /** EVENT | INCIDENT */
  clases?: string[] | null;
};

export type ReportMediaDto = {
  id: string;
  mediaType: string;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  caption: string | null;
  availability: string;
};

export type ReportDto = {
  id: string;
  reportKind: string;
  eventTypeCode: string | null;
  eventTypeName: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  description: string;
  submittedAt: string | null;
  media: ReportMediaDto[];
};

/**
 * Columns are listed explicitly rather than selecting the whole row. There is
 * no `reporter_id` column to leak, but an explicit projection also means a
 * column added upstream tomorrow cannot appear in the API response by accident.
 */
export async function listReports(filters: ReportFilters = {}): Promise<ReportDto[]> {
  const db = getDb();
  const conditions = [
    // The map is the primary view; a report without coordinates cannot be
    // placed, and the table would show a row the map can never reveal.
    isNotNull(previeneReports.latitude),
    isNotNull(previeneReports.longitude),
  ];

  // `submitted_at` is nullable upstream. Filtering and ordering on it directly
  // makes those reports invisible under ANY range while still being counted in
  // `totalReports` — an unreconcilable "12 de 47" — and puts them first under a
  // descending sort, because NULL sorts highest in Postgres. `remote_updated_at`
  // is NOT NULL, so the fallback chain always yields a value.
  const effectiveDate = sql`coalesce(${previeneReports.submittedAt}, ${previeneReports.remoteCreatedAt}, ${previeneReports.remoteUpdatedAt})`;

  if (filters.desde) conditions.push(sql`${effectiveDate} >= ${filters.desde}`);
  if (filters.hasta) conditions.push(sql`${effectiveDate} <= ${filters.hasta}`);

  const clases = filters.clases?.filter(Boolean) ?? [];
  if (clases.length > 0) conditions.push(inArray(previeneReports.reportKind, clases));

  const tipos = filters.tipos?.filter(Boolean) ?? [];
  if (tipos.length > 0) {
    // Type filtering applies to events only. Incidents carry no type, so they
    // are governed by the class filter and must not be dropped here.
    conditions.push(
      sql`(${previeneReports.eventTypeCode} is null or ${previeneReports.eventTypeCode} in ${tipos})`
    );
  }

  const rows = await db
    .select({
      id: previeneReports.id,
      reportKind: previeneReports.reportKind,
      eventTypeCode: previeneReports.eventTypeCode,
      eventTypeName: previeneReports.eventTypeName,
      latitude: previeneReports.latitude,
      longitude: previeneReports.longitude,
      locationAccuracy: previeneReports.locationAccuracy,
      description: previeneReports.description,
      submittedAt: previeneReports.submittedAt,
    })
    .from(previeneReports)
    .where(and(...conditions))
    .orderBy(sql`${effectiveDate} desc`);

  if (rows.length === 0) return [];

  const mediaRows = await db
    .select({
      id: previeneMedia.id,
      reportId: previeneMedia.reportId,
      mediaType: previeneMedia.mediaType,
      mimeType: previeneMedia.mimeType,
      fileSize: previeneMedia.fileSize,
      width: previeneMedia.width,
      height: previeneMedia.height,
      durationSeconds: previeneMedia.durationSeconds,
      caption: previeneMedia.caption,
      availability: previeneMedia.availability,
    })
    .from(previeneMedia)
    .where(inArray(previeneMedia.reportId, rows.map((r) => r.id)))
    .orderBy(asc(previeneMedia.remoteCreatedAt), asc(previeneMedia.id));

  const byReport = new Map<string, ReportMediaDto[]>();
  for (const m of mediaRows) {
    const list = byReport.get(m.reportId) ?? [];
    list.push({
      id: m.id,
      mediaType: m.mediaType,
      mimeType: m.mimeType,
      fileSize: m.fileSize,
      width: m.width,
      height: m.height,
      durationSeconds: m.durationSeconds,
      caption: m.caption,
      availability: m.availability,
    });
    byReport.set(m.reportId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    reportKind: r.reportKind,
    eventTypeCode: r.eventTypeCode,
    eventTypeName: r.eventTypeName,
    latitude: r.latitude,
    longitude: r.longitude,
    locationAccuracy: r.locationAccuracy,
    description: r.description,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    media: byReport.get(r.id) ?? [],
  }));
}

/**
 * Catalog for legend, filter and palette. Falls back to the distinct types
 * observed in cached reports so a fresh install with an unreachable
 * /v1/event-types still renders a usable legend.
 */
export async function listEventTypes(): Promise<Array<{ code: string; name: string; count: number }>> {
  const db = getDb();
  // The WHOLE catalog, not just the active rows. `active` decides which types
  // are OFFERED, never whether their name is known: filtering here made a
  // deactivated type fall through to the "unknown code" branch below and show
  // up as the raw `TSUNAMI` instead of `Tsunami`.
  const catalog = await db
    .select({ code: previeneEventTypes.code, name: previeneEventTypes.name, active: previeneEventTypes.active })
    .from(previeneEventTypes)
    .orderBy(asc(previeneEventTypes.name));

  const counts = await db
    .select({ code: previeneReports.eventTypeCode, count: sql<number>`count(*)::int` })
    .from(previeneReports)
    .where(isNotNull(previeneReports.eventTypeCode))
    .groupBy(previeneReports.eventTypeCode);

  const countByCode = new Map(counts.map((c) => [c.code as string, Number(c.count)]));
  const known = new Map<string, string>();

  for (const t of catalog) {
    // A deactivated type is dropped only when nothing references it. While
    // reports still carry it, hiding it would leave them behind a filter nobody
    // can tick.
    if (t.active || (countByCode.get(t.code) ?? 0) > 0) known.set(t.code, t.name);
  }

  // A type seen in reports but missing from the catalog still deserves a row —
  // same reason, and here the code is genuinely all we know.
  for (const c of counts) {
    const code = c.code as string;
    if (!known.has(code)) known.set(code, code);
  }

  return [...known.entries()]
    .map(([code, name]) => ({ code, name, count: countByCode.get(code) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export type PrevieneStatus = {
  configured: boolean;
  lastSuccessAt: string | null;
  ageMinutes: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** True when the viewer must warn that it is showing cached data. */
  degraded: boolean;
  totalReports: number;
  syncIntervalMs: number;
};

export async function getPrevieneStatus(): Promise<PrevieneStatus> {
  const state = await getSyncState();
  const [{ total }] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(previeneReports);

  const ageMinutes = state.lastSuccessAt
    ? Math.max(0, Math.round((Date.now() - state.lastSuccessAt.getTime()) / 60_000))
    : null;

  // Stale after four missed cycles: long enough not to blink on one transient
  // failure, short enough that a genuinely dead upstream is visible.
  const staleAfterMs = env.PREVIENE_SYNC_INTERVAL_MS * 4;
  const stale = !state.lastSuccessAt || Date.now() - state.lastSuccessAt.getTime() > staleAfterMs;

  return {
    configured: isPrevieneConfigured(),
    lastSuccessAt: state.lastSuccessAt ? state.lastSuccessAt.toISOString() : null,
    ageMinutes,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt ? state.lastErrorAt.toISOString() : null,
    degraded: !isPrevieneConfigured() || Boolean(state.lastError) || stale,
    totalReports: Number(total ?? 0),
    syncIntervalMs: env.PREVIENE_SYNC_INTERVAL_MS,
  };
}

export type MediaRef = {
  id: string;
  contentPath: string;
  mediaType: string;
  mimeType: string | null;
  fileSize: number | null;
};

/**
 * Resolve a media id against OUR cache before touching upstream. An id we have
 * never ingested is a 404 here, which stops the proxy from being usable as an
 * open relay into the reports API.
 */
export async function findMediaById(mediaId: string): Promise<MediaRef | null> {
  const rows = await getDb()
    .select({
      id: previeneMedia.id,
      contentPath: previeneMedia.contentPath,
      mediaType: previeneMedia.mediaType,
      mimeType: previeneMedia.mimeType,
      fileSize: previeneMedia.fileSize,
    })
    .from(previeneMedia)
    .where(eq(previeneMedia.id, mediaId))
    .limit(1);
  return rows[0] ?? null;
}

export async function markMediaAvailability(mediaId: string, availability: "ok" | "gone"): Promise<void> {
  await getDb()
    .update(previeneMedia)
    .set({ availability, lastCheckedAt: new Date() })
    .where(eq(previeneMedia.id, mediaId));
}
