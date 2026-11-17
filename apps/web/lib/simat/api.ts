import { api } from "@/lib/api-client";
import type {
  SimatConector,
  SimatCriterio,
  SimatCriterioEntrada,
  SimatEstado,
  SimatMareografo,
  SimatNivelMar,
  SimatNivelObservadoEntrada,
  SimatPronostico,
  SimatSerieLluvia,
} from "@pma/types";

// SIMAT-GAL API (apps/api/src/routes/simat). Every call goes through SIGTAR's
// client, so an expired access cookie is renewed on the way. Reads are public.
const BASE = "/simat";

export function obtenerEstado(signal?: AbortSignal): Promise<SimatEstado> {
  return api.get<SimatEstado>(`${BASE}/estado`, { signal, cache: "no-store" });
}

export function obtenerSerieLluvia(id: string, signal?: AbortSignal): Promise<SimatSerieLluvia> {
  return api.get<SimatSerieLluvia>(`${BASE}/estaciones/${encodeURIComponent(id)}/lluvia`, { signal, cache: "no-store" });
}

export function obtenerPronostico(id: string, signal?: AbortSignal): Promise<SimatPronostico> {
  return api.get<SimatPronostico>(`${BASE}/estaciones/${encodeURIComponent(id)}/pronostico`, { signal });
}

export function obtenerMareografo(codigo: string, signal?: AbortSignal): Promise<SimatMareografo> {
  return api.get<SimatMareografo>(`${BASE}/mareografos/${encodeURIComponent(codigo)}`, { signal, cache: "no-store" });
}

export function obtenerMareas(puerto: string, signal?: AbortSignal): Promise<SimatNivelMar[]> {
  return api.get<SimatNivelMar[]>(`${BASE}/mareas?puerto=${encodeURIComponent(puerto)}`, { signal, cache: "no-store" });
}

export function guardarCriterio(entrada: SimatCriterioEntrada): Promise<SimatCriterio> {
  return api.put<SimatCriterio>(`${BASE}/criterios`, entrada);
}

export function registrarNivelObservado(entrada: SimatNivelObservadoEntrada): Promise<{ ok: true }> {
  return api.post<{ ok: true }>(`${BASE}/nivel-observado`, entrada);
}

export function sincronizarConector(conector: SimatConector): Promise<{ ok: boolean; registros: number; mensaje: string }> {
  return api.post(`${BASE}/sincronizar/${encodeURIComponent(conector)}`, {});
}
