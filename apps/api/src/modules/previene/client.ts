import { z } from "zod";
import { env } from "../../lib/env.js";

/**
 * HTTP client for the external "Galápagos Previene" reports API.
 *
 * Two invariants this file exists to protect:
 *
 *  1. The bearer key is read from the environment here and nowhere else. It is
 *     never returned, never put in an error message and never logged — an
 *     upstream error string is reproduced verbatim in logs, so the key must not
 *     be able to reach one.
 *  2. Failures are classified. A 502/503 is transient and the caller must retry
 *     WITHOUT advancing the sync cursor; a 400/401/404/422 is a configuration
 *     or contract bug that retrying cannot fix.
 */

export class PrevieneApiError extends Error {
  constructor(
    message: string,
    /** Upstream status, or 0 for network/timeout failures. */
    public readonly status: number,
    /** True when retrying later can reasonably succeed. */
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "PrevieneApiError";
  }
}

export function isPrevieneConfigured(): boolean {
  return env.PREVIENE_API_KEY.length > 0;
}

function baseUrl(): string {
  return env.PREVIENE_API_BASE_URL.replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.PREVIENE_API_KEY}`, Accept: "application/json" };
}

/**
 * A 5xx/network failure is worth retrying; a 4xx is not. Kept in one place so
 * the sync loop never has to guess whether advancing the cursor is safe.
 */
function classify(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 429;
}

async function requestJson(path: string, timeoutMs: number): Promise<unknown> {
  if (!isPrevieneConfigured()) {
    throw new PrevieneApiError("PREVIENE_API_KEY no está configurada", 0, false);
  }
  let resp: globalThis.Response;
  try {
    resp = await fetch(`${baseUrl()}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Timeouts and DNS/connection refusals are transient by nature — most
    // often "the reports API is restarting" or, in Docker, "loopback is not
    // the host". Both are worth another attempt on the next cycle.
    const reason = err instanceof Error && err.name === "TimeoutError" ? "tiempo de espera agotado" : "sin conexión";
    throw new PrevieneApiError(`No se pudo contactar la API de reportes (${reason})`, 0, true);
  }

  if (!resp.ok) {
    // The body may echo request parameters; it never contains the key (which
    // travels in a header), but it is still truncated to keep logs readable.
    const detail = await resp.text().catch(() => "");
    throw new PrevieneApiError(
      `La API de reportes respondió ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      resp.status,
      classify(resp.status)
    );
  }

  try {
    return await resp.json();
  } catch {
    throw new PrevieneApiError("La API de reportes devolvió un cuerpo no JSON", resp.status, false);
  }
}

// ── Payload contracts ──────────────────────────────────────────────────────
// Non-strict on purpose: the catalog of event types is expected to grow and
// upstream may add fields. Unknown keys are dropped rather than rejected —
// including `reporter_id`, which is filtered out here so it never even reaches
// the persistence layer.

/**
 * Postgres renders its UTC offset as `+00`; V8 parses `+00:00` but returns
 * INVALID for the short form. Upstream projects timestamps straight from the
 * database, so the short form is a normal value, not a malformed one — treating
 * it as malformed would quarantine reports that are perfectly fine.
 *
 * Exported because the cursor's parseability is validated here and its value is
 * converted in syncModule: both must agree on what "parseable" means, or an
 * item accepted by the schema could still produce a null date inside the page
 * transaction.
 */
export function normalizeTimestamp(value: string): string {
  return value.replace(/([+-]\d{2})$/, "$1:00");
}

const mediaSchema = z.object({
  id: z.string().uuid(),
  media_type: z.string(),
  content_url: z.string(),
  mime_type: z.string().nullish(),
  file_size: z.number().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  // Rounded, not required to be an integer: Telegram reports durations as
  // fractional seconds often enough that a strict .int() would reject the
  // whole report — and with it, permanently, every page behind it.
  duration_seconds: z.number().nullish().transform((v) => (v == null ? v : Math.round(v))),
  caption: z.string().nullish(),
  created_at: z.string().nullish(),
});

const reportSchema = z.object({
  id: z.string().uuid(),
  report_kind: z.string(),
  event_type_code: z.string().nullish(),
  event_type_name: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  location_accuracy: z.number().nullish(),
  description: z.string().nullish(),
  // Optional, NOT defaulted to []: "upstream sent no media key" and "this
  // report has no evidence" must stay distinguishable. Collapsing them would
  // make the reconciler delete every stored evidence the first time upstream
  // trims media from its list projection.
  media: z.array(mediaSchema).optional(),
  created_at: z.string().nullish(),
  // Must be parseable as a date: it is the cursor. Validated here so a bad
  // value is rejected per item instead of aborting the page's transaction.
  updated_at: z.string().refine((v) => !Number.isNaN(new Date(normalizeTimestamp(v)).getTime()), {
    message: "updated_at no es una fecha válida",
  }),
  submitted_at: z.string().nullish(),
});

/**
 * The page envelope is validated strictly, but its items are NOT: a single
 * malformed report must never stop the feed. Items are parsed one by one by
 * `fetchReportsPage`, so a bad one is skipped and reported while the rest of
 * the page — and every page behind it — keeps flowing.
 */
const pageSchema = z.object({
  items: z.array(z.unknown()),
  next: z
    .object({ since: z.string(), cursor_id: z.string().uuid() })
    .nullish(),
});

const eventTypeSchema = z.object({
  code: z.string(),
  name: z.string(),
  // The deployed API names this field `is_active`; `active` is accepted too so
  // a rename upstream does not silently turn every type active again.
  is_active: z.boolean().nullish(),
  active: z.boolean().nullish(),
});

export type PrevieneRemoteReport = z.infer<typeof reportSchema>;
export type PrevieneRemoteMedia = z.infer<typeof mediaSchema>;
export type PrevieneCursor = { since: string; cursorId: string };
export type PrevieneReportsPage = {
  items: PrevieneRemoteReport[];
  next: PrevieneCursor | null;
  /** Items upstream sent that failed validation and were skipped. */
  skipped: Array<{ id: string | null; reason: string }>;
};

/**
 * One page of the incremental feed. `cursorId` without `since` is a 400
 * upstream, so the pair is enforced here instead of discovering it in prod.
 */
export async function fetchReportsPage(params: {
  since?: string | null;
  cursorId?: string | null;
  limit?: number;
}): Promise<PrevieneReportsPage> {
  const limit = params.limit ?? env.PREVIENE_PAGE_SIZE;
  const query = new URLSearchParams({ limit: String(limit) });
  if (params.since) {
    query.set("since", params.since);
    if (params.cursorId) query.set("cursor_id", params.cursorId);
  }

  const raw = await requestJson(`/v1/reports?${query.toString()}`, env.PREVIENE_SYNC_TIMEOUT_MS);
  const parsed = pageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PrevieneApiError("La respuesta de /v1/reports no cumple el contrato esperado", 0, false);
  }

  // Per-item validation. A rejected item is skipped, never fatal: the cursor
  // walks past it on the next page, so one unexpected value cannot wedge the
  // feed forever. The skipped ids are surfaced so the failure is visible
  // instead of silently shrinking the dataset.
  const items: PrevieneRemoteReport[] = [];
  const skipped: Array<{ id: string | null; reason: string }> = [];
  for (const candidate of parsed.data.items) {
    const item = reportSchema.safeParse(candidate);
    if (item.success) {
      items.push(item.data);
      continue;
    }
    const id = (candidate as { id?: unknown } | null)?.id;
    skipped.push({
      id: typeof id === "string" ? id : null,
      reason: item.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    });
  }

  return {
    items,
    skipped,
    next: parsed.data.next ? { since: parsed.data.next.since, cursorId: parsed.data.next.cursor_id } : null,
  };
}

export async function fetchEventTypes(): Promise<Array<{ code: string; name: string; active: boolean }>> {
  const raw = await requestJson("/v1/event-types", env.PREVIENE_SYNC_TIMEOUT_MS);
  // Accept both a bare array and an { items: [...] } envelope.
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items;
  const parsed = z.array(eventTypeSchema).safeParse(list);
  if (!parsed.success) {
    throw new PrevieneApiError("La respuesta de /v1/event-types no cumple el contrato esperado", 0, false);
  }
  return parsed.data.map((t) => ({
    code: t.code,
    name: t.name,
    // Absent in either spelling means "no opinion", which is treated as active:
    // hiding a type would hide its reports behind a filter nobody can tick.
    active: t.is_active ?? t.active ?? true,
  }));
}

/**
 * Open a media stream. Returns the raw Response so the route can pipe the body
 * straight to the client: a video can be tens of MB and must never be buffered.
 *
 * `range` is forwarded verbatim — without it the browser's <video> element
 * cannot seek, because seeking is implemented as a Range request.
 *
 * `signal` lets the route cancel the upstream request when the client hangs up.
 * Destroying the local stream alone does not do that: the upstream socket stays
 * open until it times out, one leaked connection per abandoned seek.
 */
export async function openMediaStream(
  contentPath: string,
  opts: { range?: string; signal?: AbortSignal } = {}
): Promise<globalThis.Response> {
  if (!isPrevieneConfigured()) {
    throw new PrevieneApiError("PREVIENE_API_KEY no está configurada", 0, false);
  }
  const path = contentPath.startsWith("/") ? contentPath : `/${contentPath}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${env.PREVIENE_API_KEY}` };
  if (opts.range) headers.Range = opts.range;

  // The timeout must bound time-to-first-byte and nothing else, which
  // AbortSignal.timeout does NOT do: undici keeps the signal attached to the
  // Response and cancels the body with it. Under backpressure the clock is then
  // set by how fast the browser reads, so a video that <video> buffers and
  // stops pulling gets truncated at the deadline — and because upstream answers
  // chunked without Content-Length, the browser sees a clean early end instead
  // of an error. Clearing the timer once the headers are in unhooks the body
  // from the clock while leaving the controller usable for `signal`.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.PREVIENE_MEDIA_TIMEOUT_MS);

  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    // Deliberately not detached in the `finally`: it is what carries a client
    // disconnect through to the in-flight body.
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(`${baseUrl()}${path}`, { headers, signal: controller.signal });
  } catch {
    const reason = timedOut ? "tiempo de espera agotado" : "sin conexión";
    throw new PrevieneApiError(`No se pudo obtener la evidencia (${reason})`, 0, true);
  } finally {
    clearTimeout(timer);
  }
}
