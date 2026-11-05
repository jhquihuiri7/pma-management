import {
  type CatalogRef,
  catalogRefKey,
  fragmentOf,
  parseCatalogUrl,
  parseGeojsonCopyName,
  rasterCogPath,
  rasterTilesTemplate,
  vectorFgbPath,
  withOrigin,
} from "./workspaceUrls.js";

/**
 * RustGIS project documents (format 1, RustGIS v0.5.0) as the Workspace builds,
 * inspects and re-points them. This is the only module coupled to RustGIS's
 * project schema (crates/engine/src/project.rs, crates/map/src/{lib,tiles,
 * symbology,camera}.rs at a5603d1); it touches only stable members and leaves
 * everything else in a saved project untouched. Re-test it on every RustGIS
 * upgrade (docs/plan-integracion-rustgis.md §2.7, §9).
 */

export const RUSTGIS_PROJECT_FORMAT = 1;
export const RUSTGIS_VERSION = "0.5.0-sigtar.1";
/** Member of the active map where the patched app keeps its active layer. */
export const ACTIVE_FIELD = "sigtar_active";

type Json = Record<string, unknown>;

export type NoticeKind = "unavailable" | "updated" | "preparing" | "copy" | "tiles";
export interface Notice {
  kind: NoticeKind;
  name: string;
  detail?: string;
}

export interface LayerStyleLike {
  mode?: unknown;
  color?: unknown;
  opacity?: unknown;
  strokeWidth?: unknown;
  size?: unknown;
  labels?: unknown;
  labelField?: unknown;
}

export interface VectorEntry {
  id: string;
  name: string;
  geometryType: string; // Point | LineString | Polygon
  visible: boolean;
  zIndex: number;
  style: LayerStyleLike | null;
  revision: number;
  /** Revisions whose FlatGeobuf is ready. */
  fgbReady: ReadonlySet<number>;
}

export interface RasterEntry {
  id: string;
  name: string;
  visible: boolean;
  zIndex: number;
  opacity: number;
  bandCount: number | null;
  hasAlpha: boolean;
  version: number;
}

export interface BuildInput {
  title: string;
  center: [number, number]; // [lat, lng]
  zoom: number;
  basemap?: string; // light | dark | satellite | topo | osm
  vectors: VectorEntry[];
  rasters: RasterEntry[];
  origin: string;
  /** Catalog key (vector:<id> | raster:<id>) of the layer to make active. */
  activeKey?: string | null;
}

/**
 * How the worker writes a COG (jobs/gdal.ts chooseCompression) decides whether
 * RustGIS 0.5 can draw it read in place, or must draw it from the TiTiler tiles:
 * - RGBA and ≥4 bands → WEBP, which its GeoTIFF reader can't decode;
 * - 3 bands → JPEG stored as YCbCr: it decodes it, but the `tiff` crate leaves
 *   the colours in YCbCr and RustGIS shows them as RGB (white turns pink;
 *   seen 2026-11-04 with the 2023 orthophoto);
 * - 1–2 bands → DEFLATE, read in place.
 * Returns why a raster is drawn from tiles, or null when it is read in place.
 */
export function rasterTilesReason(r: Pick<RasterEntry, "bandCount" | "hasAlpha">): string | null {
  if (r.hasAlpha || (r.bandCount ?? 0) >= 4) return "su compresión (WEBP) no se lee por partes en RustGIS";
  if (r.bandCount === 3) return "RustGIS no convierte a RGB los colores de su compresión JPEG (YCbCr) al leerla por partes";
  return null;
}

export function rasterReadableInPlace(r: Pick<RasterEntry, "bandCount" | "hasAlpha">): boolean {
  return rasterTilesReason(r) === null;
}

const EARTH_RADIUS = 6_378_137;
const RES_AT_ZOOM_0 = 156_543.033_928_040_97; // Web Mercator metres per 256-px tile pixel at z0

/** RustGIS's camera (Web Mercator centre, metres per logical pixel) for a Leaflet view. */
export function cameraFor(lat: number, lng: number, zoom: number): Json {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, Number.isFinite(lat) ? lat : 0));
  const clampedLng = Math.max(-180, Math.min(180, Number.isFinite(lng) ? lng : 0));
  const z = Math.max(0, Math.min(24, Number.isFinite(zoom) ? zoom : 7));
  const x = (EARTH_RADIUS * clampedLng * Math.PI) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return { center: { x: round(x, 3), y: round(y, 3) }, res: RES_AT_ZOOM_0 / 2 ** z };
}

const GEOMETRY_TYPES: Record<string, string> = { Point: "Point", LineString: "Polyline", Polygon: "Polygon" };

function rgb(color: unknown, fallback: [number, number, number]): [number, number, number] {
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) {
    return [0, 2, 4].map((i) => parseInt(color.slice(1 + i, 3 + i), 16)) as [number, number, number];
  }
  return fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** RustGIS `Symbol` for the geoportal's LayerStyle (single symbol). */
export function symbolFor(style: LayerStyleLike | null | undefined, geometryType: string): Json {
  const [r, g, b] = rgb(style?.color, [0x3f, 0x7c, 0x5f]);
  const opacity = num(style?.opacity, 0.7, 0, 1);
  const width = num(style?.strokeWidth, 1.5, 0, 20);
  const size = num(style?.size, 6, 0, 100);
  const darker = [r, g, b].map((c) => Math.round(c * 0.6));
  if (geometryType === "Point") {
    return {
      fill: [r, g, b, Math.round(255 * Math.max(opacity, 0.5))],
      stroke: [255, 255, 255, 255],
      stroke_width: Math.min(width, 2),
      size: Math.max(3, Math.min(40, size * 1.5)),
      marker: "Circle",
    };
  }
  if (geometryType === "LineString") {
    return { fill: [r, g, b, 255], stroke: [r, g, b, 255], stroke_width: Math.max(0.5, width), size: 0, marker: "Circle" };
  }
  return {
    fill: [r, g, b, Math.round(255 * opacity * 0.6)],
    stroke: [...darker, 255],
    stroke_width: Math.max(0.3, width),
    size: 0,
    marker: "Circle",
  };
}

function labelsFor(style: LayerStyleLike | null | undefined): Json {
  const field = typeof style?.labelField === "string" ? style.labelField : "";
  return { enabled: style?.labels === true && field.length > 0, field, size: 9, color: [0, 0, 0, 255], halo: true, bold: false };
}

/** Basemaps of the old Workspace (apps/web/components/geo/gis/gis-data.ts) as tile layers. */
export function basemapTile(basemap: string | undefined): Json | null {
  switch (basemap) {
    case "dark":
      return { name: "OpenFreeMap Oscuro", kind: "style", url: "https://tiles.openfreemap.org/styles/dark", attribution: "© OpenStreetMap · OpenMapTiles · OpenFreeMap" };
    case "satellite":
      return {
        name: "Esri World Imagery",
        kind: "raster",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maxZoom: 17,
        attribution: "© Esri",
      };
    case "topo":
      return { name: "OpenTopoMap", kind: "raster", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png", maxZoom: 17, attribution: "© OpenTopoMap" };
    case "osm":
      return { name: "OpenStreetMap", kind: "raster", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19, attribution: "© OpenStreetMap" };
    case "none":
      return null;
    default:
      return { name: "OpenFreeMap Claro", kind: "style", url: "https://tiles.openfreemap.org/styles/positron", attribution: "© OpenStreetMap · OpenMapTiles · OpenFreeMap" };
  }
}

function rasterTile(r: RasterEntry, origin: string, notices: Notice[]): Json {
  const base = { name: r.name, visible: r.visible, opacity: num(r.opacity, 1, 0, 1) };
  const reason = rasterTilesReason(r);
  if (!reason) {
    return { ...base, kind: "cog", url: withOrigin(origin, { kind: "raster", id: r.id, version: r.version, form: "cog" }) };
  }
  notices.push({ kind: "tiles", name: r.name, detail: reason });
  return {
    ...base,
    kind: "raster",
    url: withOrigin(origin, { kind: "raster", id: r.id, version: r.version, form: "tiles" }),
    maxZoom: 22,
    attribution: "SIGTAR",
  };
}

/** A RustGIS project with the given catalog layers (a Map of the geoportal, or a legacy Workspace). */
export function buildProject(input: BuildInput): { project: Json; notices: Notice[] } {
  const notices: Notice[] = [];
  const origin = input.origin;
  const vectors = [...input.vectors].sort((a, b) => b.zIndex - a.zIndex); // index 0 draws on top
  const rasters = [...input.rasters].sort((a, b) => b.zIndex - a.zIndex);
  const layers: Json[] = [];
  let nextId = 1;
  let activeId: number | null = null;
  for (const v of vectors) {
    if (!v.fgbReady.has(v.revision)) {
      notices.push({ kind: "preparing", name: v.name, detail: "vuelve a abrir el proyecto en unos minutos o añádela desde el buscador como copia" });
      continue;
    }
    const id = nextId++;
    if (input.activeKey && input.activeKey === catalogRefKey({ kind: "vector", id: v.id })) activeId = id;
    layers.push({
      id,
      name: v.name,
      visible: v.visible,
      transparency: 0,
      dataset: { name: v.name, geometry_type: GEOMETRY_TYPES[v.geometryType] ?? "Polygon", fields: [], features: [] },
      source: { path: withOrigin(origin, { kind: "vector", id: v.id, revision: v.revision, form: "fgb" }) },
      renderer: { Single: symbolFor(v.style, v.geometryType) },
      labels: labelsFor(v.style),
    });
  }
  const tiles: Json[] = rasters.map((r) => rasterTile(r, origin, notices));
  const base = basemapTile(input.basemap);
  if (base) tiles.push(base);
  const [lat, lng] = input.center;
  const map: Json = {
    name: input.title,
    basemap: "Paper",
    layers,
    tiles,
    camera: cameraFor(lat, lng, input.zoom),
  };
  const firstId = layers.length > 0 ? (layers[0]!.id as number) : null;
  if (activeId ?? firstId) map[ACTIVE_FIELD] = { layer: activeId ?? firstId };
  return { project: { format: RUSTGIS_PROJECT_FORMAT, name: input.title, active_map: 0, maps: [map] }, notices };
}

// ── Inspecting and re-pointing saved projects ──────────────────────────────

export type FoundRef = CatalogRef & { name: string; copy: boolean };

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapsOf(project: unknown): Json[] {
  return isObject(project) && Array.isArray(project.maps) ? (project.maps.filter(isObject) as Json[]) : [];
}

function layerSourcePath(layer: Json): string | null {
  const source = layer.source;
  return isObject(source) && typeof source.path === "string" ? source.path : null;
}

function datasetSource(layer: Json): string | null {
  const dataset = layer.dataset;
  return isObject(dataset) && typeof dataset.source === "string" ? dataset.source : null;
}

function rasterPath(layer: Json): string | null {
  const raster = layer.raster;
  return isObject(raster) && typeof raster.path === "string" ? raster.path : null;
}

/** Catalog data a project refers to: by address (streamed, tiles) or as a copy. */
export function refOfLayer(layer: Json): FoundRef | null {
  const name = typeof layer.name === "string" ? layer.name : "Capa";
  const path = layerSourcePath(layer);
  const byPath = path ? parseCatalogUrl(path) : null;
  if (byPath) return { ...byPath, name, copy: false };
  const copy = datasetSource(layer);
  const copied = copy ? parseGeojsonCopyName(copy) : null;
  if (copied) return { kind: "vector", id: copied.id, revision: copied.revision, form: "geojson", name, copy: true };
  const raster = rasterPath(layer);
  const rasterRef = raster ? parseCatalogUrl(raster) : null;
  if (rasterRef) return { ...rasterRef, name, copy: true };
  return null;
}

export function refOfTile(tile: Json): FoundRef | null {
  const name = typeof tile.name === "string" ? tile.name : "Capa";
  const ref = typeof tile.url === "string" ? parseCatalogUrl(tile.url) : null;
  return ref ? { ...ref, name, copy: false } : null;
}

/** Every catalog layer a project uses (one entry per layer of each map). */
export function extractCatalogRefs(project: unknown): FoundRef[] {
  const refs: FoundRef[] = [];
  for (const map of mapsOf(project)) {
    for (const layer of Array.isArray(map.layers) ? map.layers.filter(isObject) : []) {
      const ref = refOfLayer(layer as Json);
      if (ref) refs.push(ref);
    }
    for (const tile of Array.isArray(map.tiles) ? map.tiles.filter(isObject) : []) {
      const ref = refOfTile(tile as Json);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

export interface VectorState {
  readable: boolean;
  name: string;
  revision: number;
  fgbReady: ReadonlySet<number>;
}

export interface RasterState {
  readable: boolean;
  name: string;
  version: number;
  bandCount: number | null;
  hasAlpha: boolean;
}

export interface ResolveState {
  vectors: ReadonlyMap<string, VectorState>;
  rasters: ReadonlyMap<string, RasterState>;
}

/**
 * Checks a saved project against the catalog as the opening user sees it:
 * removes what no longer exists or what the user may no longer read (the same
 * notice for both, so existence isn't revealed), re-points streamed layers at
 * the current revision/version, and moves every catalog address to `origin`.
 * Copies (GeoJSON downloaded into the project) are kept, but dropped when the
 * user lost access. Returns a new document; the input is not modified.
 */
export function resolveProject(project: unknown, state: ResolveState, origin: string): { project: Json; notices: Notice[] } {
  if (!isObject(project)) throw new TypeError("El proyecto no es un objeto JSON");
  const out = structuredClone(project) as Json;
  const notices: Notice[] = [];
  const maps = mapsOf(out);
  for (const map of maps) {
    const removedLayerIds = new Set<number>();
    const tileUrlChanges = new Map<string, string | null>();
    if (Array.isArray(map.layers)) {
      map.layers = map.layers.filter((raw) => {
        if (!isObject(raw)) return true;
        const layer = raw as Json;
        const ref = refOfLayer(layer);
        if (!ref) return true;
        const keep = resolveLayer(layer, ref, state, origin, notices);
        if (!keep && typeof layer.id === "number") removedLayerIds.add(layer.id);
        return keep;
      });
    }
    if (Array.isArray(map.tiles)) {
      const tiles = map.tiles.filter((raw) => {
        if (!isObject(raw)) return true;
        const tile = raw as Json;
        const ref = refOfTile(tile);
        if (!ref) return true;
        const before = tile.url as string;
        const keep = resolveTile(tile, ref, state, origin, notices);
        tileUrlChanges.set(before, keep ? (tile.url as string) : null);
        if (keep && typeof tile.over === "number" && removedLayerIds.has(tile.over)) delete tile.over;
        return keep;
      });
      for (const tile of tiles.filter(isObject) as Json[]) {
        if (typeof tile.over === "number" && removedLayerIds.has(tile.over)) delete tile.over;
      }
      map.tiles = tiles;
    }
    const active = map[ACTIVE_FIELD];
    if (isObject(active)) {
      if (typeof active.layer === "number" && removedLayerIds.has(active.layer)) delete map[ACTIVE_FIELD];
      else if (typeof active.tile === "string" && tileUrlChanges.has(active.tile)) {
        const next = tileUrlChanges.get(active.tile);
        if (next) map[ACTIVE_FIELD] = { tile: next };
        else delete map[ACTIVE_FIELD];
      }
    }
  }
  return { project: out, notices };
}

function resolveLayer(layer: Json, ref: FoundRef, state: ResolveState, origin: string, notices: Notice[]): boolean {
  if (ref.kind === "vector") {
    const current = state.vectors.get(ref.id);
    if (!current || !current.readable) {
      notices.push({ kind: "unavailable", name: ref.name });
      return false;
    }
    if (ref.copy) {
      if (ref.revision < current.revision) {
        notices.push({ kind: "copy", name: ref.name, detail: `de la revisión ${ref.revision}; la vigente es la ${current.revision}` });
      }
      return true;
    }
    let revision = ref.revision;
    if (ref.revision !== current.revision) {
      if (current.fgbReady.has(current.revision)) {
        revision = current.revision;
        notices.push({ kind: "updated", name: ref.name, detail: `ahora muestra la revisión ${current.revision}` });
      } else {
        notices.push({ kind: "preparing", name: ref.name, detail: `se muestra la revisión ${ref.revision} hasta que esté lista la ${current.revision}` });
      }
    }
    const source = layer.source as Json;
    const path = source.path as string;
    source.path = withOrigin(origin, { kind: "vector", id: ref.id, revision, form: "fgb" }, fragmentOf(path));
    return true;
  }
  // A raster downloaded whole into the project.
  const current = state.rasters.get(ref.id);
  if (!current || !current.readable) {
    notices.push({ kind: "unavailable", name: ref.name });
    return false;
  }
  return true;
}

function resolveTile(tile: Json, ref: FoundRef, state: ResolveState, origin: string, notices: Notice[]): boolean {
  if (ref.kind !== "raster") return true;
  const current = state.rasters.get(ref.id);
  if (!current || !current.readable) {
    notices.push({ kind: "unavailable", name: ref.name });
    return false;
  }
  if (ref.version !== current.version) {
    notices.push({ kind: "updated", name: ref.name, detail: "se volvió a procesar y se muestra la versión vigente" });
  }
  const inPlace = rasterReadableInPlace(current);
  // A COG RustGIS can't draw right (WEBP, JPEG YCbCr) is drawn from tiles instead.
  const form: "cog" | "tiles" = ref.form === "cog" && inPlace ? "cog" : "tiles";
  if (ref.form === "cog" && !inPlace) {
    tile.kind = "raster";
    tile.maxZoom = typeof tile.maxZoom === "number" ? tile.maxZoom : 22;
    const reason = rasterTilesReason(current);
    if (reason) notices.push({ kind: "tiles", name: ref.name, detail: reason });
  }
  const url = tile.url as string;
  tile.url = withOrigin(origin, { kind: "raster", id: ref.id, version: current.version, form }, form === "cog" ? fragmentOf(url) : "");
  return true;
}

// ── Validation of a project the page sends to be saved ──────────────────────

export interface ProjectCheck {
  project: Json;
  bytes: number;
  layerCount: number;
}

/** Parses and sanity-checks a project before it is stored. */
export function checkProjectText(text: string, maxBytes: number): ProjectCheck {
  if (typeof text !== "string" || text.length === 0) throw new TypeError("El proyecto está vacío");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new RangeError(`El proyecto ocupa ${Math.ceil(bytes / 1_048_576)} MB y el máximo es ${Math.floor(maxBytes / 1_048_576)} MB. Quite las copias de datos o los archivos propios y vuelva a guardar.`);
  }
  let project: unknown;
  try {
    project = JSON.parse(text);
  } catch {
    throw new TypeError("El proyecto no es JSON válido");
  }
  if (!isObject(project)) throw new TypeError("El proyecto no es un objeto JSON");
  const format = project.format === undefined ? 1 : project.format;
  if (typeof format !== "number" || format > RUSTGIS_PROJECT_FORMAT) {
    throw new TypeError(`Formato de proyecto ${String(format)} no admitido (se admite hasta el ${RUSTGIS_PROJECT_FORMAT})`);
  }
  const maps = mapsOf(project);
  if (maps.length === 0) throw new TypeError("El proyecto no tiene mapas");
  if (typeof project.active_map !== "number" || project.active_map < 0 || project.active_map >= maps.length) {
    throw new TypeError("El mapa activo del proyecto no es válido");
  }
  const layerCount = maps.reduce(
    (n, m) => n + (Array.isArray(m.layers) ? m.layers.length : 0) + (Array.isArray(m.tiles) ? m.tiles.length : 0),
    0,
  );
  return { project, bytes, layerCount };
}

/** Distinct catalog layers, as stored in geo_workspace_projects.layer_refs. */
export function layerRefsForStorage(refs: FoundRef[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const r of refs) {
    const key = `${catalogRefKey(r)}:${r.copy ? "copy" : "ref"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      r.kind === "vector"
        ? { kind: "vector", id: r.id, revision: r.revision, form: r.form, copy: r.copy, name: r.name }
        : { kind: "raster", id: r.id, version: r.version, form: r.form, copy: r.copy, name: r.name },
    );
  }
  return out;
}

// ── Legacy Workspace documents (sigtar-workspace v1/v2) ─────────────────────

export interface LegacyLayer {
  kind: "vector" | "raster";
  mapId: string;
  layerId: string;
  name: string;
  visible: boolean;
  zIndex: number;
  opacity?: number;
  style?: LayerStyleLike;
}

export interface LegacyDocument {
  center: [number, number];
  zoom: number;
  basemap: string;
  layers: LegacyLayer[];
}

/** The old Workspace's file for a saved project (layer, visibility, order and opacity). */
export function legacyFromProject(
  project: unknown,
  catalog: {
    vectors: ReadonlyMap<string, { mapId: string; geometryType: string; style: LayerStyleLike | null }>;
    rasters: ReadonlyMap<string, { mapId: string }>;
  },
): Json {
  const maps = mapsOf(project);
  const index = isObject(project) && typeof project.active_map === "number" ? project.active_map : 0;
  const map = maps[index] ?? maps[0];
  const layers: Json[] = [];
  const seen = new Set<string>();
  const vectorItems = map && Array.isArray(map.layers) ? (map.layers.filter(isObject) as Json[]) : [];
  const tileItems = map && Array.isArray(map.tiles) ? (map.tiles.filter(isObject) as Json[]) : [];
  vectorItems.forEach((layer, i) => {
    const ref = refOfLayer(layer);
    if (!ref || ref.kind !== "vector") return;
    const info = catalog.vectors.get(ref.id);
    if (!info || seen.has(catalogRefKey(ref))) return;
    seen.add(catalogRefKey(ref));
    layers.push({
      kind: "vector",
      source: { mapId: info.mapId, layerId: ref.id },
      presentation: {
        name: String(layer.name ?? ref.name).slice(0, 200) || "Capa",
        visible: layer.visible !== false,
        zIndex: vectorItems.length - i,
        style: legacyStyle(info.style, info.geometryType),
        visualizations: [],
      },
    });
  });
  tileItems.forEach((tile, i) => {
    const ref = refOfTile(tile);
    if (!ref || ref.kind !== "raster") return;
    const info = catalog.rasters.get(ref.id);
    if (!info || seen.has(catalogRefKey(ref))) return;
    seen.add(catalogRefKey(ref));
    layers.push({
      kind: "raster",
      source: { mapId: info.mapId, layerId: ref.id },
      presentation: {
        name: String(tile.name ?? ref.name).slice(0, 200) || "Ráster",
        visible: tile.visible !== false,
        zIndex: tileItems.length - i,
        opacity: num(tile.opacity, 1, 0, 1),
      },
    });
  });
  const camera = map && isObject(map.camera) ? map.camera : {};
  const center = isObject(camera.center) ? camera.center : {};
  const x = num(center.x, -10_074_000, -20_037_508.34, 20_037_508.34);
  const y = num(center.y, -55_600, -20_037_508.34, 20_037_508.34);
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  const res = num(camera.res, RES_AT_ZOOM_0 / 2 ** 9, 1e-4, 160_000);
  const zoom = Math.max(0, Math.min(22, Math.round(Math.log2(RES_AT_ZOOM_0 / res))));
  return {
    schema: "sigtar-workspace",
    version: 2,
    exportedAt: new Date().toISOString(),
    view: { center: [round(lat, 6), round(lng, 6)], zoom, basemap: "light" },
    layers,
  };
}

const LEGACY_STYLE_DEFAULTS = {
  mode: "single",
  color: "#3f7c5f",
  palette: "categorical",
  ramp: "greens",
  classification: "quantile",
  classes: 5,
  colorBy: null,
  opacity: 0.7,
  strokeWidth: 1.5,
  size: 6,
  labels: false,
  labelField: null,
} as const;

function legacyStyle(style: LayerStyleLike | null, _geometryType: string): Json {
  const out: Json = { ...LEGACY_STYLE_DEFAULTS };
  if (style && isObject(style)) {
    for (const key of Object.keys(LEGACY_STYLE_DEFAULTS)) {
      if ((style as Json)[key] !== undefined) out[key] = (style as Json)[key];
    }
  }
  return out;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Key under which a found reference is looked up in the catalog state. */
export function refKey(ref: Pick<CatalogRef, "kind" | "id">): string {
  return catalogRefKey(ref);
}

// Re-exported so callers build addresses through one module.
export { rasterCogPath, rasterTilesTemplate, vectorFgbPath };
