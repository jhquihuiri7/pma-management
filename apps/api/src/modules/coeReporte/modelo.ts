import { createHash } from "node:crypto";
import { z } from "zod";
import { INSTITUCIONES, ISLAS } from "./catalogos.js";

// Validation of the public report, with the limits of the original app
// (lib/reports.js). Messages are the ones the form shows.

export const ZONA_HORARIA = "Pacific/Galapagos";
export const MAX_METRICAS = 16;

/** The history code a browser keeps in localStorage: 32 random bytes in base64url. */
export const CODIGO_HISTORIAL = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Only the digest of the history code is stored or compared. */
export function propietarioDe(codigo: string): string {
  return sha256(codigo);
}

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

const NOMBRES_INSTITUCION = new Map(
  INSTITUCIONES.flatMap((g) => g.nombres).map((nombre) => [normalizarTexto(nombre), nombre]),
);
const NOMBRES_ISLA = new Map(ISLAS.map((isla) => [normalizarTexto(isla), isla as string]));

/** A listed institution is stored with its catalog name, even when typed by hand. */
export function nombreInstitucion(nombre: string): string {
  return NOMBRES_INSTITUCION.get(normalizarTexto(nombre)) ?? nombre;
}

export function nombreIsla(nombre: string): string {
  return NOMBRES_ISLA.get(normalizarTexto(nombre)) ?? nombre;
}

/** Year in Galápagos, used in the event code. */
export function anioGalapagos(fecha = new Date()): string {
  return new Intl.DateTimeFormat("en", { timeZone: ZONA_HORARIA, year: "numeric" }).format(fecha);
}

/**
 * EVT-<year>-<16 hex>: the same title (any case or spacing) in the same year
 * is the same event, exactly as in the original app.
 */
export function codigoEvento(titulo: string, anio = anioGalapagos()): string {
  const clave = titulo.replace(/\s+/g, " ").trim().normalize("NFKC").toLocaleLowerCase("es");
  return `EVT-${anio}-${sha256(clave).slice(0, 16).toUpperCase()}`;
}

export const CODIGO_EVENTO = /^EVT-\d{4}-[A-F0-9]{16}$/;

const texto = (max: number, mensaje: string) =>
  z.string({ required_error: mensaje, invalid_type_error: mensaje }).trim().min(1, mensaje).max(max, mensaje);
const textoOpcional = (max: number, mensaje: string) =>
  z.string({ invalid_type_error: mensaje }).trim().max(max, mensaje).default("");

const dia = z
  .string({ required_error: "Indica una fecha válida." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Indica una fecha válida.")
  .refine((value) => {
    const fecha = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(fecha.valueOf()) && fecha.toISOString().slice(0, 10) === value
      && fecha.getUTCFullYear() >= 2000 && fecha.getUTCFullYear() <= 2100;
  }, "Indica una fecha válida.");

const cantidad = z
  .union([z.string(), z.number()], { invalid_type_error: "Revisa las cantidades." })
  .transform((value) => String(value).trim())
  .refine((value) => value !== "" && value.length <= 40 && Number.isFinite(Number(value)) && Number(value) >= 0,
    "Revisa las cantidades.");

export const metricaSchema = z.object({
  indicador: texto(160, "Revisa el nombre del indicador."),
  cantidad,
  unidad: texto(80, "Revisa la unidad del indicador."),
});

const metricas = z.array(metricaSchema).max(MAX_METRICAS, "Revisa los indicadores.").default([]);

export const eventoSchema = z.object({
  titulo: texto(150, "Escribe el nombre del evento.").transform((t) => t.replace(/\s+/g, " ")),
}).strict();

export const actividadSchema = z
  .object({
    id: z.string().uuid("Identificador de actividad inválido."),
    evento: z.string().regex(CODIGO_EVENTO, "Selecciona un evento válido."),
    dia,
    isla: texto(90, "Selecciona la isla.").transform(nombreIsla),
    sector: texto(120, "Indica el sector."),
    institucion: texto(150, "Indica la institución.").transform(nombreInstitucion),
    instancia: z.enum(["MTT", "GT", "Directa"], { errorMap: () => ({ message: "Selecciona la instancia de coordinación." }) }),
    equipo: textoOpcional(10, "Selecciona la mesa o el grupo."),
    descripcion: texto(2500, "Escribe la descripción de la actividad."),
    metas: metricas,
    estado: z.enum(["pending", "extra"], { errorMap: () => ({ message: "Estado de actividad inválido." }) }),
    resultado: textoOpcional(2500, "Escribe la descripción del resultado."),
    numeros: metricas,
  })
  .strict()
  .superRefine((a, ctx) => {
    const valido = a.instancia === "Directa" ? a.equipo === ""
      : a.instancia === "MTT" ? /^MTT [1-7]$/.test(a.equipo)
        : /^GT [1-3]$/.test(a.equipo);
    if (!valido) ctx.addIssue({ code: "custom", path: ["equipo"], message: "Selecciona la mesa o el grupo." });
    if (a.estado === "extra" && !a.resultado) {
      ctx.addIssue({ code: "custom", path: ["resultado"], message: "Escribe la descripción del resultado." });
    }
  })
  .transform((a) => (a.estado === "pending" ? { ...a, resultado: "", numeros: [] } : a));

export type ActividadValidada = z.infer<typeof actividadSchema>;

export const resultadoSchema = z
  .object({
    envio: z.string().uuid("Solicitud inválida."),
    estado: z.enum(["done", "partial", "missed"], { errorMap: () => ({ message: "Indica el estado de ejecución." }) }),
    resultado: texto(2500, "Escribe la descripción del resultado."),
    motivo: textoOpcional(2500, "Revisa el motivo de la actividad."),
    numeros: metricas,
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.estado !== "done" && !r.motivo) {
      ctx.addIssue({ code: "custom", path: ["motivo"], message: "Indica el motivo cuando la actividad no se cumplió." });
    }
  })
  .transform((r) => (r.estado === "done" ? { ...r, motivo: "" } : r));

export type ResultadoValidado = z.infer<typeof resultadoSchema>;

export const filtrosSchema = z.object({
  dia: dia.optional(),
  evento: z.string().regex(CODIGO_EVENTO).optional(),
  isla: z.string().trim().max(90).optional(),
  estado: z.enum(["pending", "done", "partial", "missed", "extra"]).optional(),
  institucion: z.string().trim().max(150).optional(),
});

export type Filtros = z.infer<typeof filtrosSchema>;

const correo = z
  .string({ required_error: "Ingresa un correo válido." })
  .trim()
  .toLowerCase()
  .max(254, "Ingresa un correo válido.")
  .regex(/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/, "Ingresa un correo válido.");

export const destinatarioSchema = z.object({ email: correo }).strict();

export const delegadoSchema = z
  .object({
    nombre: texto(150, "Revisa el nombre."),
    email: correo,
    institucion: texto(150, "Revisa la institución.").transform(nombreInstitucion),
  })
  .strict();

export const MAX_DESTINATARIOS = 250;
export const MAX_DELEGADOS = 250;
