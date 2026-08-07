import { eq, and, notInArray } from "drizzle-orm";
import { getDb, getPool } from "../../db/client.js";
import {
  previeneReports,
  previeneMedia,
  previeneEventTypes,
  previeneSyncState,
  PREVIENE_SYNC_STATE_ID,
} from "../../db/schema/previene.js";
import { env } from "../../lib/env.js";
import {
  fetchReportsPage,
  fetchEventTypes,
  isPrevieneConfigured,
  normalizeTimestamp,
  PrevieneApiError,
  type PrevieneRemoteReport,
} from "./client.js";

/**
 * Incremental ingestion of citizen reports.
 *
 * The whole design turns on one rule: a page's rows and the cursor that says
 * "these rows are done" are written in the SAME transaction. Persisting the
 * cursor after the data (as a naive implementation does) leaves a window where
 * a crash loses reports permanently; doing both atomically means a crash can
 * only ever cause a harmless re-read, which the upsert absorbs.
 */

/** Distinct from AUTHORIZATION_MUTATION_LOCK — different invariant, different key. */
export const PREVIENE_SYNC_LOCK = 9_042_027;

export type SyncResult =
  | { status: "ok"; reports: number; pages: number }
  | { status: "skipped"; reason: "not-configured" | "locked" }
  | { status: "error"; message: string; retryable: boolean; reports: number };

type SyncStateRow = {
  /** Raw upstream token, echoed back unchanged. */
  sinceCursor: string | null;
  cursorId: string | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  lastRunReports: number;
};

export async function getSyncState(): Promise<SyncStateRow> {
  const db = getDb();
  const rows = await db
    .select({
      sinceCursor: previeneSyncState.sinceCursor,
      cursorId: previeneSyncState.cursorId,
      lastSuccessAt: previeneSyncState.lastSuccessAt,
      lastErrorAt: previeneSyncState.lastErrorAt,
      lastError: previeneSyncState.lastError,
      lastRunReports: previeneSyncState.lastRunReports,
    })
    .from(previeneSyncState)
    .where(eq(previeneSyncState.id, PREVIENE_SYNC_STATE_ID))
    .limit(1);

  return (
    rows[0] ?? {
      sinceCursor: null,
      cursorId: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      lastRunReports: 0,
    }
  );
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Same normalisation the schema validates with, so an `updated_at` the
  // contract accepted can never become null here — which would break the
  // non-null cast in `toReportRow` from inside the page transaction.
  const d = new Date(normalizeTimestamp(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Map an upstream report onto our columns.
 *
 * `reporter_id` is dropped here and has no destination column. Anything the
 * mapper does not name cannot be persisted, which is what makes the privacy
 * guarantee survive future edits to this file.
 */
function toReportRow(remote: PrevieneRemoteReport) {
  // The schema already guarantees a parseable updated_at, so this cannot throw
  // from inside the page transaction — which would have rolled back the whole
  // page and left the sync wedged on it forever.
  const updatedAt = toDate(remote.updated_at) as Date;
  return {
    id: remote.id,
    reportKind: remote.report_kind,
    // An INCIDENT carries no event type: keep both columns null instead of
    // inventing a fourth pseudo-type.
    eventTypeCode: remote.event_type_code ?? null,
    eventTypeName: remote.event_type_name ?? null,
    latitude: remote.latitude ?? null,
    longitude: remote.longitude ?? null,
    locationAccuracy: remote.location_accuracy ?? null,
    description: remote.description ?? "",
    submittedAt: toDate(remote.submitted_at),
    remoteCreatedAt: toDate(remote.created_at),
    remoteUpdatedAt: updatedAt,
    syncedAt: new Date(),
  };
}

/**
 * Derive a cursor from the page just committed.
 *
 * Upstream stops sending `next` on the final page — verified against the
 * deployed API, whose `next` is exactly the last item's `(updated_at, id)`.
 * Without deriving it here the cursor would stay null forever and every cycle
 * would re-read the whole catalog: correct, but linear in the total number of
 * reports instead of in the new ones.
 *
 * The maximum is computed explicitly rather than taking the last element, so a
 * page that ever arrives unordered cannot move the cursor backwards.
 */
function cursorFromItems(
  items: PrevieneRemoteReport[]
): { since: string; cursorId: string } | null {
  let best: { since: string; cursorId: string; at: number } | null = null;
  for (const item of items) {
    const updated = toDate(item.updated_at);
    if (!updated) continue;
    const at = updated.getTime();
    // Ordered by millisecond then id. Ties below millisecond resolution can
    // only pick a slightly earlier item, which costs one harmless re-read —
    // never a skip. The stored value is the item's RAW timestamp string.
    if (!best || at > best.at || (at === best.at && item.id > best.cursorId)) {
      best = { since: item.updated_at, cursorId: item.id, at };
    }
  }
  return best ? { since: best.since, cursorId: best.cursorId } : null;
}

/**
 * Persist one page and its cursor atomically.
 *
 * Media is reconciled rather than blindly re-inserted: rows still present are
 * updated (preserving `availability`, so an evidence already known to be gone
 * from Telegram is not silently resurrected as "unknown"), and rows that
 * disappeared upstream are deleted.
 */
async function persistPage(
  items: PrevieneRemoteReport[],
  next: { since: string; cursorId: string } | null
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // No advisory lock here: the whole run holds one (see `withSyncLock`).
    // Taking a transaction-scoped lock on the same key from a pooled connection
    // would block for ever against the session that already holds it.
    for (const remote of items) {
      const row = toReportRow(remote);
      await tx
        .insert(previeneReports)
        .values(row)
        .onConflictDoUpdate({
          target: previeneReports.id,
          set: {
            reportKind: row.reportKind,
            eventTypeCode: row.eventTypeCode,
            eventTypeName: row.eventTypeName,
            latitude: row.latitude,
            longitude: row.longitude,
            locationAccuracy: row.locationAccuracy,
            description: row.description,
            submittedAt: row.submittedAt,
            remoteCreatedAt: row.remoteCreatedAt,
            remoteUpdatedAt: row.remoteUpdatedAt,
            syncedAt: row.syncedAt,
          },
        });

      // An ABSENT media key means upstream said nothing about evidence, which
      // is not the same as `media: []` — "this report has none". The whole
      // reconciliation is skipped on absence, deletion included: reconciling
      // against silence would wipe every stored evidence the day upstream trims
      // media from its list projection, and nothing would ever restore it.
      if (remote.media) {
        const mediaIds: string[] = [];
        for (const m of remote.media) {
          mediaIds.push(m.id);
          await tx
            .insert(previeneMedia)
            .values({
              id: m.id,
              reportId: remote.id,
              mediaType: m.media_type,
              contentPath: m.content_url,
              mimeType: m.mime_type ?? null,
              fileSize: m.file_size ?? null,
              width: m.width ?? null,
              height: m.height ?? null,
              durationSeconds: m.duration_seconds ?? null,
              caption: m.caption ?? null,
              remoteCreatedAt: toDate(m.created_at),
              syncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: previeneMedia.id,
              set: {
                mediaType: m.media_type,
                contentPath: m.content_url,
                mimeType: m.mime_type ?? null,
                fileSize: m.file_size ?? null,
                width: m.width ?? null,
                height: m.height ?? null,
                durationSeconds: m.duration_seconds ?? null,
                caption: m.caption ?? null,
                syncedAt: new Date(),
                // availability is deliberately NOT reset here.
              },
            });
        }

        // Drop evidence the report no longer lists.
        await tx.delete(previeneMedia).where(
          mediaIds.length > 0
            ? and(eq(previeneMedia.reportId, remote.id), notInArray(previeneMedia.id, mediaIds))
            : eq(previeneMedia.reportId, remote.id)
        );
      }
    }

    // On the last page upstream sends no cursor, so fall back to the page's own
    // maximum — otherwise the next run starts from zero.
    const advanced = next ? { since: next.since, cursorId: next.cursorId } : cursorFromItems(items);

    // Same transaction as the rows above: the cursor can never point past data
    // that failed to commit.
    await tx
      .insert(previeneSyncState)
      .values({
        id: PREVIENE_SYNC_STATE_ID,
        sinceCursor: advanced?.since ?? undefined,
        cursorId: advanced?.cursorId ?? undefined,
        lastRunReports: items.length,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: previeneSyncState.id,
        set: advanced
          ? { sinceCursor: advanced.since, cursorId: advanced.cursorId, updatedAt: new Date() }
          : { updatedAt: new Date() },
      });
  });
}

async function markSuccess(reports: number): Promise<void> {
  await getDb()
    .update(previeneSyncState)
    .set({ lastSuccessAt: new Date(), lastError: null, lastErrorAt: null, lastRunReports: reports, updatedAt: new Date() })
    .where(eq(previeneSyncState.id, PREVIENE_SYNC_STATE_ID));
}

async function markError(message: string): Promise<void> {
  await getDb()
    .update(previeneSyncState)
    .set({ lastError: message.slice(0, 500), lastErrorAt: new Date(), updatedAt: new Date() })
    .where(eq(previeneSyncState.id, PREVIENE_SYNC_STATE_ID));
}

/** Refresh the cached catalog. Cheap, and it is what drives legend and filters. */
export async function syncEventTypes(): Promise<number> {
  const types = await fetchEventTypes();
  if (types.length === 0) return 0;
  const db = getDb();
  for (const t of types) {
    await db
      .insert(previeneEventTypes)
      .values({ code: t.code, name: t.name, active: t.active, syncedAt: new Date() })
      .onConflictDoUpdate({
        target: previeneEventTypes.code,
        set: { name: t.name, active: t.active, syncedAt: new Date() },
      });
  }
  return types.length;
}

/**
 * Hold an exclusive advisory lock for the WHOLE run, or decline to run.
 *
 * The unit that has to be serialized is `getSyncState → fetch → persistPage`,
 * not each page: locking per page lets an ADMIN pressing "Reintentar" read the
 * cursor, wait for its own upstream page, and then commit on top of pages the
 * worker's timer committed meanwhile — leaving the cursor behind and reingesting
 * dozens of pages. Harmless in the end (the upsert absorbs it) but pure waste,
 * and it made `{ status: "skipped", reason: "locked" }` unreachable.
 *
 * Session-scoped rather than transaction-scoped, because the run spans HTTP
 * calls: a transaction held open across them would either bloat for minutes or
 * force the whole run into one commit, destroying the per-page durability that
 * is the point of this module. That means the lock lives on ONE connection,
 * checked out of the pool for the duration and returned by hand.
 */
async function withSyncLock<T>(run: () => Promise<T>): Promise<T | null> {
  const client = await getPool().connect();
  let held = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [PREVIENE_SYNC_LOCK]
    );
    held = rows[0]?.locked === true;
    // `try`, not the blocking variant: a second runner should give up and let
    // the next cycle pick it up, not queue behind a run that may take minutes.
    if (!held) return null;
    return await run();
  } finally {
    if (held) {
      try {
        await client.query("select pg_advisory_unlock($1)", [PREVIENE_SYNC_LOCK]);
        client.release();
      } catch {
        // Returning a connection that might still hold the lock would wedge
        // every later run for the life of the process. Destroying it ends the
        // session, and Postgres releases session locks with the session.
        client.release(true);
      }
    } else {
      client.release();
    }
  }
}

/**
 * Walk the incremental feed until `next` is null.
 *
 * A transient upstream failure aborts the run WITHOUT advancing the cursor, so
 * the next cycle resumes from the last committed position. A contract/config
 * failure also aborts, but is recorded so the viewer's banner can explain why
 * the data is stale instead of showing an unexplained empty map.
 */
export async function runPrevieneSync(): Promise<SyncResult> {
  if (!isPrevieneConfigured()) return { status: "skipped", reason: "not-configured" };
  const result = await withSyncLock(runSyncLocked);
  return result ?? { status: "skipped", reason: "locked" };
}

async function runSyncLocked(): Promise<SyncResult> {
  let reports = 0;
  let pages = 0;

  try {
    // Catalog first: a report whose type arrived in this same cycle should
    // already have a name and colour when the viewer reloads.
    await syncEventTypes();
  } catch (err) {
    // A catalog failure must not block report ingestion — the viewer falls
    // back to the type name embedded in each report.
    if (!(err instanceof PrevieneApiError)) throw err;
  }

  try {
    const state = await getSyncState();
    let since = state.sinceCursor;
    let cursorId = state.cursorId;

    while (pages < env.PREVIENE_MAX_PAGES_PER_RUN) {
      const page = await fetchReportsPage({ since, cursorId, limit: env.PREVIENE_PAGE_SIZE });

      // A quarantined item is skipped so the feed keeps moving, but it must not
      // vanish silently: without this line the dataset shrinks and nobody can
      // tell which report needs fixing upstream.
      if (page.skipped.length > 0) {
        console.error(
          `[previene] ${page.skipped.length} reporte(s) descartados por contrato:`,
          page.skipped.map((s) => `${s.id ?? "sin id"} (${s.reason})`).join(" | ")
        );
      }

      await persistPage(page.items, page.next);
      reports += page.items.length;
      pages += 1;

      if (!page.next) break;
      // Guard against an upstream that keeps handing back the same cursor:
      // without this the loop would spin until MAX_PAGES with no progress.
      if (page.next.since === since && page.next.cursorId === cursorId) break;
      since = page.next.since;
      cursorId = page.next.cursorId;
    }

    await markSuccess(reports);
    return { status: "ok", reports, pages };
  } catch (err) {
    const isApi = err instanceof PrevieneApiError;
    const message = isApi ? err.message : err instanceof Error ? err.message : "Error desconocido";
    await markError(message).catch(() => {});
    return { status: "error", message, retryable: isApi ? err.retryable : false, reports };
  }
}
