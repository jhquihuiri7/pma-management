import { createHash } from "node:crypto";
import { env } from "../lib/env.js";
import { SynologySmbStorage } from "./synology-smb.js";

export interface StorageProvider {
  /** Write a file at the given storage-relative path. Creates parent dirs. */
  upload(args: { path: string; data: Buffer | Uint8Array; contentType?: string }): Promise<void>;

  /**
   * Write a file by streaming from a Readable, never buffering the whole payload
   * in memory. For large uploads (orthophotos of several GB). Creates parent
   * dirs and returns the number of bytes written.
   */
  uploadStream(
    path: string,
    readable: NodeJS.ReadableStream,
    options?: { maxBytes?: number },
  ): Promise<number>;

  /** Read a file from the storage-relative path. */
  download(path: string): Promise<Buffer>;

  /** Delete a file (no-op if it does not exist). */
  delete(path: string): Promise<void>;

  /** Delete a directory recursively (no-op if it does not exist). */
  deleteDir(path: string): Promise<void>;

  /** Check existence. */
  exists(path: string): Promise<boolean>;

  /** Stream a file. */
  stream(path: string): Promise<NodeJS.ReadableStream>;

  /** Preflight metadata without loading file contents into memory. */
  stat(path: string): Promise<{ size: number; modifiedAt: Date }>;

  /** Get a public URL for the file (proxied through the API). */
  getUrl(path: string): string;

  /**
   * Resolve a storage-relative path to an absolute filesystem path, applying the
   * same traversal guard as every other method. The worker needs this to hand
   * real paths to GDAL (which can't speak the storage abstraction). Only the
   * worker/API — never the browser — sees these paths.
   */
  resolve(path: string): string;

  /** Move/rename a file or directory inside storage. */
  move(fromPath: string, toPath: string): Promise<void>;

  /** List entries inside a directory (non-recursive). */
  list(path: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>>;
}

/** Raised while streaming, before an oversized object can be fully written. */
export class StorageUploadTooLargeError extends Error {
  readonly code = "STORAGE_UPLOAD_TOO_LARGE";

  constructor(readonly maxBytes: number) {
    super(`Storage upload exceeds the ${maxBytes}-byte limit`);
    this.name = "StorageUploadTooLargeError";
  }
}

let _provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!_provider) {
    _provider = new SynologySmbStorage(env.STORAGE_ROOT, env.STORAGE_PUBLIC_BASE_URL);
  }
  return _provider;
}

export function buildEvidencePath(args: {
  subsystem: "pma" | "rgdp";
  planId: string;
  evidenceId: string;
  planName?: string;
  planItemId?: string;
  planItemName?: string;
  periodFolder?: string;
  fileName: string;
}): string {
  const app = args.subsystem.toUpperCase();
  const plan = safePathSegment(args.planName, args.planId);
  const file = safeFileName(args.fileName);

  if (!args.planItemId && !args.planItemName) {
    return [app, plan, "_evidences", safePathSegment(args.evidenceId, "evidence"), file].join("/");
  }

  const item = safePathSegment(args.planItemName, args.planItemId ?? "Item");
  const parts = [app, plan, item];
  if (args.periodFolder) parts.push(safePathSegment(args.periodFolder, args.periodFolder));
  parts.push("_evidences", safePathSegment(args.evidenceId, "evidence"), file);
  return parts.join("/");
}

/**
 * Storage layout for the GIS visualizer. Paths are keyed by map/layer UUIDs
 * (never user-supplied strings) so they are inherently traversal-safe.
 *
 *   GEO/maps/{mapId}/layers/{layerId}/data.geojson   normalized GeoJSON (rendered)
 *   GEO/maps/{mapId}/layers/{layerId}/source.<ext>   original upload (provenance)
 */
export function buildGeoMapDir(mapId: string): string {
  return `GEO/maps/${mapId}`;
}

export function buildGeoLayerDir(mapId: string, layerId: string): string {
  return `${buildGeoMapDir(mapId)}/layers/${layerId}`;
}

export function buildGeoLayerDataPath(mapId: string, layerId: string): string {
  // GeoJSON is stored gzip-compressed; served with Content-Encoding: gzip.
  return `${buildGeoLayerDir(mapId, layerId)}/data.geojson.gz`;
}

export function buildGeoLayerSourcePath(mapId: string, layerId: string, ext: string): string {
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${buildGeoLayerDir(mapId, layerId)}/source.${clean}`;
}

/**
 * Storage layout for raster layers (orthophotos). Like the vector helpers above,
 * every path is keyed by map/layer UUIDs (never user-supplied strings) so it is
 * inherently traversal-safe. The user-supplied original filename is the only
 * free-form segment and is sanitized with safeFileName().
 *
 *   GEO/maps/{mapId}/rasters/{rasterLayerId}/original/<name>.tif   uploaded original (+ sidecars)
 *   GEO/maps/{mapId}/rasters/{rasterLayerId}/cog/cog.tif           generated COG (TiTiler reads this)
 *   GEO/maps/{mapId}/rasters/{rasterLayerId}/tmp/                  transient processing scratch
 *   GEO/maps/{mapId}/rasters/{rasterLayerId}/processing.log        GDAL stdout/stderr
 */
export function buildGeoRasterDir(mapId: string, rasterLayerId: string): string {
  return `${buildGeoMapDir(mapId)}/rasters/${rasterLayerId}`;
}

export function buildGeoRasterOriginalDir(mapId: string, rasterLayerId: string): string {
  return `${buildGeoRasterDir(mapId, rasterLayerId)}/original`;
}

/** Path to the uploaded original. Sidecars (.tfw/.prj/...) are stored in the same dir. */
export function buildGeoRasterOriginalPath(mapId: string, rasterLayerId: string, fileName: string): string {
  return `${buildGeoRasterOriginalDir(mapId, rasterLayerId)}/${safeFileName(fileName)}`;
}

/** Path to the generated COG. Fixed name (no user input) so it is always traversal-safe. */
export function buildGeoRasterCogPath(mapId: string, rasterLayerId: string): string {
  return `${buildGeoRasterDir(mapId, rasterLayerId)}/cog/cog.tif`;
}

export function buildGeoRasterTmpDir(mapId: string, rasterLayerId: string): string {
  return `${buildGeoRasterDir(mapId, rasterLayerId)}/tmp`;
}

export function buildGeoRasterLogPath(mapId: string, rasterLayerId: string): string {
  return `${buildGeoRasterDir(mapId, rasterLayerId)}/processing.log`;
}

export function buildFormatPath(args: {
  subsystem: "pma" | "rgdp";
  formatId: string;
  fileName: string;
}): string {
  return `${args.subsystem.toUpperCase()}/_formats/${safePathSegment(args.formatId, "format")}/${safeFileName(args.fileName)}`;
}

/**
 * Persist a file and its database record as one observable operation.
 *
 * A filesystem and PostgreSQL cannot share a transaction. The file therefore
 * uses an object-specific path, is verified after upload, and is removed (with
 * a second verification) if the database write rejects. A failed compensation
 * is surfaced as an AggregateError instead of being silently reported as a
 * successful upload.
 */
export async function persistFileAndRecord<T>(args: {
  path: string;
  data: Buffer | Uint8Array;
  contentType?: string;
  persist: () => Promise<T>;
  storage?: StorageProvider;
}): Promise<T> {
  const storage = args.storage ?? getStorage();
  let uploadAttempted = false;

  try {
    if (await storage.exists(args.path)) {
      throw new Error(`Refusing to overwrite an existing storage object: ${args.path}`);
    }
    uploadAttempted = true;
    await storage.upload({ path: args.path, data: args.data, contentType: args.contentType });
    const stored = await storage.stat(args.path);
    if (stored.size !== args.data.byteLength) {
      throw new Error(
        `Storage size mismatch for ${args.path}: expected ${args.data.byteLength}, received ${stored.size}`
      );
    }
    return await args.persist();
  } catch (error) {
    if (!uploadAttempted) throw error;

    try {
      if (await storage.exists(args.path)) {
        await storage.delete(args.path);
      }
      if (await storage.exists(args.path)) {
        throw new Error(`Storage compensation did not remove file: ${args.path}`);
      }
    } catch (compensationError) {
      throw new AggregateError(
        [asError(error), asError(compensationError)],
        `File persistence failed and compensation could not be verified: ${args.path}`
      );
    }
    throw error;
  }
}

const MAX_STORAGE_COMPONENT_BYTES = 255;
const STORAGE_COMPONENT_HASH_HEX_LENGTH = 12;

function safePathSegment(value: string | null | undefined, fallback: string): string {
  const normalized = normalizeStorageComponent(value ?? fallback);
  const normalizedFallback = normalizeStorageComponent(fallback);
  const candidate = isUsableStorageComponent(normalized)
    ? normalized
    : isUsableStorageComponent(normalizedFallback)
      ? normalizedFallback
      : "segmento";
  return fitStorageComponent(candidate);
}

function safeFileName(fileName: string): string {
  const normalized = normalizeStorageComponent(fileName);
  const candidate = isUsableStorageComponent(normalized) ? normalized : "archivo";
  if (Buffer.byteLength(candidate, "utf8") <= MAX_STORAGE_COMPONENT_BYTES) return candidate;

  // Keep conventional extensions recognizable while placing the stable hash
  // next to the truncated basename. Restricting this to short ASCII suffixes
  // avoids letting a user-controlled, multi-byte "extension" consume the byte
  // budget needed for a collision-resistant name.
  const extension = candidate.match(/\.[a-z0-9]{1,20}$/i)?.[0] ?? "";
  const basename = extension ? candidate.slice(0, -extension.length) : candidate;
  return fitStorageComponent(basename, extension, candidate);
}

function normalizeStorageComponent(value: string): string {
  return value.trim().replace(/[\\/\u0000-\u001f\u007f]/g, "-");
}

function isUsableStorageComponent(value: string): boolean {
  return value.length > 0 && value !== "." && value !== "..";
}

/**
 * Fit a single filesystem/SMB path component into the portable 255-byte limit.
 * Truncation iterates Unicode code points, so it never emits a split surrogate
 * or partial UTF-8 sequence. A digest of the complete normalized value keeps
 * long names deterministic and distinguishes inputs sharing the same prefix.
 */
function fitStorageComponent(value: string, extension = "", hashInput = value): string {
  if (!extension && Buffer.byteLength(value, "utf8") <= MAX_STORAGE_COMPONENT_BYTES) return value;

  const digest = createHash("sha256")
    .update(hashInput, "utf8")
    .digest("hex")
    .slice(0, STORAGE_COMPONENT_HASH_HEX_LENGTH);
  const suffix = `-${digest}${extension}`;
  const prefixBudget = MAX_STORAGE_COMPONENT_BYTES - Buffer.byteLength(suffix, "utf8");
  const prefix = truncateUtf8(value, Math.max(0, prefixBudget));
  return `${prefix}${suffix}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
