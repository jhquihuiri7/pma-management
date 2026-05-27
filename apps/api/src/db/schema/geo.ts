import { pgTable, uuid, text, timestamp, jsonb, doublePrecision, integer, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./shared.js";

export const geoMaps = pgTable(
  "geo_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    categoryId: text("category_id").notNull(),
    arcgisUrl: text("arcgis_url"),
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
    sourceFormat: text("source_format").notNull().default("geojson"), // shapefile | geojson | sample
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
