import { pgTable, uuid, text, timestamp, jsonb, doublePrecision, integer, index } from "drizzle-orm/pg-core";
import { admins, users } from "./shared.js";

export const geoMaps = pgTable(
  "geo_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
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
    adminIdx: index("geo_maps_admin_idx").on(t.adminId),
    categoryIdx: index("geo_maps_category_idx").on(t.categoryId),
  })
);
