/**
 * Thin fetch wrapper for the @pma/api backend.
 *
 * - Server-side: uses API_BASE_URL env (default: http://localhost:4000).
 * - Browser: uses NEXT_PUBLIC_API_BASE_URL env (default: /api-proxy → rewrite en next.config).
 * - Sends cookies with every request (credentials: "include").
 * - On 401 with a body that signals expired access, transparently calls
 *   POST /auth/refresh once and retries the original request.
 *
 * Used from client components and from server components / route handlers
 * during the Phase 2 transition. Once Phase 2 completes, the Next.js API
 * routes under apps/web/app/**\/api/** will be deleted and all data access
 * will go through this client.
 */

const isServer = typeof window === "undefined";
const BASE_URL = isServer
  ? (process.env.API_BASE_URL ?? "http://localhost:4000")
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy");

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  raw?: boolean; // skip JSON parsing
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) {
      body = opts.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(opts.body);
    }
  }

  let res = await fetch(url, { ...opts, headers, body, credentials: "include" });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    const ok = await tryRefresh();
    if (ok) {
      res = await fetch(url, { ...opts, headers, body, credentials: "include" });
    }
  }

  if (!res.ok) {
    let detail: unknown = undefined;
    let message = `Request failed: ${res.status}`;
    try {
      const j = await res.json();
      detail = j;
      message = j?.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, message, detail);
  }

  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
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

/**
 * Compatibility wrapper for legacy fetch() callsites.
 *
 * Translates old Next.js API paths to the new backend:
 *   /pma/api/X        → ${BASE_URL}/pma/X
 *   /rgdp/api/X       → ${BASE_URL}/rgdp/X
 *   /pg/api/X         → ${BASE_URL}/pglp/X
 *   /geo/api/X        → ${BASE_URL}/geo/X
 *   /api/auth/X       → ${BASE_URL}/auth/X
 *
 * Other URLs are passed through unchanged. Always sets credentials:include
 * and transparently retries once after /auth/refresh on 401.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let url = input;
  if (typeof url === "string" && url.startsWith("/")) {
    if (url.startsWith("/pma/api/")) url = `${BASE_URL}/pma/${url.slice("/pma/api/".length)}`;
    else if (url.startsWith("/rgdp/api/")) url = `${BASE_URL}/rgdp/${url.slice("/rgdp/api/".length)}`;
    else if (url.startsWith("/pg/api/")) url = `${BASE_URL}/pglp/${url.slice("/pg/api/".length)}`;
    else if (url.startsWith("/geo/api/")) url = `${BASE_URL}/geo/${url.slice("/geo/api/".length)}`;
    else if (url.startsWith("/api/auth/")) url = `${BASE_URL}/auth/${url.slice("/api/auth/".length)}`;
  }
  let res = await fetch(url, { credentials: "include", ...init });
  if (res.status === 401 && !url.includes("/auth/")) {
    const ok = await tryRefresh();
    if (ok) res = await fetch(url, { credentials: "include", ...init });
  }
  return res;
}

export const auth = {
  login: (email: string, password: string) =>
    api.post<{ user: { id: string; email: string; name: string; role: string; adminId: string; apps: string[] } }>(
      "/auth/login",
      { email, password }
    ),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post("/auth/refresh"),
  forgot: (email: string) => api.post("/auth/forgot-password", { email }),
  reset: (token: string, password: string) => api.post("/auth/reset-password", { token, password }),
  setPassword: (token: string, password: string) => api.post("/auth/set-password", { token, password }),
  me: () => api.get<{ user: {
    sub?: string;
    id?: string;
    email: string;
    name: string;
    role: "ADMIN" | "REPORTER" | "VIEWER";
    adminId: string;
    apps: Array<"pma" | "rgdp" | "pglp" | "geo">;
  } }>("/auth/me"),
};
