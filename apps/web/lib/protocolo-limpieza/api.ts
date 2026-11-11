import { ApiError, api } from "@/lib/api-client";
import type { RegistroLimpieza, RegistroLimpiezaEdicion, RegistroLimpiezaEntrada } from "@pma/types/protocolo-limpieza";

// The module's API (apps/api/src/routes/protocoloLimpieza). Every call goes
// through SIGTAR's client, so an expired access cookie is renewed on the way.

const BASE = "/protocolo-limpieza";

export async function listarRegistros(signal?: AbortSignal): Promise<RegistroLimpieza[]> {
  const body = await api.get<{ records?: unknown }>(`${BASE}/registros`, { signal, cache: "no-store" });
  if (!Array.isArray(body?.records)) {
    throw new ApiError(200, "El servidor devolvió una respuesta inválida", body, "invalid_response");
  }
  return body.records as RegistroLimpieza[];
}

export function crearRegistro(entrada: RegistroLimpiezaEntrada): Promise<{ id: string }> {
  return api.post<{ id: string }>(`${BASE}/registros`, entrada);
}

export function editarRegistro(id: string, edicion: RegistroLimpiezaEdicion): Promise<{ id: string }> {
  return api.put<{ id: string }>(`${BASE}/registros/${encodeURIComponent(id)}`, edicion);
}

export async function subirFoto(jpeg: Blob, signal?: AbortSignal): Promise<{ id: string }> {
  const form = new FormData();
  form.append("foto", jpeg, "foto.jpg");
  const body = await api.upload<{ id?: unknown }>(`${BASE}/fotos`, form, { signal });
  if (typeof body?.id !== "string") {
    throw new ApiError(200, "El servidor no confirmó la fotografía", body, "invalid_response");
  }
  return { id: body.id };
}

/** For <img src>: same-origin through the API proxy, so the session cookie goes along. */
export function urlFoto(id: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
  return `${base}${BASE}/fotos/${encodeURIComponent(id)}`;
}
