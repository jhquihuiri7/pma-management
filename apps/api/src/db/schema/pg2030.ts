import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  numeric,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  pg2030FuenteFinanciamientoEnum,
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

// ---------------------------------------------------------------------------
// Phases 2 and 3 (migration 0033): years, goals, monthly plan and execution.
// Locking is never stored: modules/pg2030/cortes.ts derives it on every write.
// ---------------------------------------------------------------------------

/** A fiscal year the administrator opened. Years are never closed. */
export const pg2030Anios = pgTable("pg2030_anios", {
  anio: integer("anio").primaryKey(),
  /** Cutoffs before this one are "no habilitados"; their months travel with it. */
  primerCorte: smallint("primer_corte").notNull(),
  /** Initial-load deadline (end of that day, Galápagos), or null when there is none. */
  fechaLimiteCarga: date("fecha_limite_carga"),
  abiertoPor: uuid("abierto_por").references(() => users.id, { onDelete: "set null" }),
  abiertoPorNombre: text("abierto_por_nombre").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Institutions called to plan in a year. */
export const pg2030Convocatorias = pgTable(
  "pg2030_convocatorias",
  {
    anio: integer("anio").notNull().references(() => pg2030Anios.anio, { onDelete: "cascade" }),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "pg2030_convocatorias_pk", columns: [t.anio, t.institucionId] }),
  })
);

/** "No actions linked to the Plan this year". Exclusive with having goals. */
export const pg2030SinAcciones = pgTable(
  "pg2030_sin_acciones",
  {
    anio: integer("anio").notNull().references(() => pg2030Anios.anio, { onDelete: "cascade" }),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "restrict" }),
    declaradoPor: uuid("declarado_por").references(() => users.id, { onDelete: "set null" }),
    declaradoPorNombre: text("declarado_por_nombre").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "pg2030_sin_acciones_pk", columns: [t.anio, t.institucionId] }),
  })
);

/** What an institution sets out to do on one project in one year. */
export const pg2030MetasInstitucionales = pgTable(
  "pg2030_metas_institucionales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    anio: integer("anio").notNull().references(() => pg2030Anios.anio, { onDelete: "restrict" }),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "restrict" }),
    proyectoId: uuid("proyecto_id")
      .notNull()
      .references(() => pg2030Proyectos.id, { onDelete: "restrict" }),
    nombre: text("nombre").notNull(),
    descripcion: text("descripcion"),
    unidadMedida: text("unidad_medida").notNull(),
    fuenteFinanciamiento: pg2030FuenteFinanciamientoEnum("fuente_financiamiento"),
    beneficiariosDirectos: text("beneficiarios_directos"),
    personalTecnico: text("personal_tecnico"),
    responsablesInternos: text("responsables_internos"),
    entidadesCoordinacion: text("entidades_coordinacion"),
    creadoPor: uuid("creado_por").references(() => users.id, { onDelete: "set null" }),
    creadoPorNombre: text("creado_por_nombre").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    anioInstitucionIdx: index("pg2030_metas_institucionales_anio_institucion_idx").on(t.anio, t.institucionId),
    proyectoIdx: index("pg2030_metas_institucionales_proyecto_idx").on(t.proyectoId),
  })
);

/**
 * One row per goal and month: the plan and, once saved, the execution. A month
 * is reported exactly when `reportadoAt` is set (CHECK in 0033).
 */
export const pg2030MetaMeses = pgTable(
  "pg2030_meta_meses",
  {
    metaId: uuid("meta_id")
      .notNull()
      .references(() => pg2030MetasInstitucionales.id, { onDelete: "cascade" }),
    mes: smallint("mes").notNull(),
    fisicoPlanificado: numeric("fisico_planificado", { precision: 18, scale: 4 }).notNull().default("0"),
    presupuestoPlanificado: numeric("presupuesto_planificado", { precision: 14, scale: 2 }).notNull().default("0"),
    fisicoEjecutado: numeric("fisico_ejecutado", { precision: 18, scale: 4 }),
    presupuestoDevengado: numeric("presupuesto_devengado", { precision: 14, scale: 2 }),
    hitosAlcanzados: text("hitos_alcanzados"),
    observaciones: text("observaciones"),
    reportadoAt: timestamp("reportado_at", { withTimezone: true }),
    reportadoPor: uuid("reportado_por").references(() => users.id, { onDelete: "set null" }),
    reportadoPorNombre: text("reportado_por_nombre"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "pg2030_meta_meses_pk", columns: [t.metaId, t.mes] }),
  })
);

/** A closed cutoff reopened for one institution until a new deadline. */
export const pg2030Reaperturas = pgTable(
  "pg2030_reaperturas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    anio: integer("anio").notNull().references(() => pg2030Anios.anio, { onDelete: "cascade" }),
    trimestre: smallint("trimestre").notNull(),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "restrict" }),
    fechaLimite: date("fecha_limite").notNull(),
    motivo: text("motivo").notNull(),
    creadoPor: uuid("creado_por").references(() => users.id, { onDelete: "set null" }),
    creadoPorNombre: text("creado_por_nombre").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    corteIdx: index("pg2030_reaperturas_corte_idx").on(t.anio, t.trimestre, t.institucionId),
  })
);

export type Pg2030BitacoraAccion = "reapertura" | "mes_modificado" | "meta_modificada" | "meta_eliminada";

/** Every reopening, and who changed what after a cutoff had closed. */
export const pg2030Bitacora = pgTable(
  "pg2030_bitacora",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    anio: integer("anio").notNull().references(() => pg2030Anios.anio, { onDelete: "cascade" }),
    trimestre: smallint("trimestre").notNull(),
    institucionId: uuid("institucion_id")
      .notNull()
      .references(() => pg2030Instituciones.id, { onDelete: "restrict" }),
    metaId: uuid("meta_id").references(() => pg2030MetasInstitucionales.id, { onDelete: "set null" }),
    accion: text("accion").$type<Pg2030BitacoraAccion>().notNull(),
    detalle: jsonb("detalle").$type<Record<string, unknown>>().notNull().default({}),
    usuarioId: uuid("usuario_id").references(() => users.id, { onDelete: "set null" }),
    usuarioNombre: text("usuario_nombre").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    corteIdx: index("pg2030_bitacora_corte_idx").on(t.anio, t.trimestre, t.institucionId),
  })
);
