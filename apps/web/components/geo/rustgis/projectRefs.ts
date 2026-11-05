/**
 * What the page needs to know about the RustGIS project it receives through the
 * bridge: which catalog layers are on the map (to mark them and avoid adding
 * them twice), and how to insert a tile layer (the only kind `ui.addUrl` can't
 * add: a COG RustGIS can't decode is drawn from the server's XYZ tiles).
 *
 * The address patterns mirror apps/api/src/modules/geo/workspaceUrls.ts.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VECTOR_RE = new RegExp(`/geo/workspace/v1/vectors/(${UUID})/r/\\d{1,9}/(?:data\\.fgb|${UUID}-r\\d{1,9}\\.geojson)$`, "i");
const RASTER_RE = new RegExp(`/geo/workspace/v1/rasters/(${UUID})/v/\\d{1,16}/(?:cog\\.tif|tiles/\\{z\\}/\\{x\\}/\\{y\\}\\.png)$`, "i");
const COPY_RE = new RegExp(`^(?:.*/)?(${UUID})-r\\d{1,9}\\.geojson$`, "i");

export const ACTIVE_FIELD = "sigtar_active";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `vector:<id>` / `raster:<id>` for one of our addresses, else null. */
export function catalogKeyOfUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  const path = url.split(/[?#]/, 1)[0] ?? "";
  const vector = VECTOR_RE.exec(path);
  if (vector) return `vector:${vector[1]!.toLowerCase()}`;
  const raster = RASTER_RE.exec(path);
  if (raster) return `raster:${raster[1]!.toLowerCase()}`;
  return null;
}

export interface ProjectInfo {
  /** Catalog layers present in any map of the project. */
  keys: Set<string>;
  layerCount: number;
  /** Characters of the project text (what goes over the bridge on every change). */
  size: number;
  /** The active map's active layer, as the patched RustGIS reports it. */
  active: { layer?: number; tile?: string } | null;
}

export function inspectProject(text: string): ProjectInfo | null {
  let project: unknown;
  try {
    project = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(project) || !Array.isArray(project.maps)) return null;
  const keys = new Set<string>();
  let layerCount = 0;
  for (const map of project.maps) {
    if (!isObject(map)) continue;
    for (const layer of Array.isArray(map.layers) ? map.layers : []) {
      if (!isObject(layer)) continue;
      layerCount += 1;
      const source = isObject(layer.source) ? layer.source.path : undefined;
      const key = catalogKeyOfUrl(source);
      if (key) {
        keys.add(key);
        continue;
      }
      const dataset = isObject(layer.dataset) ? layer.dataset.source : undefined;
      const copy = typeof dataset === "string" ? COPY_RE.exec(dataset) : null;
      if (copy) keys.add(`vector:${copy[1]!.toLowerCase()}`);
      const raster = isObject(layer.raster) ? catalogKeyOfUrl(layer.raster.path) : null;
      if (raster) keys.add(raster);
    }
    for (const tile of Array.isArray(map.tiles) ? map.tiles : []) {
      if (!isObject(tile)) continue;
      layerCount += 1;
      const key = catalogKeyOfUrl(tile.url);
      if (key) keys.add(key);
    }
  }
  const index = typeof project.active_map === "number" ? project.active_map : 0;
  const activeMap = project.maps[index];
  const activeField = isObject(activeMap) ? activeMap[ACTIVE_FIELD] : undefined;
  const active = isObject(activeField)
    ? {
        ...(typeof activeField.layer === "number" ? { layer: activeField.layer } : {}),
        ...(typeof activeField.tile === "string" ? { tile: activeField.tile } : {}),
      }
    : null;
  return { keys, layerCount, size: text.length, active };
}

export interface TileLayerInput {
  name: string;
  url: string;
  maxZoom?: number;
  attribution?: string;
}

/**
 * The project with a raster tile layer on top of the active map's tile layers
 * (RustGIS draws `tiles[0]` uppermost). The rest of the document is untouched.
 */
export function withTileLayer(text: string, tile: TileLayerInput): string {
  const project = JSON.parse(text) as unknown;
  if (!isObject(project) || !Array.isArray(project.maps) || project.maps.length === 0) {
    throw new Error("El proyecto no tiene mapas");
  }
  const index = typeof project.active_map === "number" ? project.active_map : 0;
  const map = project.maps[index];
  if (!isObject(map)) throw new Error("El mapa activo no es válido");
  const tiles = Array.isArray(map.tiles) ? map.tiles : [];
  map.tiles = [
    { name: tile.name, kind: "raster", url: tile.url, maxZoom: tile.maxZoom ?? 22, attribution: tile.attribution ?? "SIGTAR", visible: true, opacity: 1 },
    ...tiles,
  ];
  return JSON.stringify(project);
}

/** Absolute address on the page's origin (RustGIS requires absolute URLs). */
export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * A new, empty project: Galápagos in view and the geoportal's light basemap. The
 * page starts from it so it always knows the JSON RustGIS holds.
 */
export function blankProject(title = "Proyecto nuevo"): string {
  return JSON.stringify({
    format: 1,
    name: title,
    active_map: 0,
    maps: [
      {
        name: title,
        basemap: "Paper",
        layers: [],
        tiles: [
          {
            name: "OpenFreeMap Claro",
            kind: "style",
            url: "https://tiles.openfreemap.org/styles/positron",
            attribution: "© OpenStreetMap · OpenMapTiles · OpenFreeMap",
          },
        ],
        // Web Mercator metres and metres per pixel: (-0.5, -90.5) at zoom 9.
        camera: { center: { x: -10074365.29, y: -55660.65 }, res: 305.748 },
      },
    ],
  });
}
