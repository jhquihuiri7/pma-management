export interface StorageProvider {
  /** Write a file at the given storage-relative path. Creates parent dirs. */
  upload(args: { path: string; data: Buffer | Uint8Array; contentType?: string }): Promise<void>;

  /**
   * Write a file by streaming from a Readable, never buffering the whole payload
   * in memory. For large uploads (orthophotos of several GB). Creates parent
   * dirs and returns the number of bytes written.
   */
  uploadStream(path: string, readable: NodeJS.ReadableStream): Promise<number>;

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

import { SynologySmbStorage } from "./synology-smb.js";
import { env } from "../lib/env.js";

let _provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!_provider) {
    _provider = new SynologySmbStorage(env.STORAGE_ROOT, env.STORAGE_PUBLIC_BASE_URL);
  }
  return _provider;
}

export function buildEvidencePath(args: {
  adminId: string;
  subsystem: "pma" | "rgdp";
  planId: string;
  planName?: string;
  subsystemName?: string;
  planItemId?: string;
  planItemName?: string;
  periodFolder?: string;
  fileName: string;
}): string {
  const app = args.subsystem.toUpperCase();
  const plan = safePathSegment(args.planName, args.planId);
  const file = safeFileName(args.fileName);

  if (!args.planItemId && !args.planItemName) {
    return [app, plan, file].join("/");
  }

  const item = safePathSegment(args.planItemName, args.planItemId ?? "Item");
  const parts = [app, plan, item];
  if (args.periodFolder) parts.push(safePathSegment(args.periodFolder, args.periodFolder));
  parts.push(file);
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
  adminId: string;
  subsystem: "pma" | "rgdp";
  fileName: string;
}): string {
  return `${args.adminId}/${args.subsystem}/_formats/${args.fileName}`;
}

function safePathSegment(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? fallback).trim().replace(/[\\/]/g, "-");
  return normalized.length > 0 ? normalized : fallback;
}

function safeFileName(fileName: string): string {
  return fileName.trim().replace(/[\\/]/g, "-") || "archivo";
}
