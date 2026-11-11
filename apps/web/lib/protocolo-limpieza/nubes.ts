import {
  BYTES_CABECERA_LAS,
  claveSitio,
  extensionNube,
  lasIncompleto,
  leerCabeceraLas,
  MAX_NUBE_BYTES,
  type CabeceraLas,
  type DatosNube,
  type MetadatosNube,
  type NubePuntos,
} from "@pma/types/protocolo-limpieza";
import { ApiError, api, apiErrorFromResponse } from "@/lib/api-client";

// Visualización 3D: the clouds' API (apps/api/src/routes/protocoloLimpieza),
// the check of a file before uploading it and what the view shows of each cloud.

const BASE = "/protocolo-limpieza/nubes";
const PROXY = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";

export async function listarNubes(signal?: AbortSignal): Promise<NubePuntos[]> {
  const body = await api.get<{ nubes?: unknown }>(BASE, { signal, cache: "no-store" });
  if (!Array.isArray(body?.nubes)) throw new ApiError(200, "El servidor devolvió una respuesta inválida", body, "invalid_response");
  return body.nubes as NubePuntos[];
}

export function editarNube(id: string, version: number, datos: DatosNube): Promise<NubePuntos> {
  return api.put<NubePuntos>(`${BASE}/${encodeURIComponent(id)}`, { version, ...datos });
}

export function eliminarNube(id: string): Promise<{ ok: boolean }> {
  return api.delete<{ ok: boolean }>(`${BASE}/${encodeURIComponent(id)}`);
}

export function reintentarNube(id: string): Promise<NubePuntos> {
  return api.post<NubePuntos>(`${BASE}/${encodeURIComponent(id)}/reintentar`, {});
}

/** Same origin through the API proxy: the session cookie goes with every range request. */
export const urlCopc = (id: string) => `${PROXY}${BASE}/${encodeURIComponent(id)}/copc`;
export const urlOriginal = (id: string) => `${PROXY}${BASE}/${encodeURIComponent(id)}/original`;

export interface ProgresoSubida {
  enviados: number;
  total: number;
}

/**
 * Uploads a cloud with its data. XMLHttpRequest, because fetch does not report
 * the progress of what it sends. The session is renewed first through SIGTAR's
 * client: the API checks it when the request starts, so a long upload does
 * not expire halfway. The data go before the file (the API refuses wrong data
 * before reading the file).
 */
export async function subirNube(
  datos: DatosNube,
  archivo: File,
  alProgreso: (p: ProgresoSubida) => void,
  signal?: AbortSignal,
): Promise<NubePuntos> {
  await listarNubes(signal);
  const form = new FormData();
  form.append("sitio", datos.sitio);
  form.append("fecha", datos.fecha);
  form.append("descripcion", datos.descripcion);
  form.append("archivo", archivo, archivo.name);
  return new Promise<NubePuntos>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${PROXY}${BASE}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => alProgreso({ enviados: e.loaded, total: e.lengthComputable ? e.total : archivo.size });
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as NubePuntos);
        } catch {
          reject(new ApiError(xhr.status, "El servidor devolvió una respuesta inválida", xhr.responseText, "invalid_response"));
        }
        return;
      }
      reject(await apiErrorFromResponse(new Response(xhr.responseText, { status: xhr.status })));
    };
    xhr.onerror = () => reject(new ApiError(0, "Se perdió la conexión durante la subida. Revisa la red e inténtalo de nuevo.", undefined, "network"));
    xhr.onabort = () => reject(new DOMException("Subida cancelada", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/**
 * Checks a file in the browser before uploading it, with the same header
 * reading as the API: a wrong or cut file is refused without sending it.
 */
export async function revisarArchivoNube(archivo: File): Promise<CabeceraLas> {
  if (!extensionNube(archivo.name)) throw new Error("Elige un archivo .las o .laz.");
  if (archivo.size > MAX_NUBE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_NUBE_BYTES / 1024 ** 3} GB.`);
  const cabecera = leerCabeceraLas(new Uint8Array(await archivo.slice(0, BYTES_CABECERA_LAS).arrayBuffer()));
  const incompleto = lasIncompleto(cabecera, archivo.size);
  if (incompleto) throw new Error(incompleto);
  return cabecera;
}

// ── What the view shows ─────────────────────────────────────────────────────

export interface SitioNubes {
  clave: string;
  sitio: string;
  /** Oldest survey first: the timeline. */
  nubes: NubePuntos[];
}

/** Clouds by site; the site surveyed last comes first. */
export function agruparPorSitio(nubes: readonly NubePuntos[]): SitioNubes[] {
  const grupos = new Map<string, SitioNubes>();
  for (const n of nubes) {
    const clave = claveSitio(n.sitio);
    const grupo = grupos.get(clave) ?? { clave, sitio: n.sitio, nubes: [] };
    grupo.nubes.push(n);
    grupos.set(clave, grupo);
  }
  const porFecha = (a: NubePuntos, b: NubePuntos) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn);
  const lista = Array.from(grupos.values());
  lista.forEach((g) => g.nubes.sort(porFecha));
  const ultima = (g: SitioNubes) => g.nubes[g.nubes.length - 1];
  return lista.sort((a, b) => porFecha(ultima(b), ultima(a)) || a.sitio.localeCompare(b.sitio, "es"));
}

/** The cloud to show in a timeline: the one asked for, else the latest ready one, else the latest. */
export function nubeInicial(nubes: readonly NubePuntos[], pedida?: string | null): NubePuntos | null {
  return nubes.find((n) => n.id === pedida) ?? [...nubes].reverse().find((n) => n.estado === "lista") ?? nubes[nubes.length - 1] ?? null;
}

const decimal = (v: number, digitos = 1) => v.toLocaleString("es-EC", { maximumFractionDigits: digitos });

export function formatoBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${decimal(bytes / 1024 ** 3, 2)} GB`;
  if (bytes >= 1024 ** 2) return `${decimal(bytes / 1024 ** 2, bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${decimal(bytes / 1024, 0)} KB`;
  return `${bytes} B`;
}

export function formatoPuntos(puntos: number): string {
  if (puntos >= 1e6) return `${decimal(puntos / 1e6)} millones de puntos`;
  if (puntos >= 1e3) return `${decimal(puntos / 1e3, 0)} mil puntos`;
  return `${puntos} puntos`;
}

export function textoEstado(n: Pick<NubePuntos, "estado" | "error">): string {
  if (n.estado === "lista") return "Lista";
  if (n.estado === "procesando") return "Procesando";
  return n.error ? `Error: ${n.error}` : "Error al convertir";
}

/** ASPRS classes (LAS 1.4) in Spanish, and the colour each one has in the viewer and its legend. */
const CLASES: Record<number, readonly [nombre: string, color: string]> = {
  0: ["Nunca clasificado", "#b0b7c3"],
  1: ["Sin clasificar", "#8b95a5"],
  2: ["Suelo", "#b07d48"],
  3: ["Vegetación baja", "#a3d977"],
  4: ["Vegetación media", "#5cb85c"],
  5: ["Vegetación alta", "#1e7b3a"],
  6: ["Edificación", "#e4572e"],
  7: ["Ruido bajo", "#f06292"],
  8: ["Punto clave", "#ffd54f"],
  9: ["Agua", "#2b8cbe"],
  10: ["Riel", "#7e57c2"],
  11: ["Superficie de vía", "#5f6b7a"],
  12: ["Superposición", "#ffb300"],
  13: ["Protector de cable", "#90a4ae"],
  14: ["Conductor de cable", "#78909c"],
  15: ["Torre de transmisión", "#546e7a"],
  16: ["Conector de cable", "#455a64"],
  17: ["Puente", "#8d6e63"],
  18: ["Ruido alto", "#ec407a"],
  64: ["Objeto artificial", "#26c6da"],
};

export function claseNube(codigo: number): { nombre: string; color: string } {
  const [nombre, color] = CLASES[codigo] ?? [`Clase ${codigo}`, "#a1887f"];
  return { nombre, color };
}

/** Elevation scale, low to high. */
export const RAMPA_ALTURA = ["#2c7bb6", "#00a6ca", "#00ccbc", "#90eb9d", "#ffff8c", "#f9d057", "#f29e2e", "#e76818", "#d7191c"] as const;

/**
 * The range the elevation colours span: the mean ± a few deviations, held
 * inside the cloud's limits. A few stray points far above or below (photogrammetry
 * leaves some) would otherwise wash every colour out.
 */
export function rangoAltura(z: MetadatosNube["z"]): [number, number] {
  const bajo = Math.max(z.min, z.media - 2 * z.desviacion);
  const alto = Math.min(z.max, z.media + 3 * z.desviacion);
  return alto > bajo ? [bajo, alto] : [z.min, Math.max(z.max, z.min + 1)];
}
