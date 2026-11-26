import { date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { CoeMetrica } from "@pma/types";
import { users } from "./shared.js";

// Reporte territorial COE (migration 0049). The CHECK constraints on codes,
// states and the required reason live in the migration; the API validates the
// same rules first so the form can say what is wrong.

export const coeEventos = pgTable("coe_eventos", {
  id: text("id").primaryKey(),
  titulo: text("titulo").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * One activity. The id comes from the browser, so a retried save lands on the
 * same row. `propietario` is the SHA-256 of the reporter's history code.
 */
export const coeActividades = pgTable(
  "coe_actividades",
  {
    id: uuid("id").primaryKey(),
    propietario: text("propietario").notNull(),
    eventoId: text("evento_id").notNull().references(() => coeEventos.id),
    dia: date("dia", { mode: "string" }).notNull(),
    isla: text("isla").notNull(),
    sector: text("sector").notNull(),
    institucion: text("institucion").notNull(),
    instancia: text("instancia").$type<"MTT" | "GT" | "Directa">().notNull(),
    equipo: text("equipo").notNull().default(""),
    descripcion: text("descripcion").notNull(),
    metas: jsonb("metas").$type<CoeMetrica[]>().notNull().default([]),
    estado: text("estado").$type<"pending" | "done" | "partial" | "missed" | "extra">().notNull(),
    resultado: text("resultado").notNull().default(""),
    motivo: text("motivo").notNull().default(""),
    numeros: jsonb("numeros").$type<CoeMetrica[]>().notNull().default([]),
    envioId: uuid("envio_id"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).defaultNow().notNull(),
    completadoEn: timestamp("completado_en", { withTimezone: true }),
  },
  (t) => ({
    propietarioIdx: index("coe_actividades_propietario_idx").on(t.propietario, t.dia),
    diaIdx: index("coe_actividades_dia_idx").on(t.dia, t.eventoId),
  }),
);

export const coeDestinatarios = pgTable("coe_destinatarios", {
  email: text("email").primaryKey(),
  creadoPor: uuid("creado_por").references(() => users.id, { onDelete: "set null" }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).defaultNow().notNull(),
});

/** Directory of delegates. It grants no access to the board. */
export const coeDelegados = pgTable("coe_delegados", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique("coe_delegados_email_key"),
  institucion: text("institucion").notNull(),
  creadoEn: timestamp("creado_en", { withTimezone: true }).defaultNow().notNull(),
});
