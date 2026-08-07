import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

/**
 * Database-backed tests for the incremental ingestion.
 *
 * The contract these protect: a page of reports and the cursor that declares
 * them done are committed together. A crash may therefore cause a re-read
 * (absorbed by the upsert) but can never skip reports.
 */
process.env.PREVIENE_API_KEY = "test-key-not-a-real-secret";
process.env.PREVIENE_API_BASE_URL = "http://reports.test:8080";

const { getDb, closeDb } = await import("../db/client.js");
const { previeneReports, previeneMedia, previeneSyncState, previeneEventTypes, PREVIENE_SYNC_STATE_ID } =
  await import("../db/schema/previene.js");
const { runPrevieneSync, getSyncState } = await import("../modules/previene/syncModule.js");
const { listReports, listEventTypes, getPrevieneStatus } = await import("../modules/previene/reportsModule.js");

const db = getDb();
const originalFetch = globalThis.fetch;

const REPORT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REPORT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const MEDIA_1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const MEDIA_2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const CURSOR_1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

function remoteReport(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_A,
    reporter_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    report_kind: "EVENT",
    event_type_code: "RAIN",
    event_type_name: "Lluvia",
    latitude: -0.7436,
    longitude: -90.3134,
    location_accuracy: 12.5,
    description: "Lluvia intensa en la vía a Bellavista.",
    media: [
      {
        id: MEDIA_1,
        media_type: "PHOTO",
        content_url: `/v1/media/${MEDIA_1}/content`,
        mime_type: "image/jpeg",
        file_size: 204800,
        width: 1280,
        height: 853,
        duration_seconds: null,
        caption: "Vía inundada",
        created_at: "2026-08-06T12:00:00Z",
      },
    ],
    created_at: "2026-08-06T11:58:00Z",
    updated_at: "2026-08-06T12:00:00Z",
    submitted_at: "2026-08-06T12:00:00Z",
    ...overrides,
  };
}

/** Serve /v1/event-types plus a scripted sequence of /v1/reports pages. */
function stubUpstream(pages: Array<() => Response>) {
  let index = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/event-types")) {
      return new Response(JSON.stringify([{ code: "RAIN", name: "Lluvia", active: true }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return page();
  }) as typeof fetch;
}

function jsonPage(items: unknown[], next: { since: string; cursor_id: string } | null): Response {
  return new Response(JSON.stringify({ items, next }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function resetModuleState() {
  await db.delete(previeneReports).where(eq(previeneReports.id, REPORT_A));
  await db.delete(previeneReports).where(eq(previeneReports.id, REPORT_B));
  await db.delete(previeneEventTypes).where(eq(previeneEventTypes.code, "RAIN"));
  await db.delete(previeneEventTypes).where(eq(previeneEventTypes.code, "TSUNAMI"));
  await db
    .update(previeneSyncState)
    .set({ sinceCursor: null, cursorId: null, lastError: null, lastErrorAt: null, lastSuccessAt: null })
    .where(eq(previeneSyncState.id, PREVIENE_SYNC_STATE_ID));
}

test.beforeEach(async () => {
  await resetModuleState();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await resetModuleState();
  await closeDb();
});

test("a single page is ingested and the cursor is stored", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "ok");

  const rows = await db.select().from(previeneReports).where(eq(previeneReports.id, REPORT_A));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventTypeCode, "RAIN");
  assert.equal(rows[0].description, "Lluvia intensa en la vía a Bellavista.");

  const media = await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A));
  assert.equal(media.length, 1);
  assert.equal(media[0].fileSize, 204800);
});

test("re-reading a modified report updates it instead of failing on the primary key", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();

  // The same id comes back with a newer updated_at, exactly as upstream does
  // when a report is edited after we first saw it.
  stubUpstream([
    () =>
      jsonPage(
        [remoteReport({ description: "Descripción corregida", updated_at: "2026-08-06T13:00:00Z" })],
        null,
      ),
  ]);
  const result = await runPrevieneSync();
  assert.equal(result.status, "ok");

  const rows = await db.select().from(previeneReports).where(eq(previeneReports.id, REPORT_A));
  assert.equal(rows.length, 1, "an upsert must not duplicate the report");
  assert.equal(rows[0].description, "Descripción corregida");
});

test("evidence removed upstream disappears; evidence still listed is preserved", async () => {
  stubUpstream([
    () =>
      jsonPage(
        [
          remoteReport({
            media: [
              remoteReport().media[0],
              {
                id: MEDIA_2,
                media_type: "VIDEO",
                content_url: `/v1/media/${MEDIA_2}/content`,
                mime_type: "video/mp4",
                file_size: 18400000,
                width: 1080,
                height: 1920,
                duration_seconds: 22,
                caption: "Corriente sobre la vía",
                created_at: "2026-08-06T12:01:00Z",
              },
            ],
          }),
        ],
        null,
      ),
  ]);
  await runPrevieneSync();
  assert.equal((await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A))).length, 2);

  // A viewer already discovered the photo is gone from Telegram.
  await db.update(previeneMedia).set({ availability: "gone" }).where(eq(previeneMedia.id, MEDIA_1));

  // Upstream now lists only the photo.
  stubUpstream([() => jsonPage([remoteReport({ updated_at: "2026-08-06T14:00:00Z" })], null)]);
  await runPrevieneSync();

  const media = await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A));
  assert.equal(media.length, 1, "the video no longer listed upstream must be dropped");
  assert.equal(media[0].id, MEDIA_1);
  assert.equal(
    media[0].availability,
    "gone",
    "a re-sync must not resurrect an evidence already known to be unavailable",
  );
});

test("a report that arrives without a media key keeps its cached evidence", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();
  assert.equal((await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A))).length, 1);

  // Upstream trims `media` from its list projection: it is saying NOTHING about
  // evidence, not saying there is none. Treating the two alike would delete
  // every cached evidence in the archipelago on the first such page.
  const { media: _media, ...withoutMedia } = remoteReport({ updated_at: "2026-08-06T15:00:00Z" });
  stubUpstream([() => jsonPage([withoutMedia], null)]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "ok", "an absent media key must not throw inside the page transaction");

  const media = await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A));
  assert.equal(media.length, 1, "silence about evidence must not be read as an empty list");
  assert.equal(media[0].id, MEDIA_1);
});

test("an explicitly empty media list still removes the cached evidence", async () => {
  // The counterpart of the test above: `media: []` IS a statement, and the
  // reconciler must act on it or evidence deleted upstream lives on for ever.
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();

  stubUpstream([() => jsonPage([remoteReport({ media: [], updated_at: "2026-08-06T16:00:00Z" })], null)]);
  await runPrevieneSync();

  assert.equal((await db.select().from(previeneMedia).where(eq(previeneMedia.reportId, REPORT_A))).length, 0);
});

test("a malformed item is skipped and the cursor still advances past it", async () => {
  stubUpstream([() => jsonPage([{ id: "not-a-uuid" }, remoteReport()], null)]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "ok", "one unusable report must not fail the whole run");

  assert.equal(
    (await db.select().from(previeneReports).where(eq(previeneReports.id, REPORT_A))).length,
    1,
    "the valid report sharing the page must still land",
  );

  const state = await getSyncState();
  assert.equal(state.cursorId, REPORT_A, "the cursor must move past the quarantined item");
});

test("a page whose items are ALL malformed still advances the cursor", async () => {
  // The wedge scenario: with no valid item to derive a cursor from, the run has
  // to lean on upstream's `next`. If it did not, the feed would stop here for
  // ever and every report behind this page would never arrive.
  stubUpstream([
    () => jsonPage([{ id: "not-a-uuid" }], { since: "2026-08-06T12:00:00Z", cursor_id: CURSOR_1 }),
    () => jsonPage([], null),
  ]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "ok");

  const state = await getSyncState();
  assert.equal(state.cursorId, CURSOR_1);
  assert.equal(state.sinceCursor, "2026-08-06T12:00:00Z");
});

test("the cursor advances page by page and stops when next is null", async () => {
  stubUpstream([
    () => jsonPage([remoteReport()], { since: "2026-08-06T12:00:00Z", cursor_id: CURSOR_1 }),
    () => jsonPage([remoteReport({ id: REPORT_B, updated_at: "2026-08-06T12:30:00Z" })], null),
  ]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "ok");
  assert.equal(result.reports, 2);
  assert.equal(result.pages, 2);

  assert.equal((await db.select().from(previeneReports).where(eq(previeneReports.id, REPORT_B))).length, 1);
});

test("the cursor advances on a final page that carries no next", async () => {
  // The deployed API omits `next` on the last page. Leaving the cursor null
  // there would make every cycle re-read the entire catalog, so it is derived
  // from the page's own maximum (updated_at, id) — the same pair upstream
  // would have sent.
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();

  const state = await getSyncState();
  assert.equal(state.cursorId, REPORT_A);
  // Stored verbatim: the cursor is an opaque token, not a converted date.
  assert.equal(state.sinceCursor, "2026-08-06T12:00:00Z");
});

test("the derived cursor is the page maximum, not its last element", async () => {
  // Guards against a page arriving out of order moving the cursor backwards,
  // which would silently re-read reports on every cycle.
  stubUpstream([
    () =>
      jsonPage(
        [
          remoteReport({ id: REPORT_B, updated_at: "2026-08-06T18:00:00Z" }),
          remoteReport({ updated_at: "2026-08-06T09:00:00Z" }),
        ],
        null,
      ),
  ]);
  await runPrevieneSync();

  const state = await getSyncState();
  assert.equal(state.sinceCursor, "2026-08-06T18:00:00Z");
  assert.equal(state.cursorId, REPORT_B);
});

test("a transient failure mid-run leaves the cursor at the last committed page", async () => {
  stubUpstream([
    () => jsonPage([remoteReport()], { since: "2026-08-06T12:00:00Z", cursor_id: CURSOR_1 }),
    () => new Response("upstream restarting", { status: 503 }),
  ]);

  const result = await runPrevieneSync();
  assert.equal(result.status, "error");
  assert.equal(result.status === "error" && result.retryable, true);

  const state = await getSyncState();
  // The first page committed, so its cursor must be durable: the next run has
  // to resume there, not re-read from the beginning and not skip ahead.
  assert.equal(state.cursorId, CURSOR_1);
  // Stored verbatim: the cursor is an opaque token, not a converted date.
  assert.equal(state.sinceCursor, "2026-08-06T12:00:00Z");
  assert.ok(state.lastError, "the failure must be recorded for the viewer's banner");

  // The report from the committed page survived the failed run.
  assert.equal((await db.select().from(previeneReports).where(eq(previeneReports.id, REPORT_A))).length, 1);
});

test("resuming after a failure sends the persisted cursor", async () => {
  stubUpstream([
    () => jsonPage([remoteReport()], { since: "2026-08-06T12:00:00Z", cursor_id: CURSOR_1 }),
    () => new Response("upstream restarting", { status: 503 }),
  ]);
  await runPrevieneSync();

  const requested: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/event-types")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    requested.push(url);
    return jsonPage([], null);
  }) as typeof fetch;

  await runPrevieneSync();

  const url = new URL(requested[0]);
  assert.equal(url.searchParams.get("cursor_id"), CURSOR_1);
  assert.equal(url.searchParams.get("since"), "2026-08-06T12:00:00Z");
});

test("the read endpoint never exposes a reporter identity", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();

  const reports = await listReports({});
  assert.ok(reports.length >= 1);

  const serialized = JSON.stringify(reports);
  assert.ok(!serialized.includes("reporter"), "no reporter field may reach the browser");
  assert.ok(!serialized.includes("eeeeeeee"), "the reporter UUID must not appear in the payload");
});

test("reports without coordinates are excluded from the map payload", async () => {
  stubUpstream([
    () => jsonPage([remoteReport({ id: REPORT_B, latitude: null, longitude: null })], null),
  ]);
  await runPrevieneSync();

  const reports = await listReports({});
  assert.ok(
    !reports.some((r) => r.id === REPORT_B),
    "a report with no location cannot be placed and must not appear as an unreachable table row",
  );
});

test("a second run is turned away while the first still holds the lock", async () => {
  // The lock covers `getSyncState → fetch → persistPage` for the whole run, not
  // one page: with a per-page lock an ADMIN pressing "Reintentar" could read the
  // cursor, wait on its own upstream call, and commit on top of pages the timer
  // had committed meanwhile — leaving the cursor behind and reingesting dozens
  // of pages.
  let firstFetchReached = () => {};
  const reached = new Promise<void>((resolve) => {
    firstFetchReached = resolve;
  });
  let releaseFirstFetch = () => {};
  const blocked = new Promise<void>((resolve) => {
    releaseFirstFetch = resolve;
  });

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/event-types")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    firstFetchReached();
    await blocked;
    return jsonPage([remoteReport()], null);
  }) as typeof fetch;

  const first = runPrevieneSync();
  await reached; // the lock is held by now — the run is parked on its upstream call

  const second = await runPrevieneSync();
  assert.equal(second.status, "skipped");
  assert.equal(second.status === "skipped" && second.reason, "locked");

  releaseFirstFetch();
  const firstResult = await first;
  assert.equal(firstResult.status, "ok", "the run holding the lock must finish normally");
});

test("the lock is released, so the next run is not turned away", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  assert.equal((await runPrevieneSync()).status, "ok");
  // A leaked session lock would wedge every later run for the life of the
  // process, with no error anywhere to explain the silence.
  assert.equal((await runPrevieneSync()).status, "ok");
});

test("a deactivated type keeps its name while reports still reference it", async () => {
  stubUpstream([() => jsonPage([remoteReport()], null)]);
  await runPrevieneSync();

  await db.update(previeneEventTypes).set({ active: false }).where(eq(previeneEventTypes.code, "RAIN"));

  const rain = (await listEventTypes()).find((t) => t.code === "RAIN");
  assert.ok(rain, "a type still carried by reports must stay tickable in the filter");
  assert.equal(rain.name, "Lluvia", "`active` decides what is offered, never whether the name is known");
  assert.equal(rain.count, 1);
});

test("a deactivated type nobody references is dropped from the catalog", async () => {
  await db
    .insert(previeneEventTypes)
    .values({ code: "TSUNAMI", name: "Tsunami", active: false })
    .onConflictDoUpdate({ target: previeneEventTypes.code, set: { active: false } });

  const types = await listEventTypes();
  assert.ok(!types.some((t) => t.code === "TSUNAMI"), "that is what deactivating a type is for");
});

test("a report with no submitted_at is still reachable through a date range", async () => {
  stubUpstream([
    () =>
      jsonPage(
        [
          remoteReport({
            id: REPORT_B,
            media: [],
            submitted_at: null,
            created_at: "2026-08-06T11:00:00Z",
            updated_at: "2026-08-06T11:00:00Z",
          }),
          remoteReport(),
        ],
        null,
      ),
  ]);
  await runPrevieneSync();

  const ranged = await listReports({
    desde: new Date("2026-08-01T00:00:00Z"),
    hasta: new Date("2026-08-31T23:59:59Z"),
  });

  // Filtering on submitted_at alone made these invisible under ANY range while
  // still counting towards totalReports — an unreconcilable "12 de 47".
  assert.ok(ranged.some((r) => r.id === REPORT_B), "a null submitted_at is not a reason to hide a report");
  // ...and they sort by the same fallback, instead of jumping to the top
  // because NULL sorts highest in a descending Postgres order.
  assert.deepEqual(
    ranged.filter((r) => r.id === REPORT_A || r.id === REPORT_B).map((r) => r.id),
    [REPORT_A, REPORT_B],
  );
});

test("the status endpoint reports staleness after a failure", async () => {
  stubUpstream([() => new Response("down", { status: 503 })]);
  await runPrevieneSync();

  const status = await getPrevieneStatus();
  assert.equal(status.configured, true);
  assert.ok(status.degraded, "a failed sync must put the viewer in degraded mode");
  assert.ok(status.lastError);
});
