import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex, bigint, date } from "drizzle-orm/pg-core";
import type { MetadatosNube } from "../../modules/protocoloLimpieza/reglas.js";
import { users } from "./shared.js";

// Protocolo de limpieza (migration 0038). The CHECK constraints live in the
// migration; the API validates every report with the shared rules
// (packages/types/src/protocoloLimpieza.ts) before it reaches the table.

/**
 * One operational report of a route of the protocol. `data` holds the values
 * of the operation's form exactly as the shared `clean` returns them, so the
 * dashboard reads the same shape the standalone app stored. `unique_key` is
 * the shared `recordKey`: the same movement cannot be reported twice.
 * `version` grows on every edit; an edit sent with an older version is
 * rejected instead of overwriting someone else's change.
 */
export const protocoloLimpiezaRegistros = pgTable(
  "protocolo_limpieza_registros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, string | number>>().notNull(),
    // Resources reported with the operation; validated by the shared limpiarRecursos.
    recursos: jsonb("recursos").$type<Array<{ cantidad: number; recurso: string; institucion: string }>>().notNull().default([]),
    uniqueKey: text("unique_key").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // Kept apart from the FK so the trail survives the user's deletion.
    createdByName: text("created_by_name").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedByName: text("updated_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueKeyIdx: uniqueIndex("protocolo_limpieza_registros_unique_key_idx").on(t.uniqueKey),
    updatedIdx: index("protocolo_limpieza_registros_updated_idx").on(t.updatedAt, t.id),
  })
);

/**
 * A JPG attached to a report (the container's interior in R3). The bytes live
 * in SIGTAR's storage under PROTOCOLO_LIMPIEZA/fotos/; the report keeps only
 * the id, which is also the file name.
 */
export const protocoloLimpiezaFotos = pgTable("protocolo_limpieza_fotos", {
  id: text("id").primaryKey(),
  storagePath: text("storage_path").notNull().unique(),
  sizeBytes: integer("size_bytes").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A point cloud of a site on a survey date (Visualización 3D, migration 0039).
 * The original LAS/LAZ (`archivo_ruta`) and its COPC (`copc_ruta`, set by the
 * worker) live under PROTOCOLO_LIMPIEZA/nubes/<id>/. `estado` goes from
 * 'procesando' to 'lista' or 'error'; only a 'lista' cloud has its COPC and
 * `metadatos`. Byte sizes and point counts can pass 2^31, hence bigint.
 */
export const protocoloLimpiezaNubes = pgTable(
  "protocolo_limpieza_nubes",
  {
    id: uuid("id").primaryKey(),
    sitio: text("sitio").notNull(),
    fecha: date("fecha", { mode: "string" }).notNull(),
    descripcion: text("descripcion").notNull().default(""),
    archivoNombre: text("archivo_nombre").notNull(),
    archivoRuta: text("archivo_ruta").notNull().unique(),
    archivoBytes: bigint("archivo_bytes", { mode: "number" }).notNull(),
    estado: text("estado").$type<"procesando" | "lista" | "error">().notNull().default("procesando"),
    error: text("error"),
    puntos: bigint("puntos", { mode: "number" }).notNull(),
    copcRuta: text("copc_ruta").unique(),
    copcBytes: bigint("copc_bytes", { mode: "number" }),
    metadatos: jsonb("metadatos").$type<MetadatosNube>(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedByName: text("updated_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    procesadaAt: timestamp("procesada_at", { withTimezone: true }),
  },
  (t) => ({
    sitioFechaIdx: index("protocolo_limpieza_nubes_sitio_fecha_idx").on(t.sitio, t.fecha),
  })
);
