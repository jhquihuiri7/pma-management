import { pgTable, text, doublePrecision, integer, boolean, jsonb, timestamp, uuid, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import type { SimatUltimoDato, SimatVariable } from "@pma/types";
import { users } from "./shared.js";

// SIMAT-GAL (migration 0040). The CHECK constraints live in the migration; the
// API validates the same rules first. See docs/plan-integracion-simat.md.

export const simatEstaciones = pgTable(
  "simat_estaciones",
  {
    id: text("id").primaryKey(),
    fuente: text("fuente").notNull(),
    codigo: text("codigo").notNull(),
    nombre: text("nombre").notNull(),
    isla: text("isla").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    altitud: doublePrecision("altitud"),
    pasoMin: integer("paso_min").notNull(),
    propietario: text("propietario").notNull().default(""),
    estado: text("estado").notNull().default(""),
    activa: boolean("activa").notNull().default(true),
    variables: jsonb("variables").$type<SimatVariable[]>().notNull().default([]),
    ultimoDato: jsonb("ultimo_dato").$type<SimatUltimoDato[]>().notNull().default([]),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    islaIdx: index("simat_estaciones_isla_idx").on(t.isla),
  })
);

export const simatObservaciones = pgTable(
  "simat_observaciones",
  {
    estacionId: text("estacion_id")
      .notNull()
      .references(() => simatEstaciones.id, { onDelete: "cascade" }),
    variable: text("variable").notNull(),
    instante: timestamp("instante", { withTimezone: true }).notNull(),
    valor: doublePrecision("valor").notNull(),
    calidad: text("calidad").notNull().default("válido"),
    fuente: text("fuente").notNull(),
    uso: text("uso").notNull().default(""),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.estacionId, t.variable, t.instante] }),
    serieIdx: index("simat_observaciones_serie_idx").on(t.estacionId, t.variable, t.instante),
  })
);

export const simatNivelMar = pgTable(
  "simat_nivel_mar",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    puerto: text("puerto").notNull(),
    tipo: text("tipo").notNull(),
    instante: text("instante").notNull(),
    horaPublicada: boolean("hora_publicada").notNull().default(false),
    valor: doublePrecision("valor").notNull(),
    unidad: text("unidad").notNull().default("m"),
    referencia: text("referencia").notNull().default(""),
    fase: text("fase"),
    calidad: text("calidad").notNull().default(""),
    fuente: text("fuente").notNull(),
    registradoPor: uuid("registrado_por").references(() => users.id, { onDelete: "set null" }),
    registradoPorNombre: text("registrado_por_nombre"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unico: uniqueIndex("simat_nivel_mar_unico_idx").on(t.puerto, t.tipo, t.fuente, t.instante),
    puertoIdx: index("simat_nivel_mar_puerto_idx").on(t.puerto, t.tipo, t.instante),
  })
);

export const simatCriterios = pgTable(
  "simat_criterios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Estación de lluvia; nula en sectores que aún no tienen una (no se evalúan). */
    estacionId: text("estacion_id").references(() => simatEstaciones.id, { onDelete: "cascade" }),
    /** Estación de respaldo: da la lluvia cuando la principal no tiene una ventana válida y vigente (0048). */
    estacionRespaldoId: text("estacion_respaldo_id").references(() => simatEstaciones.id, { onDelete: "set null" }),
    isla: text("isla").notNull(),
    puerto: text("puerto").notNull(),
    datum: text("datum").notNull(),
    sector: text("sector").notNull(),
    respaldo: text("respaldo").notNull().default(""),
    ventanaMin: integer("ventana_min").notNull(),
    vigenciaMin: integer("vigencia_min").notNull(),
    desfaseMin: integer("desfase_min").notNull(),
    /** Umbral único anterior a 0043; se conserva sin uso. */
    lluviaMmH: doublePrecision("lluvia_mm_h"),
    /** Escala de lluvia (mm/h en la ventana): vigilancia ≤ preparación ≤ respuesta. */
    lluviaVigilancia: doublePrecision("lluvia_vigilancia_mm_h").notNull(),
    lluviaPreparacion: doublePrecision("lluvia_preparacion_mm_h").notNull(),
    lluviaRespuesta: doublePrecision("lluvia_respuesta_mm_h").notNull(),
    /** Umbral de mar alto en `datum`; nulo = el mar no modifica el nivel. */
    marM: doublePrecision("mar_m"),
    estadoValidacion: text("estado_validacion").notNull().default("experimental"),
    alertasPublicas: boolean("alertas_publicas").notNull().default(false),
    activo: boolean("activo").notNull().default(false),
    version: integer("version").notNull().default(1),
    actualizadoPor: uuid("actualizado_por").references(() => users.id, { onDelete: "set null" }),
    actualizadoPorNombre: text("actualizado_por_nombre").notNull().default(""),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unico: uniqueIndex("simat_criterios_unico_idx").on(t.estacionId, t.puerto, t.sector),
  })
);

/**
 * Percentiles de marea alta por puerto (0046): monitoreo experimental, no son
 * umbrales de inundación ni cambian la escala de riesgo.
 */
export const simatUmbralesMarea = pgTable("simat_umbrales_marea", {
  puerto: text("puerto").primaryKey(),
  nombre: text("nombre").notNull(),
  p90: doublePrecision("p90").notNull(),
  p95: doublePrecision("p95").notNull(),
  p99: doublePrecision("p99").notNull(),
  datum: text("datum").notNull(),
  periodo: text("periodo").notNull(),
  metodo: text("metodo").notNull(),
  validado: boolean("validado").notNull().default(false),
  uso: text("uso").notNull().default("monitoreo_experimental"),
  alertasOficiales: boolean("alertas_oficiales").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).defaultNow().notNull(),
});

export const simatSincronizaciones = pgTable("simat_sincronizaciones", {
  conector: text("conector").primaryKey(),
  ultimoIntento: timestamp("ultimo_intento", { withTimezone: true }),
  ultimoExito: timestamp("ultimo_exito", { withTimezone: true }),
  resultado: text("resultado"),
  registros: integer("registros").notNull().default(0),
  error: text("error"),
  fallosSeguidos: integer("fallos_seguidos").notNull().default(0),
  avisoEnviado: boolean("aviso_enviado").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).defaultNow().notNull(),
});
