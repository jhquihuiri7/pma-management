import { asc, eq } from "drizzle-orm";
import type { RiesgosTabla } from "@pma/types";
import { getDb } from "../../db/client.js";
import { riesgosFichas, riesgosRecursos } from "../../db/schema/riesgos.js";
import { CAMPOS_DETALLE } from "./catalogos.js";
import { listarDelegaciones } from "./delegacionesModule.js";
import { condicionesRecursos } from "./fichasModule.js";
import { codigoRecibo, type FiltrosDelegaciones, type FiltrosRecursos } from "./modelo.js";

// Sheets for the results area. The web writes them as CSV or Excel; the cells
// are made formula-safe here so both formats get the same protection.

/** A spreadsheet must never run what an institution typed: "=HYPERLINK(...)". */
export function celdaSegura(value: string | number | null | undefined): string | number {
  if (typeof value === "number") return value;
  const text = value ?? "";
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const fechaLocal = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Pacific/Galapagos",
  dateStyle: "short",
  timeStyle: "short",
});

function fecha(value: Date | null): string {
  return value ? fechaLocal.format(value) : "";
}

const ENCABEZADOS_RECURSOS = [
  "Código de ficha", "Estado de ficha", "Institución", "Tipo de institución", "Mesa o grupo", "Isla de la ficha",
  "Delegado principal", "Cargo principal", "Correo principal", "Teléfono principal",
  "Delegado alterno", "Cargo alterno", "Correo alterno", "Teléfono alterno",
  "Brechas", "Observaciones", "Nota de revisión", "Revisado por", "Fecha de registro", "Fecha de revisión",
  "Estado del recurso", "Isla del recurso", "Tipo de recurso", "Recurso", "Ubicación", "Unidad de medida",
  "Existente", "Operativo", "Movilizable declarado", "Movilizable consolidado", "Titular", "Disponibilidad",
  "Restricciones", "Detalles",
];

export async function tablaRecursos(filtros: FiltrosRecursos): Promise<RiesgosTabla> {
  const rows = await getDb()
    .select({ recurso: riesgosRecursos, ficha: riesgosFichas })
    .from(riesgosRecursos)
    .innerJoin(riesgosFichas, eq(riesgosFichas.id, riesgosRecursos.fichaId))
    .where(condicionesRecursos(filtros))
    .orderBy(asc(riesgosFichas.institucionNombre), asc(riesgosFichas.createdAt), asc(riesgosRecursos.orden));

  const filas = rows.map(({ recurso: r, ficha: f }) => {
    const etiquetas = new Map(CAMPOS_DETALLE[r.tipo].map((campo) => [campo.clave, campo.etiqueta]));
    const detalles = Object.entries(r.detalles)
      .map(([clave, valor]) => `${etiquetas.get(clave) ?? clave}: ${valor}`)
      .join("; ");
    return [
      codigoRecibo(f.id), f.estado, f.institucionNombre, f.institucionTipo, f.mesaGrupo, f.isla,
      f.principalNombre, f.principalCargo, f.principalCorreo, f.principalTelefono,
      f.alternoNombre, f.alternoCargo, f.alternoCorreo, f.alternoTelefono,
      f.brechas, f.observaciones, f.notaRevision, f.revisadoPorNombre ?? "", fecha(f.createdAt), fecha(f.revisadoAt),
      r.estado, r.isla, r.tipo, r.nombre, r.ubicacion, r.unidad,
      r.cantidadExistente, r.cantidadOperativa, r.cantidadMovilizable,
      r.estado === "validado" && r.esTitular ? r.cantidadMovilizable : 0,
      r.esTitular ? "Sí" : "No", r.disponibilidad, r.restricciones, detalles,
    ].map(celdaSegura);
  });
  return { encabezados: ENCABEZADOS_RECURSOS, filas };
}

const ENCABEZADOS_DELEGACIONES = [
  "Código", "Institución", "Tipo de institución", "Isla", "Mesa o grupo",
  "Persona que reporta", "Cargo de quien reporta", "Correo de quien reporta", "Teléfono de quien reporta",
  "Delegado principal", "Cargo principal", "Identificación principal", "Correo principal", "Teléfono principal",
  "Delegado alterno", "Cargo alterno", "Identificación alterno", "Correo alterno", "Teléfono alterno",
  "Fecha de registro",
];

export async function tablaDelegaciones(filtros: FiltrosDelegaciones): Promise<RiesgosTabla> {
  const delegaciones = await listarDelegaciones(filtros);
  const filas = delegaciones.map((d) => [
    d.codigo, d.institucionNombre, d.institucionTipo, d.isla, d.mesaGrupo,
    d.reporta.nombre, d.reporta.cargo, d.reporta.correo, d.reporta.telefono,
    d.principal.nombre, d.principal.cargo, d.principal.documento, d.principal.correo, d.principal.telefono,
    d.alterno.nombre, d.alterno.cargo, d.alterno.documento, d.alterno.correo, d.alterno.telefono,
    fecha(new Date(d.createdAt)),
  ].map(celdaSegura));
  return { encabezados: ENCABEZADOS_DELEGACIONES, filas };
}
