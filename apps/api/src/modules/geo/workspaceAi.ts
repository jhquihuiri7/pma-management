import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { FastifyReply, FastifyRequest } from "fastify";
import { consumeSharedRateLimit } from "../../auth/rateLimit.js";
import { env } from "../../lib/env.js";

/**
 * Proxy for the RustGIS assistant ("OpenAI-compatible" provider) towards the
 * model configured on the server (NVIDIA's endpoint by default). The browser
 * calls this route on its own origin with the session cookie; the provider key
 * never leaves the server, and the destination is fixed here, so the route can't
 * be used to reach any other address (docs/plan-integracion-rustgis.md §4).
 *
 * It never retries: RustGIS already retries each request up to 3 times (408,
 * 429, 5xx) honouring Retry-After up to 120 s, and gives up on a longer value or
 * on error codes such as insufficient_quota — the error mapping below relies on
 * exactly that (crates/assistant/src/provider.rs retry_delay).
 */

type OpenAiErrorBody = { error: { message: string; type: string; code: string } };

export class AiProxyError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public type = "invalid_request_error",
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AiProxyError";
  }
}

export function errorBody(code: string, message: string, type = "invalid_request_error"): OpenAiErrorBody {
  return { error: { message, type, code } };
}

export function sendAiError(reply: FastifyReply, error: AiProxyError) {
  if (error.retryAfterSeconds !== undefined) reply.header("Retry-After", String(error.retryAfterSeconds));
  reply.header("Cache-Control", "no-store");
  return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.type));
}

/** The HTTP client used to reach the provider (replaced in tests). */
export const upstream = {
  fetch: (input: URL, init: RequestInit): Promise<Response> => globalThis.fetch(input, init),
};

export function aiApiKey(): string {
  return env.WORKSPACE_AI_API_KEY || env.NVIDIA_API_KEY;
}

/** The upstream chat-completions URL, checked against the allowed hosts. */
export function upstreamChatUrl(baseUrl = env.WORKSPACE_AI_BASE_URL, allowedHosts = env.WORKSPACE_AI_ALLOWED_HOSTS): URL {
  const base = new URL(baseUrl);
  const allowed = allowedHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (base.protocol !== "https:") throw new Error("WORKSPACE_AI_BASE_URL must use https");
  if (!allowed.includes(base.hostname.toLowerCase())) throw new Error(`WORKSPACE_AI_BASE_URL host ${base.hostname} is not in WORKSPACE_AI_ALLOWED_HOSTS`);
  return new URL(`${base.pathname.replace(/\/+$/, "")}/chat/completions`, base.origin);
}

/** Models that may be asked for, by the name RustGIS sends → the provider's name. */
export function modelTable(
  alias = env.WORKSPACE_AI_MODEL_ALIAS,
  model = env.WORKSPACE_AI_MODEL,
  extra = env.WORKSPACE_AI_EXTRA_MODELS,
): Map<string, string> {
  const table = new Map<string, string>([[alias, model], [model, model]]);
  for (const name of extra.split(",").map((m) => m.trim()).filter(Boolean)) table.set(name, name);
  return table;
}

export function listModels() {
  return {
    object: "list",
    data: [...modelTable().keys()].map((id) => ({ id, object: "model", owned_by: "sigtar" })),
  };
}

function digest(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(`${Buffer.byteLength(part)}:${part};`);
  return hash.digest("hex");
}

let inFlightTotal = 0;
const inFlightByUser = new Map<string, number>();

/** Quotas and concurrency for one request; returns the release callback. */
export async function admitRequest(userId: string): Promise<() => void> {
  const day = new Date().toISOString().slice(0, 10);
  const perDay = await consumeSharedRateLimit(digest(["workspace-ai-day", userId, day]), env.WORKSPACE_AI_USER_PER_DAY, 24 * 60 * 60_000);
  if (!perDay.allowed) {
    // Not "soon": RustGIS shows it and doesn't retry (insufficient_quota).
    throw new AiProxyError(429, "insufficient_quota", "Alcanzaste el máximo diario de consultas al asistente. Vuelve a intentarlo mañana.", "insufficient_quota");
  }
  const perMinute = await consumeSharedRateLimit(digest(["workspace-ai-minute", userId]), env.WORKSPACE_AI_USER_PER_MINUTE, 60_000);
  if (!perMinute.allowed) {
    throw new AiProxyError(429, "rate_limit_exceeded", "Demasiadas consultas seguidas al asistente; espera unos segundos.", "rate_limit_error", Math.min(120, perMinute.retryAfterSeconds));
  }
  if ((inFlightByUser.get(userId) ?? 0) >= 1 || inFlightTotal >= env.WORKSPACE_AI_MAX_CONCURRENT) {
    throw new AiProxyError(429, "rate_limit_exceeded", "El asistente está atendiendo otra consulta; se reintentará en unos segundos.", "rate_limit_error", 5);
  }
  inFlightTotal += 1;
  inFlightByUser.set(userId, (inFlightByUser.get(userId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlightTotal = Math.max(0, inFlightTotal - 1);
    const left = (inFlightByUser.get(userId) ?? 1) - 1;
    if (left <= 0) inFlightByUser.delete(userId);
    else inFlightByUser.set(userId, left);
  };
}

/** Validates the body RustGIS sends and swaps the model alias for the real model. */
export function prepareBody(body: unknown, table = modelTable(), maxTokens = env.WORKSPACE_AI_MAX_TOKENS): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AiProxyError(400, "invalid_body", "La consulta no es un objeto JSON.");
  }
  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new AiProxyError(400, "invalid_body", "La consulta no tiene mensajes.");
  }
  const requested = typeof input.model === "string" ? input.model.trim() : "";
  const model = table.get(requested);
  if (!model) {
    throw new AiProxyError(400, "model_not_allowed", `Modelo no permitido: «${requested.slice(0, 100)}». Usa «${[...table.keys()][0]}».`);
  }
  // Everything else — messages with tool_calls / tool_call_id / reasoning_content,
  // tools, stream, reasoning_effort — goes through untouched.
  const out: Record<string, unknown> = { ...input, model };
  if (maxTokens > 0 && out.max_tokens === undefined && out.max_completion_tokens === undefined) out.max_tokens = maxTokens;
  return out;
}

/** What the browser gets for an upstream failure that isn't a plain pass-through. */
export function mapUpstreamStatus(status: number, retryAfter: string | null): AiProxyError | null {
  if (status === 401 || status === 403) {
    // The server's key or model, not the user's session: never a 401 here.
    return new AiProxyError(503, "upstream_auth", "El proveedor de IA rechazó la credencial del servidor. Avise al administrador.", "server_error", 3600);
  }
  if (status === 429) {
    const seconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim()) ? Math.min(120, Math.ceil(Number(retryAfter))) : 20;
    return new AiProxyError(429, "rate_limit_exceeded", "El proveedor de IA limitó la frecuencia de consultas; se reintentará en unos segundos.", "rate_limit_error", seconds);
  }
  return null;
}

/** Forwards one chat-completions request and pipes the answer (SSE or JSON) back. */
export async function proxyChatCompletion(req: FastifyRequest, reply: FastifyReply, userId: string) {
  if (!env.WORKSPACE_AI_ENABLED || !aiApiKey()) {
    return sendAiError(reply, new AiProxyError(503, "ai_disabled", "El asistente no está habilitado en este servidor.", "server_error", 3600));
  }
  let url: URL;
  try {
    url = upstreamChatUrl();
  } catch (error) {
    req.log.error({ err: error }, "workspace ai: invalid upstream configuration");
    return sendAiError(reply, new AiProxyError(503, "ai_misconfigured", "El asistente está mal configurado en el servidor.", "server_error", 3600));
  }
  const body = prepareBody(req.body);
  const release = await admitRequest(userId);
  const controller = new AbortController();
  const started = Date.now();
  let reason = "";
  const headersTimer = setTimeout(() => {
    reason = "headers-timeout";
    controller.abort();
  }, env.WORKSPACE_AI_HEADERS_TIMEOUT_MS);
  const totalTimer = setTimeout(() => {
    reason = "total-timeout";
    controller.abort();
  }, env.WORKSPACE_AI_TIMEOUT_MS);
  const onClose = () => {
    if (!reply.raw.writableFinished) {
      reason ||= "client-closed";
      controller.abort();
    }
  };
  reply.raw.on("close", onClose);
  const finish = () => {
    clearTimeout(headersTimer);
    clearTimeout(totalTimer);
    reply.raw.off("close", onClose);
    release();
  };

  let response: Response;
  try {
    response = await upstream.fetch(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${aiApiKey()}`,
        "Content-Type": "application/json",
        Accept: req.headers.accept === "text/event-stream" ? "text/event-stream" : "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    finish();
    const timedOut = reason === "headers-timeout" || reason === "total-timeout";
    req.log.warn({ ai: { model: body.model, reason: reason || "network", ms: Date.now() - started } }, "workspace ai: upstream unreachable");
    if (reason === "client-closed") return reply;
    return sendAiError(
      reply,
      timedOut
        ? new AiProxyError(504, "upstream_timeout", "El proveedor de IA no respondió a tiempo. Vuelve a enviar la consulta.", "server_error", 3600)
        : new AiProxyError(502, "upstream_unreachable", "No se pudo contactar al proveedor de IA.", "server_error"),
    );
  }
  clearTimeout(headersTimer);
  req.log.info({ ai: { model: body.model, status: response.status, ms: Date.now() - started } }, "workspace ai: upstream answered");

  const mapped = mapUpstreamStatus(response.status, response.headers.get("retry-after"));
  if (mapped) {
    await response.body?.cancel().catch(() => undefined);
    finish();
    return sendAiError(reply, mapped);
  }

  reply.status(response.status);
  reply.header("Cache-Control", "no-store");
  reply.header("X-Accel-Buffering", "no");
  for (const name of ["content-type", "retry-after", "retry-after-ms", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) reply.header(name, value);
  }
  if (!response.body) {
    finish();
    return reply.send();
  }
  const stream = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  stream.once("end", finish);
  stream.once("error", (error) => {
    req.log.warn({ err: error, ai: { reason } }, "workspace ai: stream interrupted");
    finish();
  });
  return reply.send(stream);
}
