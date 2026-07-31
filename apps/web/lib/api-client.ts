/**
 * Single HTTP client for the @pma/api backend.
 *
 * All requests share URL translation, credentials, token refresh, cancellation,
 * timeout handling and error-envelope parsing. `apiFetch` remains available for
 * legacy callsites that need a raw Response; new code should prefer `api`.
 */

const isServer = typeof window === "undefined";
const BASE_URL = isServer
  ? (process.env.API_BASE_URL ?? "http://localhost:4000")
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy");

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type ApiErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "abort"
  | "invalid_response";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public kind: ApiErrorKind = "http"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchInit extends RequestInit {
  /** Set to 0 to disable the timeout for an explicitly long-running request. */
  timeoutMs?: number;
}

interface RequestOptions extends Omit<ApiFetchInit, "body"> {
  body?: unknown;
  raw?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

function apiUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;

  if (input.startsWith("/pma/api/")) {
    return `${BASE_URL}/pma/${input.slice("/pma/api/".length)}`;
  }
  if (input.startsWith("/rgdp/api/")) {
    return `${BASE_URL}/rgdp/${input.slice("/rgdp/api/".length)}`;
  }
  if (input.startsWith("/geo/api/")) {
    return `${BASE_URL}/geo/${input.slice("/geo/api/".length)}`;
  }
  if (input.startsWith("/api/auth/")) {
    return `${BASE_URL}/auth/${input.slice("/api/auth/".length)}`;
  }

  // Backend-native routes used by the typed client. Mapping /api/* here also
  // fixes legacy callers that otherwise hit a non-existent Next.js API route.
  if (
    input.startsWith("/auth/") ||
    input.startsWith("/api/") ||
    input.startsWith("/pma/") ||
    input.startsWith("/rgdp/") ||
    input.startsWith("/geo/")
  ) {
    return `${BASE_URL}${input}`;
  }

  return input;
}

export function errorMessageFromEnvelope(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const candidate of [record.message, record.error, record.detail, record.details]) {
    const message = errorMessageFromEnvelope(candidate);
    if (message) return message;
  }
  return undefined;
}

export async function apiErrorFromResponse(
  response: Response,
  fallback = `Error del servidor (${response.status})`
): Promise<ApiError> {
  let details: unknown;
  let message = fallback;

  try {
    const text = await response.text();
    if (text) {
      try {
        details = JSON.parse(text);
      } catch {
        details = text;
      }
      message = errorMessageFromEnvelope(details) ?? message;
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // The status is still useful even when the error body cannot be read.
  }

  return new ApiError(response.status, message, details, "http");
}

export function apiErrorMessage(error: unknown, fallback = "No se pudo completar la operación"): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export interface QueuedInvitationReceipt {
  invitation: {
    status: "queued";
    operationId: string;
  };
}

/** Rejects a 2xx response that did not actually confirm the invitation outbox write. */
export function assertQueuedInvitationReceipt(value: unknown): asserts value is QueuedInvitationReceipt {
  const invitation = value && typeof value === "object"
    ? (value as { invitation?: unknown }).invitation
    : undefined;
  const receipt = invitation && typeof invitation === "object"
    ? invitation as { status?: unknown; operationId?: unknown }
    : undefined;
  if (
    receipt?.status !== "queued" ||
    typeof receipt.operationId !== "string" ||
    receipt.operationId.trim() === ""
  ) {
    throw new ApiError(
      200,
      "El servidor no confirmó que la invitación quedó encolada",
      value,
      "invalid_response"
    );
  }
}

export interface OkReceipt {
  ok: true;
}

/** A 2xx alone is insufficient when the endpoint promises an explicit receipt. */
export function requireOkReceipt(value: unknown, message = "El servidor no confirmó la operación"): OkReceipt {
  if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
    throw new ApiError(200, message, value, "invalid_response");
  }
  return value as OkReceipt;
}

/** Runtime-check the minimum contract shared by persisted entity responses. */
export function requirePersistedEntity<T extends { id: string }>(
  value: unknown,
  message = "El servidor no confirmó la persistencia",
  expectedId?: string
): T {
  const id = value && typeof value === "object" ? (value as { id?: unknown }).id : undefined;
  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    (expectedId !== undefined && id !== expectedId)
  ) {
    throw new ApiError(200, message, value, "invalid_response");
  }
  return value as T;
}

/** A file response needs a durable storage locator and a retrieval URL. */
export function requirePersistedAsset<T extends { id: string }>(
  value: unknown,
  message = "El servidor no confirmó la persistencia del archivo",
  expectedId?: string,
): T {
  const entity = requirePersistedEntity<T>(value, message, expectedId);
  const record = entity as T & {
    driveFileId?: unknown;
    driveUrl?: unknown;
    storagePath?: unknown;
    storageUrl?: unknown;
  };
  const locator = record.driveFileId ?? record.storagePath;
  const url = record.driveUrl ?? record.storageUrl;
  if (
    typeof locator !== "string" || locator.trim() === "" ||
    typeof url !== "string" || url.trim() === ""
  ) {
    throw new ApiError(200, message, value, "invalid_response");
  }
  return entity;
}

async function fetchWithTimeout(url: string, init: ApiFetchInit): Promise<Response> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal: callerSignal, ...requestInit } = init;
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  };
  const normalizeFailure = (error: unknown): ApiError => {
    if (timedOut) {
      return new ApiError(0, "La operación superó el tiempo de espera", error, "timeout");
    }
    if (callerSignal?.aborted) {
      return new ApiError(0, "La operación fue cancelada", error, "abort");
    }
    if (error instanceof ApiError) return error;
    return new ApiError(0, "No se pudo conectar con el servidor", error, "network");
  };

  let response: Response;
  try {
    response = await fetch(url, { ...requestInit, signal: controller.signal });
  } catch (error) {
    cleanup();
    throw normalizeFailure(error);
  }

  if (!response.body) {
    cleanup();
    return response;
  }

  // Keep the same deadline active until the body has actually been consumed.
  // Receiving 2xx headers is not a confirmed operation if JSON/blob streaming
  // later stalls or the connection drops.
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const result = await reader.read();
        if (result.done) {
          cleanup();
          streamController.close();
        } else {
          streamController.enqueue(result.value);
        }
      } catch (error) {
        cleanup();
        streamController.error(normalizeFailure(error));
      }
    },
    async cancel(reason) {
      cleanup();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return false;
      }
      try {
        requireOkReceipt(await res.json(), "El servidor no confirmó la renovación de sesión");
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Raw-response compatibility API. Network/timeout/abort failures throw a typed
 * ApiError; HTTP failures are returned so legacy callers can inspect `res.ok`.
 */
export async function apiFetch(input: string, init: ApiFetchInit = {}): Promise<Response> {
  const url = apiUrl(input);
  let res = await fetchWithTimeout(url, { credentials: "include", ...init });
  if (res.status === 401 && !url.includes("/auth/")) {
    await res.body?.cancel().catch(() => undefined);
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetchWithTimeout(url, { credentials: "include", ...init });
    }
  }
  return res;
}

export async function checkedApiFetch(
  input: string,
  init: ApiFetchInit = {},
  fallbackMessage?: string
): Promise<Response> {
  const response = await apiFetch(input, init);
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      fallbackMessage ?? `Error del servidor (${response.status})`
    );
  }
  return response;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body: inputBody, raw, ...init } = opts;
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;

  if (inputBody !== undefined) {
    if (inputBody instanceof FormData) {
      body = inputBody;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(inputBody);
    }
  }

  const res = await apiFetch(path, { ...init, headers, body });
  if (!res.ok) throw await apiErrorFromResponse(res);
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  // Parse every JSON media type, including structured-syntax suffixes like
  // application/geo+json (RFC 6839) used by the GIS layer-data endpoint. A bare
  // `includes("application/json")` misses `geo+json`, which then falls through
  // to res.text() and hands callers an unparsed string.
  if (/\bjson\b/i.test(contentType)) {
    try {
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        res.status,
        "El servidor devolvió una respuesta inválida",
        error,
        "invalid_response"
      );
    }
  }
  return (await res.text()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "DELETE" }),
  upload: <T>(path: string, form: FormData, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body: form }),
};

export const auth = {
  login: async (email: string, password: string) => {
    const response = await api.post<{ user: { id: string; email: string; name: string; role: string; adminId: string; apps: string[] } }>(
      "/auth/login",
      { email, password }
    );
    requirePersistedEntity(response?.user, "El servidor devolvió una sesión inválida");
    if (
      !response.user.email ||
      !response.user.name ||
      !response.user.adminId ||
      !["ADMIN", "REPORTER", "VIEWER"].includes(response.user.role) ||
      !Array.isArray(response.user.apps) ||
      response.user.apps.some((app) => !["pma", "rgdp", "geo"].includes(app))
    ) {
      throw new ApiError(200, "El servidor devolvió una sesión inválida", response, "invalid_response");
    }
    return response;
  },
  logout: async () => requireOkReceipt(await api.post<unknown>("/auth/logout"), "El servidor no confirmó el cierre de sesión"),
  refresh: async () => requireOkReceipt(await api.post<unknown>("/auth/refresh"), "El servidor no confirmó la renovación de sesión"),
  forgot: async (email: string) => requireOkReceipt(
    await api.post<unknown>("/auth/forgot-password", { email }),
    "El servidor no confirmó la solicitud de recuperación"
  ),
  reset: async (token: string, password: string) => requireOkReceipt(
    await api.post<unknown>("/auth/reset-password", { token, password }),
    "El servidor no confirmó el cambio de contraseña"
  ),
  setPassword: async (token: string, password: string) => requireOkReceipt(
    await api.post<unknown>("/auth/set-password", { token, password }),
    "El servidor no confirmó la contraseña"
  ),
  me: () => api.get<{ user: {
    sub?: string;
    id?: string;
    email: string;
    name: string;
    role: "ADMIN" | "REPORTER" | "VIEWER";
    adminId: string;
    apps: Array<"pma" | "rgdp" | "geo">;
  } }>("/auth/me"),
};
