import assert from "node:assert/strict";
import test from "node:test";

/**
 * Contract tests for the Galápagos Previene client.
 *
 * These run without a database or the upstream API: `fetch` is stubbed. The
 * environment must be set before the module graph is imported, because
 * lib/env.ts parses process.env at import time.
 */
process.env.PREVIENE_API_KEY = "test-key-not-a-real-secret";
process.env.PREVIENE_API_BASE_URL = "http://reports.test:8080";

const clientModule = await import("../modules/previene/client.js");
const schemaModule = await import("../db/schema/previene.js");
const { fetchReportsPage, openMediaStream, PrevieneApiError } = clientModule;

type FetchCall = { url: string; init: RequestInit | undefined };

/** Install a fetch stub and collect the calls made through it. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_REPORT = {
  id: "11111111-1111-4111-8111-111111111111",
  reporter_id: "22222222-2222-4222-8222-222222222222",
  report_kind: "EVENT",
  event_type_code: "RAIN",
  event_type_name: "Lluvia",
  latitude: -0.7436,
  longitude: -90.3134,
  location_accuracy: 12.5,
  description: "Lluvia intensa en la vía a Bellavista.",
  media: [],
  created_at: "2026-08-06T11:58:00Z",
  updated_at: "2026-08-06T12:00:00Z",
  submitted_at: "2026-08-06T12:00:00Z",
};

// ── Privacy ────────────────────────────────────────────────────────────────

test("the ingestion boundary drops reporter_id", async () => {
  stubFetch(() => jsonResponse({ items: [SAMPLE_REPORT], next: null }));

  const page = await fetchReportsPage({});
  assert.equal(page.items.length, 1);

  const serialized = JSON.stringify(page.items[0]);
  assert.ok(
    !serialized.includes("reporter_id"),
    "reporter_id must not survive parsing — the viewer must never receive it",
  );
  assert.ok(!serialized.includes("2222"), "the reporter UUID value must not survive either");
});

test("the reports table has no column able to hold a reporter identity", () => {
  // Structural guarantee: privacy cannot regress through a forgotten SELECT if
  // there is nowhere to store the value in the first place.
  const columns = Object.keys(schemaModule.previeneReports).map((name) => name.toLowerCase());
  for (const forbidden of ["reporterid", "reporter_id", "reporter", "telegramid", "chatid"]) {
    assert.ok(
      !columns.includes(forbidden),
      `previene_reports must not define a "${forbidden}" column`,
    );
  }
});

// ── Cursor semantics ───────────────────────────────────────────────────────

test("cursor_id is never sent without since (upstream answers 400)", async () => {
  const calls = stubFetch(() => jsonResponse({ items: [], next: null }));

  await fetchReportsPage({ cursorId: "33333333-3333-4333-8333-333333333333" });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("cursor_id"), null);
  assert.equal(url.searchParams.get("since"), null);
});

test("since and cursor_id travel together when both are known", async () => {
  const calls = stubFetch(() => jsonResponse({ items: [], next: null }));

  await fetchReportsPage({
    since: "2026-08-06T12:05:00Z",
    cursorId: "33333333-3333-4333-8333-333333333333",
    limit: 200,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("since"), "2026-08-06T12:05:00Z");
  assert.equal(url.searchParams.get("cursor_id"), "33333333-3333-4333-8333-333333333333");
  assert.equal(url.searchParams.get("limit"), "200");
});

test("a null next is surfaced as null, not as an empty cursor", async () => {
  stubFetch(() => jsonResponse({ items: [], next: null }));
  const page = await fetchReportsPage({});
  assert.equal(page.next, null);
});

test("the next cursor is normalised to camelCase for callers", async () => {
  stubFetch(() =>
    jsonResponse({
      items: [],
      next: { since: "2026-08-06T12:05:00Z", cursor_id: "44444444-4444-4444-8444-444444444444" },
    }),
  );
  const page = await fetchReportsPage({});
  assert.deepEqual(page.next, {
    since: "2026-08-06T12:05:00Z",
    cursorId: "44444444-4444-4444-8444-444444444444",
  });
});

// ── Failure classification ─────────────────────────────────────────────────
// The sync loop decides whether to advance the cursor from `retryable`, so
// misclassifying a status is how reports get skipped permanently.

test("5xx and 429 are retryable; 4xx configuration errors are not", async () => {
  for (const status of [502, 503, 504, 429]) {
    stubFetch(() => new Response("upstream down", { status }));
    const error = await fetchReportsPage({}).catch((err) => err);
    assert.ok(error instanceof PrevieneApiError);
    assert.equal(error.status, status);
    assert.equal(error.retryable, true, `${status} must be retryable`);
  }

  for (const status of [400, 401, 404, 422]) {
    stubFetch(() => new Response("nope", { status }));
    const error = await fetchReportsPage({}).catch((err) => err);
    assert.ok(error instanceof PrevieneApiError);
    assert.equal(error.retryable, false, `${status} must not be retried`);
  }
});

test("a network failure is retryable and never leaks the key", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  const error = await fetchReportsPage({}).catch((err) => err);
  assert.ok(error instanceof PrevieneApiError);
  assert.equal(error.retryable, true);
  assert.ok(!error.message.includes(process.env.PREVIENE_API_KEY as string));
});

// ── Per-item quarantine ────────────────────────────────────────────────────
// A single unusable report must never stop the feed. Before this, one bad value
// rejected the whole page with retryable=false, the cursor never advanced, and
// every report behind it stopped arriving — permanently, with the degraded
// banner as the only symptom.

test("a malformed item is quarantined; the rest of the page survives", async () => {
  stubFetch(() =>
    jsonResponse({
      items: [{ id: "not-a-uuid" }, SAMPLE_REPORT],
      next: { since: "2026-08-06T12:05:00Z", cursor_id: "44444444-4444-4444-8444-444444444444" },
    }),
  );

  const page = await fetchReportsPage({});

  assert.equal(page.items.length, 1, "the valid report must still be ingested");
  assert.equal(page.items[0].id, SAMPLE_REPORT.id);
  assert.equal(page.skipped.length, 1);
  assert.ok(page.skipped[0].reason.includes("id"), "the operator needs to know WHY it was dropped");
  // The cursor must keep moving past the bad item, or the feed wedges on it.
  assert.deepEqual(page.next, {
    since: "2026-08-06T12:05:00Z",
    cursorId: "44444444-4444-4444-8444-444444444444",
  });
});

test("an item whose id cannot be read is still reported, with a null id", async () => {
  stubFetch(() => jsonResponse({ items: [{ nothing: "useful" }], next: null }));
  const page = await fetchReportsPage({});
  assert.equal(page.items.length, 0);
  assert.deepEqual(page.skipped.map((s) => s.id), [null]);
});

test("a malformed ENVELOPE is still a contract error, not a retry loop", async () => {
  // The distinction that matters: a broken item is skipped, a broken page shape
  // means we are talking to something that is not the reports API.
  stubFetch(() => jsonResponse({ nope: true }));
  const error = await fetchReportsPage({}).catch((err) => err);
  assert.ok(error instanceof PrevieneApiError);
  assert.equal(error.retryable, false);
});

test("a fractional duration_seconds is rounded, not treated as malformed", async () => {
  // Telegram reports durations like 22.5. A strict .int() rejected the report —
  // and with it every page behind it.
  stubFetch(() =>
    jsonResponse({
      items: [
        {
          ...SAMPLE_REPORT,
          media: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              media_type: "VIDEO",
              content_url: "/v1/media/66666666-6666-4666-8666-666666666666/content",
              duration_seconds: 22.5,
            },
          ],
        },
      ],
      next: null,
    }),
  );

  const page = await fetchReportsPage({});
  assert.equal(page.skipped.length, 0, "a fractional duration must not quarantine the report");
  assert.equal(page.items[0].media?.[0].duration_seconds, 23);
});

test("an absent media key stays absent instead of collapsing to an empty list", async () => {
  // The reconciler deletes evidence the report no longer lists, so "upstream
  // said nothing" and "this report has none" must not become the same value.
  const { media: _media, ...withoutMedia } = SAMPLE_REPORT;
  stubFetch(() => jsonResponse({ items: [withoutMedia], next: null }));

  const page = await fetchReportsPage({});
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].media, undefined);
});

test("a Postgres short offset parses instead of quarantining the report", async () => {
  // `+00` is what a raw postgres projection renders; V8 only parses `+00:00`.
  // Rejecting it would drop perfectly valid reports on the floor.
  stubFetch(() =>
    jsonResponse({
      items: [{ ...SAMPLE_REPORT, updated_at: "2026-08-06T12:00:00.123456+00" }],
      next: null,
    }),
  );

  const page = await fetchReportsPage({});
  assert.equal(page.skipped.length, 0);
  assert.equal(page.items.length, 1);
});

// ── Media proxy ────────────────────────────────────────────────────────────

test("media requests carry the bearer key and forward Range verbatim", async () => {
  const calls = stubFetch(() => new Response("bytes", { status: 206 }));

  await openMediaStream("/v1/media/55555555-5555-4555-8555-555555555555/content", {
    range: "bytes=200-1023",
  });

  const headers = new Headers(calls[0].init?.headers as ConstructorParameters<typeof Headers>[0]);
  assert.equal(headers.get("authorization"), "Bearer test-key-not-a-real-secret");
  // Without forwarding Range, <video> cannot seek: seeking IS a Range request.
  assert.equal(headers.get("range"), "bytes=200-1023");
  assert.equal(calls[0].url, "http://reports.test:8080/v1/media/55555555-5555-4555-8555-555555555555/content");
});

test("media requests omit Range when the client did not ask for one", async () => {
  const calls = stubFetch(() => new Response("bytes", { status: 200 }));
  await openMediaStream("/v1/media/55555555-5555-4555-8555-555555555555/content");
  const headers = new Headers(calls[0].init?.headers as ConstructorParameters<typeof Headers>[0]);
  assert.equal(headers.get("range"), null);
});
