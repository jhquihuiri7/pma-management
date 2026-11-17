// Guarded HTTP access for the SIMAT connectors. Ported from integraciones.py's
// check_url/get_data: HTTPS only, an institutional host allow-list, no
// redirects, a size cap and a timeout. Every URL is built internally from the
// allow-list below (never from user input), so this is defence in depth rather
// than the only guard.
//
// INOCAR's certificate chain ends at an SSL.com root missing from the Debian
// trust store (curl/Python fail), but Node ships its own roots and accepts it.
// Do NOT switch Node to the system CA store (NODE_OPTIONS --use-openssl-ca):
// INOCAR would stop working. See docs/plan-integracion-simat.md §2.2.

/** Hosts a SIMAT connector may talk to. */
export const SIMAT_HOSTS = new Set<string>([
  "ierse.uazuay.edu.ec",
  "www.ioc-sealevelmonitoring.org",
  "www.inocar.mil.ec",
  "inocar.mil.ec",
  "inamhi.gob.ec",
  "datazone.darwinfoundation.org",
  "tgftp.nws.noaa.gov",
  "api.open-meteo.com",
]);

const USER_AGENT = "SIGTAR-SIMAT/1.0 (+https://sigtar.gobiernogalapagos.gob.ec)";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20_000_000;

export class FuenteError extends Error {}

function assertHostPermitido(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FuenteError("URL inválida.");
  }
  if (parsed.protocol !== "https:") throw new FuenteError("El endpoint debe usar HTTPS.");
  if (!SIMAT_HOSTS.has(parsed.hostname)) {
    throw new FuenteError(`Dominio no autorizado: ${parsed.hostname}`);
  }
  return parsed;
}

interface Opciones {
  timeoutMs?: number;
  maxBytes?: number;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  accept?: string;
}

/**
 * Network-level failures worth retrying. The local network's DNS fails
 * intermittently (ENOTFOUND/EAI_AGAIN for hosts that resolved minutes before),
 * and the sources' servers time out now and then. HTTP status errors are not
 * retried: the source answered, and asking again would not change it.
 */
const ESPERAS_REINTENTO_MS = [2_000, 5_000];

class ErrorDeRed extends FuenteError {}

async function pedir(url: string, opciones: Opciones): Promise<ArrayBuffer> {
  for (let intento = 0; ; intento += 1) {
    try {
      return await pedirUnaVez(url, opciones);
    } catch (err) {
      if (!(err instanceof ErrorDeRed) || intento >= ESPERAS_REINTENTO_MS.length) throw err;
      await new Promise((r) => setTimeout(r, ESPERAS_REINTENTO_MS[intento]));
    }
  }
}

async function pedirUnaVez(url: string, opciones: Opciones): Promise<ArrayBuffer> {
  assertHostPermitido(url);
  const maxBytes = opciones.maxBytes ?? DEFAULT_MAX_BYTES;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opciones.method ?? "GET",
      redirect: "error", // the source must not redirect us elsewhere
      signal: AbortSignal.timeout(opciones.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: opciones.body,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: opciones.accept ?? "application/json,text/csv,text/html,*/*",
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...opciones.headers,
      },
    });
  } catch (err) {
    const code = (err as { name?: string; cause?: { code?: string } })?.cause?.code
      ?? (err as { name?: string })?.name;
    throw new ErrorDeRed(`No se pudo contactar la fuente${code ? ` (${code})` : ""}.`);
  }
  if (!res.ok) throw new FuenteError(`La fuente respondió ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new FuenteError("La respuesta de la fuente es demasiado grande.");
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new FuenteError("La respuesta de la fuente es demasiado grande.");
  return buffer;
}

export async function obtenerTexto(url: string, opciones: Opciones = {}): Promise<string> {
  const buffer = await pedir(url, opciones);
  return new TextDecoder("utf-8").decode(buffer);
}

/** INOCAR's tide tables are Windows-1252 when not valid UTF-8. */
export async function obtenerTextoLatin(url: string, opciones: Opciones = {}): Promise<string> {
  const buffer = await pedir(url, opciones);
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function obtenerJson<T = unknown>(url: string, opciones: Opciones = {}): Promise<T> {
  const texto = await obtenerTexto(url, { accept: "application/json", ...opciones });
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new FuenteError("La fuente devolvió un JSON inválido.");
  }
}
