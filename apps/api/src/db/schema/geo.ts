import { pgTable, uuid, text, timestamp, jsonb, doublePrecision, integer, bigint, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./shared.js";

export const geoMaps = pgTable(
  "geo_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    categoryId: text("category_id").notNull(),
    layers: jsonb("layers").notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLng: doublePrecision("center_lng").notNull(),
    zoom: integer("zoom").notNull().default(13),
    tags: jsonb("tags"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdByIdx: index("geo_maps_admin_idx").on(t.createdBy),
    categoryIdx: index("geo_maps_category_idx").on(t.categoryId),
  })
);

/**
 * One row per layer added in the GIS editor. The heavy geometry lives on the
 * NAS (data_path → normalized GeoJSON, source_path → original upload); this
 * table holds only the lightweight catalog + presentation state so the editor
 * can rehydrate a map without starting from scratch.
 */
export const geoMapLayers = pgTable(
  "geo_map_layers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => geoMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    geometryType: text("geometry_type").notNull(), // Point | LineString | Polygon
    crs: text("crs").notNull().default("EPSG:4326"),
    featureCount: integer("feature_count").notNull().default(0),
    bbox: jsonb("bbox"), // [minX, minY, maxX, maxY]
    sourceFormat: text("source_format").notNull().default("geojson"), // shapefile | geojson
    sourcePath: text("source_path"), // NAS path to original upload (.zip/.shp), nullable
    dataPath: text("data_path").notNull(), // NAS path to normalized GeoJSON
    sizeBytes: integer("size_bytes").notNull().default(0),
    style: jsonb("style").notNull(),
    visible: boolean("visible").notNull().default(true),
    zIndex: integer("z_index").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    mapIdx: index("geo_map_layers_map_idx").on(t.mapId),
  })
);

/**
 * One row per raster layer (orthophoto). Unlike vectors, the heavy pixels are
 * never sent to the browser: the original .tif lives on the NAS, a worker turns
 * it into a Cloud Optimized GeoTIFF (COG), and the map consumes XYZ tiles served
 * by an internal TiTiler behind the API. This table holds only the catalog,
 * processing state and presentation — no pixels.
 *
 *   GEO/maps/{mapId}/rasters/{id}/original/<name>.tif   uploaded original (+ sidecars)
 *   GEO/maps/{mapId}/rasters/{id}/cog/cog.tif           optimized COG (what TiTiler reads)
 *   GEO/maps/{mapId}/rasters/{id}/tmp/                  transient processing scratch
 *   GEO/maps/{mapId}/rasters/{id}/processing.log        GDAL stdout/stderr
 */
export const geoRasterLayers = pgTable(
  "geo_raster_layers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => geoMaps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // uploaded | processing | processed | error  (enforced in the app layer)
    status: text("status").notNull().default("uploaded"),
    errorMessage: text("error_message"),
    originalFilename: text("original_filename").notNull(),
    originalPath: text("original_path").notNull(), // NAS path to the uploaded .tif
    cogPath: text("cog_path"), // NAS path to the generated COG (set when processed)
    fileType: text("file_type").notNull().default("tif"),
    // bigint (not integer): orthophotos can exceed the 2 GB int4 ceiling.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    srid: integer("srid"), // native EPSG detected by gdalinfo
    crs: text("crs"), // e.g. "EPSG:32717"
    bbox: jsonb("bbox"), // [minX, minY, maxX, maxY] in EPSG:4326 (for fitBounds)
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    bandCount: integer("band_count"),
    hasAlpha: boolean("has_alpha").notNull().default(false),
    resolutionX: doublePrecision("resolution_x"), // pixel size in CRS units
    resolutionY: doublePrecision("resolution_y"),
    minZoom: integer("min_zoom"),
    maxZoom: integer("max_zoom"),
    auxFiles: jsonb("aux_files"), // stored sidecars: [".tfw", ".prj", ...]
    opacity: doublePrecision("opacity").notNull().default(1),
    visible: boolean("visible").notNull().default(true),
    zIndex: integer("z_index").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    mapIdx: index("geo_raster_layers_map_idx").on(t.mapId),
  })
);
