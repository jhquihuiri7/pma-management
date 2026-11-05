import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoMaps } from "../../db/schema/geo.js";
import { readableMapsCondition, type GeoReader } from "./access.js";
import { rasterReadableInPlace } from "./rustgisProject.js";
import {
  rasterCogPath,
  rasterTilesTemplate,
  vectorFgbPath,
  vectorGeojsonPath,
} from "./workspaceUrls.js";

/**
 * Search over the whole catalog the reader may see — every vector layer and
 * processed raster of every readable map — by metadata only («disponible en la
 * búsqueda»). Nothing here reads layer data. A layer published later shows up as
 * soon as its row exists: there is no index to rebuild.
 */

export interface CatalogSearchParams {
  q?: string;
  kind?: "vector" | "raster";
  categoryId?: string;
  mapId?: string;
  bbox?: [number, number, number, number];
  limit: number;
  offset: number;
}

export interface CatalogItem {
  key: string;
  kind: "vector" | "raster";
  id: string;
  name: string;
  mapId: string;
  mapTitle: string;
  categoryId: string;
  thematic: string;
  bbox: number[] | null;
  crs: string | null;
  sizeBytes: number;
  updatedAt: string;
  vector?: { geometryType: string; featureCount: number; revision: number; fgb: "ready" | "pending" | "error" | null };
  raster?: {
    bandCount: number | null;
    hasAlpha: boolean;
    widthPx: number | null;
    heightPx: number | null;
    resolution: number | null;
    version: number;
    readableInPlace: boolean;
  };
  /**
   * How the Workspace adds it: "stream" = read by range and kept by address
   * (FlatGeobuf, COG); "tiles" = drawn from tiles (COG it can't decode);
   * "preparing" = its FlatGeobuf isn't ready yet (only a copy can be added).
   * Paths are same-origin; the page makes them absolute.
   */
  load: { mode: "stream" | "tiles" | "preparing"; path: string | null; copyPath: string | null };
}

const MAX_TERMS = 8;
/** Rasters up to this size may also be downloaded whole (analysis copy). */
const WHOLE_RASTER_MAX_BYTES = 64 * 1024 * 1024;

export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .normalize("NFC")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_TERMS)
    .map((t) => t.slice(0, 100));
}

/** Escapes LIKE wildcards in user text (the pattern uses `\` as escape). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchCatalog(reader: GeoReader, params: CatalogSearchParams): Promise<{ items: CatalogItem[]; nextOffset: number | null }> {
  const terms = searchTerms(params.q);
  const haystack = sql`unaccent(lower(i.name || ' ' || i.map_title || ' ' || coalesce(i.thematic, '') || ' ' || i.category_id))`;
  const termConditions: SQL[] = terms.map(
    (t) => sql`${haystack} like '%' || unaccent(lower(${escapeLike(t)})) || '%' escape '\\'`,
  );
  const conditions: SQL[] = [...termConditions];
  if (params.kind) conditions.push(sql`i.kind = ${params.kind}`);
  if (params.categoryId) conditions.push(sql`i.category_id = ${params.categoryId}`);
  if (params.mapId) conditions.push(sql`i.map_id = ${params.mapId}::uuid`);
  if (params.bbox) {
    const [minX, minY, maxX, maxY] = params.bbox;
    conditions.push(sql`(
      jsonb_typeof(i.bbox) = 'array' and jsonb_array_length(i.bbox) = 4
      and (i.bbox->>0)::float8 <= ${maxX} and (i.bbox->>2)::float8 >= ${minX}
      and (i.bbox->>1)::float8 <= ${maxY} and (i.bbox->>3)::float8 >= ${minY}
    )`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const phrase = terms.join(" ");
  // Exact name first, then names that start with the phrase. (Without a phrase
  // there is no rank: a bare `order by 0` would mean "column 0".)
  const orderBy = phrase
    ? sql`order by case when unaccent(lower(i.name)) = unaccent(lower(${phrase})) then 0
               when unaccent(lower(i.name)) like unaccent(lower(${escapeLike(phrase)})) || '%' escape '\\' then 1
               else 2 end, lower(i.name), i.id`
    : sql`order by lower(i.name), i.id`;

  const result = await getDb().execute(sql`
    with m as (
      select ${geoMaps.id} as id, ${geoMaps.title} as title, ${geoMaps.categoryId} as category_id, ${geoMaps.thematic} as thematic
      from ${geoMaps}
      where ${readableMapsCondition(reader)}
    ),
    i as (
      select 'vector'::text as kind, l.id, l.map_id, l.name, l.geometry_type, l.feature_count,
             l.size_bytes::bigint as size_bytes, l.bbox, l.crs, l.data_revision as revision, null::bigint as version,
             null::int as band_count, false as has_alpha, null::int as width_px, null::int as height_px,
             null::float8 as resolution_x, l.updated_at, a.status as fgb_status,
             m.title as map_title, m.category_id, m.thematic
      from geo_map_layers l
      join m on m.id = l.map_id
      left join geo_layer_artifacts a on a.layer_id = l.id and a.revision = l.data_revision and a.kind = 'fgb'
      union all
      select 'raster'::text, r.id, r.map_id, r.name, null, null,
             r.size_bytes::bigint, r.bbox, r.crs, null, floor(extract(epoch from r.processed_at) * 1000)::bigint,
             r.band_count, r.has_alpha, r.width_px, r.height_px,
             r.resolution_x, r.updated_at, null,
             m.title, m.category_id, m.thematic
      from geo_raster_layers r
      join m on m.id = r.map_id
      where r.status = 'processed' and r.processed_at is not null
    )
    select * from i
    ${where}
    ${orderBy}
    limit ${params.limit + 1} offset ${params.offset}
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  const hasMore = rows.length > params.limit;
  const items = rows.slice(0, params.limit).map(toItem);
  return { items, nextOffset: hasMore ? params.offset + params.limit : null };
}

function toItem(row: Record<string, unknown>): CatalogItem {
  const kind = row.kind === "raster" ? "raster" : "vector";
  const id = String(row.id);
  const base = {
    key: `${kind}:${id}`,
    kind,
    id,
    name: String(row.name),
    mapId: String(row.map_id),
    mapTitle: String(row.map_title),
    categoryId: String(row.category_id),
    thematic: String(row.thematic ?? ""),
    bbox: Array.isArray(row.bbox) ? (row.bbox as number[]) : null,
    crs: row.crs == null ? null : String(row.crs),
    sizeBytes: Number(row.size_bytes ?? 0),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  } as const;
  if (kind === "vector") {
    const revision = Number(row.revision);
    const status = row.fgb_status;
    const fgb = status === "ready" || status === "pending" || status === "error" ? status : null;
    const ready = fgb === "ready";
    return {
      ...base,
      vector: { geometryType: String(row.geometry_type), featureCount: Number(row.feature_count ?? 0), revision, fgb },
      load: {
        mode: ready ? "stream" : "preparing",
        path: ready ? vectorFgbPath(id, revision) : null,
        copyPath: vectorGeojsonPath(id, revision),
      },
    };
  }
  const version = Number(row.version);
  const bandCount = row.band_count == null ? null : Number(row.band_count);
  const hasAlpha = row.has_alpha === true;
  const inPlace = rasterReadableInPlace({ bandCount, hasAlpha });
  return {
    ...base,
    raster: {
      bandCount,
      hasAlpha,
      widthPx: row.width_px == null ? null : Number(row.width_px),
      heightPx: row.height_px == null ? null : Number(row.height_px),
      resolution: row.resolution_x == null ? null : Number(row.resolution_x),
      version,
      readableInPlace: inPlace,
    },
    load: {
      mode: inPlace ? "stream" : "tiles",
      path: inPlace ? rasterCogPath(id, version) : rasterTilesTemplate(id, version),
      copyPath: inPlace && base.sizeBytes <= WHOLE_RASTER_MAX_BYTES ? rasterCogPath(id, version) : null,
    },
  };
}
