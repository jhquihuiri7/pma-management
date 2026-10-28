import { createHash } from "node:crypto";
import { z, type ZodError } from "zod";
import type { RiesgosCampoInvalido } from "@pma/types";
import {
  CAMPOS_DETALLE,
  DISPONIBILIDADES,
  ISLAS,
  MAX_RECURSOS,
  MESAS_GRUPOS,
  TIPOS_INSTITUCION,
  TIPOS_RECURSO,
} from "./catalogos.js";

// Validation of the two public forms. Error paths match the form's own field
// names ("principal.correo", "recursos.2.nombre"), so the web can show each
// message under the field it belongs to.

/** Case-, accent- and spacing-insensitive form of a free-text value. */
export function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ");
}

function digest(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

/** Groups fichas of the same institution while its name is free text. */
export function claveInstitucion(nombre: string): string {
  return digest("I", normalizarTexto(nombre));
}

/** Identifies one asset within an institution: same type, name, island and place. */
export function claveActivo(recurso: { tipo: string; nombre: string; isla: string; ubicacion: string }): string {
  return digest("R", [recurso.tipo, recurso.nombre, recurso.isla, recurso.ubicacion].map(normalizarTexto).join("|"));
}

/** Receipt code shown to the institution: the first block of the id. */
export function codigoRecibo(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const texto = z.string({ invalid_type_error: "Valor inválido." }).trim();
const requerido = (mensaje: string) =>
  texto.min(2, mensaje).max(200, "Use como máximo 200 caracteres.");
const opcional = texto.max(3000, "Use como máximo 3.000 caracteres.").default("");
const correo = texto.max(200, "Use como máximo 200 caracteres.").email("Ingrese un correo válido.");
const telefono = z.string().regex(/^\d{7,15}$/, "Ingrese entre 7 y 15 dígitos, solo números.");
const cantidad = z
  .number({ invalid_type_error: "Ingrese un número." })
  .int("Use un número entero.")
  .min(0, "No puede ser negativa.")
  .max(1_000_000, "La cantidad es demasiado grande.");

const enumCon = <T extends readonly [string, ...string[]]>(values: T, mensaje: string) =>
  z.enum(values as unknown as [T[number], ...T[number][]], { errorMap: () => ({ message: mensaje }) });

const contactoSchema = z
  .object({
    nombre: requerido("Ingrese el nombre completo."),
    cargo: requerido("Ingrese el cargo."),
    correo,
    telefono,
  })
  .strict();

const delegadoSchema = contactoSchema
  .extend({ documento: texto.max(30, "Use como máximo 30 caracteres.").default("") })
  .strict();

/**
 * Every resource sits on its ficha's island, so the form no longer asks for one
 * per resource. Pages opened before that change (2026-10-27) still send it; it
 * is dropped instead of failing the strict check, and the ficha's island wins.
 */
function sinIslaPropia(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("isla" in value)) return value;
  const { isla: _ignorada, ...resto } = value as Record<string, unknown>;
  return resto;
}

export const recursoSchema = z.preprocess(sinIslaPropia, z
  .object({
    tipo: enumCon(TIPOS_RECURSO, "Seleccione el tipo de recurso."),
    nombre: requerido("Ingrese el nombre del recurso."),
    ubicacion: requerido("Ingrese la ubicación."),
    unidad: requerido("Ingrese la unidad de medida."),
    cantidadExistente: cantidad,
    cantidadOperativa: cantidad,
    cantidadMovilizable: cantidad,
    esTitular: z.boolean({ invalid_type_error: "Indique si la institución es titular." }),
    disponibilidad: enumCon(DISPONIBILIDADES, "Seleccione la disponibilidad."),
    restricciones: opcional,
    detalles: z.record(z.string(), texto.max(300, "Use como máximo 300 caracteres.")).default({}),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.cantidadOperativa > r.cantidadExistente) {
      ctx.addIssue({ code: "custom", path: ["cantidadOperativa"], message: "No puede superar la cantidad existente." });
    }
    if (r.cantidadMovilizable > r.cantidadOperativa) {
      ctx.addIssue({ code: "custom", path: ["cantidadMovilizable"], message: "No puede superar la cantidad operativa." });
    }
    if (!r.esTitular && r.cantidadMovilizable > 0) {
      ctx.addIssue({ code: "custom", path: ["cantidadMovilizable"], message: "Solo la institución titular puede reportar cantidad movilizable." });
    }
    if (r.disponibilidad === "No disponible" && r.cantidadMovilizable > 0) {
      ctx.addIssue({ code: "custom", path: ["disponibilidad"], message: "Un recurso no disponible no puede tener cantidad movilizable." });
    }
  })
  // Keep only the fields this type asks for, and only when filled in.
  .transform((r) => {
    const permitidos = new Set(CAMPOS_DETALLE[r.tipo].map((campo) => campo.clave));
    const detalles = Object.fromEntries(
      Object.entries(r.detalles).filter(([clave, valor]) => permitidos.has(clave) && valor !== ""),
    );
    return { ...r, detalles };
  }));

function exigirPersonasDistintas(
  ctx: z.RefinementCtx,
  principal: { nombre: string; correo: string },
  alterno: { nombre: string; correo: string },
  prefijo: string,
) {
  if (principal.correo.toLocaleLowerCase("es") === alterno.correo.toLocaleLowerCase("es")) {
    ctx.addIssue({ code: "custom", path: [prefijo, "correo"], message: "Los delegados deben tener correos distintos." });
  }
  if (normalizarTexto(principal.nombre) === normalizarTexto(alterno.nombre)) {
    ctx.addIssue({ code: "custom", path: [prefijo, "nombre"], message: "El delegado principal y el alterno deben ser personas distintas." });
  }
}

export const fichaSchema = z
  .object({
    id: z.string().uuid("Identificador de envío inválido."),
    institucionNombre: requerido("Ingrese el nombre de la institución."),
    institucionTipo: enumCon(TIPOS_INSTITUCION, "Seleccione el tipo de institución."),
    mesaGrupo: enumCon(MESAS_GRUPOS, "Seleccione una mesa o grupo."),
    isla: enumCon(ISLAS, "Seleccione la isla."),
    principal: contactoSchema,
    alterno: contactoSchema,
    delegadosConfirmados: z.literal(true, { errorMap: () => ({ message: "Confirme la designación de ambos delegados." }) }),
    brechas: opcional,
    observaciones: opcional,
    recursos: z
      .array(recursoSchema)
      .min(1, "Registre al menos un recurso.")
      .max(MAX_RECURSOS, `Registre como máximo ${MAX_RECURSOS} recursos por ficha.`),
  })
  .strict()
  .superRefine((ficha, ctx) => {
    exigirPersonasDistintas(ctx, ficha.principal, ficha.alterno, "alterno");
    const vistos = new Set<string>();
    ficha.recursos.forEach((recurso, indice) => {
      const clave = claveActivo({ ...recurso, isla: ficha.isla });
      if (vistos.has(clave)) {
        ctx.addIssue({ code: "custom", path: ["recursos", indice, "nombre"], message: `Recurso duplicado en esta ficha: ${recurso.nombre}` });
      }
      vistos.add(clave);
    });
  });

export type FichaValidada = z.infer<typeof fichaSchema>;

export const delegacionSchema = z
  .object({
    id: z.string().uuid("Identificador de envío inválido."),
    institucionNombre: requerido("Ingrese el nombre de la institución."),
    institucionTipo: enumCon(TIPOS_INSTITUCION, "Seleccione el tipo de institución."),
    isla: enumCon(ISLAS, "Seleccione la isla."),
    mesaGrupo: enumCon(MESAS_GRUPOS, "Seleccione una mesa o grupo."),
    reporta: contactoSchema,
    principal: delegadoSchema,
    alterno: delegadoSchema,
    confirmado: z.literal(true, { errorMap: () => ({ message: "Confirme la designación de las dos personas." }) }),
  })
  .strict()
  .superRefine((d, ctx) => exigirPersonasDistintas(ctx, d.principal, d.alterno, "alterno"));

export type DelegacionValidada = z.infer<typeof delegacionSchema>;

/** One message per field, in the order the form shows them. */
export function camposInvalidos(error: ZodError): RiesgosCampoInvalido[] {
  const vistos = new Set<string>();
  const campos: RiesgosCampoInvalido[] = [];
  for (const issue of error.issues) {
    const campo = issue.path.join(".");
    if (vistos.has(campo)) continue;
    vistos.add(campo);
    campos.push({ campo, mensaje: issue.message });
  }
  return campos;
}

const vacioAIndefinido = (value: unknown) => (value === "" ? undefined : value);

export const filtrosRecursosSchema = z.object({
  isla: z.preprocess(vacioAIndefinido, z.enum(ISLAS).optional()),
  tipo: z.preprocess(vacioAIndefinido, z.enum(TIPOS_RECURSO).optional()),
  institucion: z.preprocess(vacioAIndefinido, z.string().regex(/^I-[0-9a-f]{32}$/).optional()),
  q: z.preprocess(vacioAIndefinido, z.string().trim().max(200).optional()),
});

export type FiltrosRecursos = z.infer<typeof filtrosRecursosSchema>;

export const filtrosDelegacionesSchema = z.object({
  isla: z.preprocess(vacioAIndefinido, z.enum(ISLAS).optional()),
  q: z.preprocess(vacioAIndefinido, z.string().trim().max(200).optional()),
});

export type FiltrosDelegaciones = z.infer<typeof filtrosDelegacionesSchema>;
