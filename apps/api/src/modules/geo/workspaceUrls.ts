/**
 * Addresses of catalog data as RustGIS sees them. They hold identifiers only —
 * never storage paths or credentials: the session cookie authorises each request
 * (RustGIS is served from the same origin), so a saved project never keeps a link
 * that expires.
 *
 * The file extension matters: RustGIS decides how to read an address by it
 * (`.fgb` is streamed by range and kept as a reference, `.tif` is a COG read in
 * place, anything else is downloaded and copied into the project).
 *
 * The revision (vectors) or version (rasters, from processed_at) is part of the
 * path, so every address names immutable bytes and can be cached for good; when
 * the data change, the project resolver re-points saved projects at the new one.
 */

export const WORKSPACE_API_PREFIX = "/api-proxy/geo/workspace/v1";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export type CatalogRef =
  | { kind: "vector"; id: string; revision: number; form: "fgb" | "geojson" }
  | { kind: "raster"; id: string; version: number; form: "cog" | "tiles" };

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function vectorFgbPath(layerId: string, revision: number): string {
  return `${WORKSPACE_API_PREFIX}/vectors/${layerId}/r/${revision}/data.fgb`;
}

/** The whole GeoJSON (a copy inside the project). Its file name is unique so the
 * copy can be recognised later in dataset.source. */
export function vectorGeojsonFileName(layerId: string, revision: number): string {
  return `${layerId}-r${revision}.geojson`;
}

export function vectorGeojsonPath(layerId: string, revision: number): string {
  return `${WORKSPACE_API_PREFIX}/vectors/${layerId}/r/${revision}/${vectorGeojsonFileName(layerId, revision)}`;
}

export function rasterCogPath(rasterId: string, version: number): string {
  return `${WORKSPACE_API_PREFIX}/rasters/${rasterId}/v/${version}/cog.tif`;
}

export function rasterTilesTemplate(rasterId: string, version: number): string {
  return `${WORKSPACE_API_PREFIX}/rasters/${rasterId}/v/${version}/tiles/{z}/{x}/{y}.png`;
}

export function catalogRefPath(ref: CatalogRef): string {
  if (ref.kind === "vector") {
    return ref.form === "fgb" ? vectorFgbPath(ref.id, ref.revision) : vectorGeojsonPath(ref.id, ref.revision);
  }
  return ref.form === "cog" ? rasterCogPath(ref.id, ref.version) : rasterTilesTemplate(ref.id, ref.version);
}

export function catalogRefKey(ref: Pick<CatalogRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id.toLowerCase()}`;
}

const VECTOR_RE = new RegExp(
  `/geo/workspace/v1/vectors/(${UUID})/r/(\\d{1,9})/(data\\.fgb|(${UUID})-r(\\d{1,9})\\.geojson)$`,
  "i",
);
const RASTER_RE = new RegExp(
  `/geo/workspace/v1/rasters/(${UUID})/v/(\\d{1,16})/(cog\\.tif|tiles/\\{z\\}/\\{x\\}/\\{y\\}\\.png)$`,
  "i",
);

/** Recognises one of our addresses, whatever origin it was saved with. The
 * fragment (a COG's `#bands=…&range=…` look) and query are ignored. */
export function parseCatalogUrl(url: string): CatalogRef | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const vector = VECTOR_RE.exec(path);
  if (vector) {
    const id = vector[1]!.toLowerCase();
    const revision = Number(vector[2]);
    if (vector[3]!.toLowerCase() === "data.fgb") return { kind: "vector", id, revision, form: "fgb" };
    // The copy's file name must repeat the same layer and revision.
    if (vector[4]!.toLowerCase() !== id || Number(vector[5]) !== revision) return null;
    return { kind: "vector", id, revision, form: "geojson" };
  }
  const raster = RASTER_RE.exec(path);
  if (raster) {
    const form = raster[3]!.toLowerCase() === "cog.tif" ? "cog" : "tiles";
    return { kind: "raster", id: raster[1]!.toLowerCase(), version: Number(raster[2]), form };
  }
  return null;
}

/** Recognises the file name RustGIS keeps for a downloaded GeoJSON copy. */
export function parseGeojsonCopyName(name: string): { id: string; revision: number } | null {
  const match = new RegExp(`^(?:.*/)?(${UUID})-r(\\d{1,9})\\.geojson$`, "i").exec(name ?? "");
  return match ? { id: match[1]!.toLowerCase(), revision: Number(match[2]) } : null;
}

/** The same address on another origin, keeping its fragment. */
export function withOrigin(origin: string, ref: CatalogRef, fragment = ""): string {
  return `${origin.replace(/\/+$/, "")}${catalogRefPath(ref)}${fragment}`;
}

export function fragmentOf(url: string): string {
  const at = url.indexOf("#");
  return at >= 0 ? url.slice(at) : "";
}
