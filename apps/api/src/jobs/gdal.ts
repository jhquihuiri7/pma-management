import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { env } from "../lib/env.js";

/**
 * Thin wrappers around the GDAL CLI (gdalinfo, gdal_translate). GDAL is provided
 * by the worker's Docker image (apps/api/Dockerfile.worker) — never installed on
 * the host. Every invocation streams stdout/stderr into the layer's
 * processing.log and is bounded by RASTER_JOB_TIMEOUT_MS.
 */

export interface GdalInfo {
  width: number;
  height: number;
  bandCount: number;
  hasAlpha: boolean;
  nodata: number | null;
  crsWkt: string | null;
  srid: number | null;
  resolutionX: number | null;
  resolutionY: number | null;
  bbox4326: [number, number, number, number] | null;
}

async function runGdal(bin: string, args: string[], logPath: string): Promise<string> {
  await appendFile(logPath, `\n${new Date().toISOString()} $ ${bin} ${args.join(" ")}\n`).catch(() => {});
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, GDAL_CACHEMAX: String(env.GDAL_CACHEMAX) },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${env.RASTER_JOB_TIMEOUT_MS} ms`));
    }, env.RASTER_JOB_TIMEOUT_MS);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT here means GDAL isn't on PATH (i.e. running outside the worker image).
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stderr) appendFile(logPath, `[stderr] ${stderr}\n`).catch(() => {});
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited with code ${code}: ${stderr.slice(0, 1000)}`));
    });
  });
}

// WKT2 uses ID["EPSG",32717]; WKT1 uses AUTHORITY["EPSG","32717"]. The CRS code
// is the outermost (last) authority in the string.
function extractEpsg(wkt: string): number | null {
  const matches = [...wkt.matchAll(/(?:ID|AUTHORITY)\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  if (matches.length === 0) return null;
  const code = parseInt(matches[matches.length - 1][1], 10);
  return Number.isFinite(code) ? code : null;
}

function extentToBbox(extent: unknown): [number, number, number, number] | null {
  const ring = (extent as { coordinates?: number[][][] })?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of ring) {
    const [x, y] = pt;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

/** Read metadata with `gdalinfo -json`. Throws if the file isn't readable by GDAL. */
export async function gdalInfo(absPath: string, logPath: string): Promise<GdalInfo> {
  const stdout = await runGdal("gdalinfo", ["-json", absPath], logPath);
  const j = JSON.parse(stdout) as {
    size?: [number, number];
    geoTransform?: number[];
    coordinateSystem?: { wkt?: string };
    wgs84Extent?: unknown;
    bands?: Array<{ colorInterpretation?: string; noDataValue?: number }>;
  };
  const [width = 0, height = 0] = j.size ?? [];
  const bands = Array.isArray(j.bands) ? j.bands : [];
  const hasAlpha = bands.some((b) => String(b.colorInterpretation).toLowerCase() === "alpha");
  const nodataBand = bands.find((b) => typeof b.noDataValue === "number");
  const wkt = j.coordinateSystem?.wkt && j.coordinateSystem.wkt.length > 0 ? j.coordinateSystem.wkt : null;
  const gt = j.geoTransform;
  return {
    width,
    height,
    bandCount: bands.length,
    hasAlpha,
    nodata: nodataBand?.noDataValue ?? null,
    crsWkt: wkt,
    srid: wkt ? extractEpsg(wkt) : null,
    resolutionX: gt ? Math.abs(gt[1]) : null,
    resolutionY: gt ? Math.abs(gt[5]) : null,
    bbox4326: extentToBbox(j.wgs84Extent),
  };
}

export type CogCompression = "JPEG" | "WEBP" | "DEFLATE";

/**
 * Pick a COG compression: JPEG for plain RGB (tiny, lossy), WEBP when there's an
 * alpha band / >=4 bands (keeps transparency), DEFLATE otherwise (lossless, safe
 * for single-band or unusual rasters).
 */
export function chooseCompression(info: GdalInfo): CogCompression {
  if (info.hasAlpha || info.bandCount >= 4) return "WEBP";
  if (info.bandCount === 3) return "JPEG";
  return "DEFLATE";
}

/**
 * Build a Cloud Optimized GeoTIFF in the source CRS (TiTiler reprojects to web
 * mercator on the fly — Phase 6). Overviews are produced automatically by the
 * COG driver.
 */
export async function buildCog(absInput: string, absOutput: string, info: GdalInfo, logPath: string): Promise<CogCompression> {
  const compression = chooseCompression(info);
  const args = [
    "-of", "COG",
    "-co", `COMPRESS=${compression}`,
    "-co", "BLOCKSIZE=512",
    "-co", "OVERVIEW_RESAMPLING=AVERAGE",
    "-co", "BIGTIFF=YES",
    "-co", "NUM_THREADS=ALL_CPUS",
  ];
  if (compression === "JPEG" || compression === "WEBP") args.push("-co", "QUALITY=85");
  args.push(absInput, absOutput);
  await runGdal("gdal_translate", args, logPath);
  return compression;
}
