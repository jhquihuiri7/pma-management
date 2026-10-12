import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  pg2030InstitucionTipoEnum,
  pg2030PresupuestoEstadoEnum,
  pg2030ProyectoTipoEnum,
} from "./enums.js";
import { users } from "./shared.js";

/**
 * PG2030 — seguimiento al Plan Galápagos 2030 (migrations 0031 and 0032).
 *
 * The catalog is eje → objetivo → política → estrategia → meta del plan →
 * proyecto. Every level is keyed by the plan's own code, unique across the
 * whole plan. Rows are imported once (0032) and afterwards only corrected:
 * nobody adds or deletes projects, so parents are RESTRICT, never CASCADE.
 */
export const pg2030Ejes = pgTable("pg2030_ejes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codigo: text("codigo").notNull().unique(),
  nombre: text("nombre").notNull(),
  /** The plan's own order, which the codes do not sort into. */
  orden: integer("orden").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pg2030Objetivos = pgTable(
  "pg2030_objetivos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ejeId: uuid("eje_id")
      .notNull()
      .references(() => pg2030Ejes.id, { onDelete: "restrict" }),
    codigo: text("codigo").notNull().unique(),
    texto: text("texto").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ejeIdx: index("pg2030_objetivos_eje_idx").on(t.ejeId),
  })
);

export const pg2030Politicas = pgTable(
  "pg2030_politicas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    objetivoId: uuid("objetivo_id")
      .notNull()
      .references(() => pg2030Objetivos.id, { onDelete: "restrict" }),
    codigo: text("codigo").notNull().unique(),
    texto: text("texto").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    objetivoIdx: index("pg2030_politicas_objetivo_idx").on(t.objetivoId),
  })
);

export const pg2030Estrategias = pgTable(
  "pg2030_estrategias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    politicaId: uuid("politica_id")
      .notNull()
      .references(() => pg2030Politicas.id, { onDelete: "restrict" }),
    codigo: text("codigo").notNull().unique(),
    texto: text("texto").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    politicaIdx: index("pg2030_estrategias_politica_idx").on(t.politicaId),
  })
);

export const pg2030MetasPlan = pgTable(
  "pg2030_metas_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estrategiaId: uuid("estrategia_id")
      .notNull()
      .references(() => pg2030Estrategias.id, { onDelete: "restrict" }),
    codigo: text("codigo").notNull().unique(),
    texto: text("texto").notNull(),
    cuantificable: boolean("cuantificable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    estrategiaIdx: index("pg2030_metas_plan_estrategia_idx").on(t.estrategiaId),
  })
);

/** The unit everything hangs from: institutions plan and report per project. */
export const pg2030Proyectos = pgTable(
  "pg2030_proyectos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metaPlanId: uuid("meta_plan_id")
      .notNull()
      .references(() => pg2030MetasPlan.id, { onDelete: "restrict" }),
    codigo: text("codigo").notNull().unique(),
    nombre: text("nombre").notNull(),
    tipo: pg2030ProyectoTipoEnum("tipo").notNull(),
    plazo: text("plazo"),
    presupuestoEstado: pg2030PresupuestoEstadoEnum("presupuesto_estado").notNull(),
    /** Present exactly when `presupuestoEstado` is 'Monto' (CHECK in 0031). */
    presupuestoReferencial: numeric("presupuesto_referencial", { precision: 14, scale: 2 }),
    tipoEntidadResponsable: text("tipo_entidad_responsable"),
    /** RESPONSABLE in the matrix: the plan's original, historical list. */
    responsablesPlan: text("responsables_plan"),
    /** ACTUALIZACIÓN_ENTIDAD_EJECUTORA: who executes the project today. */
    entidadesEjecutoras: text("entidades_ejecutoras"),
    hito2023: text("hito_2023"),
    hito2030: text("hito_2030"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    metaPlanIdx: index("pg2030_proyectos_meta_plan_idx").on(t.metaPlanId),
  })
);

/**
 * A project field that differed between rows of the matrix. The import kept
 * the first row's value; the alternatives wait here for an administrator.
 */
export const pg2030ConflictosImportacion = pgTable(
  "pg2030_conflictos_importacion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proyectoId: uuid("proyecto_id")
      .notNull()
      .references(() => pg2030Proyectos.id, { onDelete: "cascade" }),
    campo: text("campo").notNull(),
    valorUsado: text("valor_usado"),
    valoresAlternativos: text("valores_alternativos").array().notNull(),
    revisado: boolean("revisado").notNull().default(false),
    revisadoPor: uuid("revisado_por").references(() => users.id, { onDelete: "set null" }),
    /** Copied so the review survives the reviewer's account being deleted. */
    revisadoPorNombre: text("revisado_por_nombre"),
    revisadoAt: timestamp("revisado_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    proyectoCampoIdx: uniqueIndex("pg2030_conflictos_importacion_proyecto_campo_idx").on(t.proyectoId, t.campo),
  })
);

export const pg2030Instituciones = pgTable(
  "pg2030_instituciones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nombre: text("nombre").notNull(),
    sigla: text("sigla").notNull(),
    tipo: pg2030InstitucionTipoEnum("tipo").notNull().default("Ejecutivo"),
    /** Inactive institutions keep their history but receive no new reporters. */
    activa: boolean("activa").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // "MAGP" and "magp" are the same institution.
    siglaLowerIdx: uniqueIndex("pg2030_instituciones_sigla_lower_idx").on(sql`lower(${t.sigla})`),
  })
);

/** A REPORTER's institution in PG2030: one per user. */
export const pg2030UsuarioInstitucion = pgTable(
  "pg2030_usuario_institucion",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "restrict" }),
    asignadoPor: uuid("asignado_por").references(() => users.id, { onDelete: "set null" }),
    asignadoPorNombre: text("asignado_por_nombre").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    institucionIdx: index("pg2030_usuario_institucion_institucion_idx").on(t.institucionId),
  })
);
