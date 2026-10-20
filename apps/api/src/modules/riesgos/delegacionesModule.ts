import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { RiesgosDelegacion, RiesgosRecibo } from "@pma/types";
import { getDb } from "../../db/client.js";
import { riesgosDelegaciones } from "../../db/schema/riesgos.js";
import { claveInstitucion, codigoRecibo, type DelegacionValidada, type FiltrosDelegaciones } from "./modelo.js";

function recibo(row: { id: string; createdAt: Date }): RiesgosRecibo {
  return { id: row.id, codigo: codigoRecibo(row.id), createdAt: row.createdAt.toISOString() };
}

export async function reciboDelegacion(id: string): Promise<RiesgosRecibo | null> {
  const [row] = await getDb()
    .select({ id: riesgosDelegaciones.id, createdAt: riesgosDelegaciones.createdAt })
    .from(riesgosDelegaciones)
    .where(eq(riesgosDelegaciones.id, id))
    .limit(1);
  return row ? recibo(row) : null;
}

/** Store a designation. A retry with the same id returns the first receipt. */
export async function crearDelegacion(d: DelegacionValidada): Promise<{ recibo: RiesgosRecibo; creada: boolean }> {
  const db = getDb();
  const [creada] = await db
    .insert(riesgosDelegaciones)
    .values({
      id: d.id,
      institucionClave: claveInstitucion(d.institucionNombre),
      institucionNombre: d.institucionNombre,
      institucionTipo: d.institucionTipo,
      isla: d.isla,
      mesaGrupo: d.mesaGrupo,
      reportaNombre: d.reporta.nombre,
      reportaCargo: d.reporta.cargo,
      reportaCorreo: d.reporta.correo,
      reportaTelefono: d.reporta.telefono,
      principalNombre: d.principal.nombre,
      principalCargo: d.principal.cargo,
      principalDocumento: d.principal.documento,
      principalCorreo: d.principal.correo,
      principalTelefono: d.principal.telefono,
      alternoNombre: d.alterno.nombre,
      alternoCargo: d.alterno.cargo,
      alternoDocumento: d.alterno.documento,
      alternoCorreo: d.alterno.correo,
      alternoTelefono: d.alterno.telefono,
    })
    .onConflictDoNothing({ target: riesgosDelegaciones.id })
    .returning({ id: riesgosDelegaciones.id, createdAt: riesgosDelegaciones.createdAt });
  if (creada) return { recibo: recibo(creada), creada: true };
  const existente = await reciboDelegacion(d.id);
  if (!existente) throw new Error("La designación no se guardó ni existía");
  return { recibo: existente, creada: false };
}

function condiciones(filtros: FiltrosDelegaciones): SQL | undefined {
  const lista: SQL[] = [];
  if (filtros.isla) lista.push(eq(riesgosDelegaciones.isla, filtros.isla));
  if (filtros.q) {
    const term = `%${filtros.q.replace(/[\\%_]/g, "\\$&")}%`;
    lista.push(or(
      ilike(riesgosDelegaciones.institucionNombre, term),
      ilike(riesgosDelegaciones.reportaNombre, term),
      ilike(riesgosDelegaciones.principalNombre, term),
      ilike(riesgosDelegaciones.alternoNombre, term),
      ilike(riesgosDelegaciones.mesaGrupo, term),
    )!);
  }
  return lista.length ? and(...lista) : undefined;
}

export async function listarDelegaciones(filtros: FiltrosDelegaciones): Promise<RiesgosDelegacion[]> {
  const rows = await getDb()
    .select()
    .from(riesgosDelegaciones)
    .where(condiciones(filtros))
    .orderBy(desc(riesgosDelegaciones.createdAt));
  return rows.map((row) => ({
    id: row.id,
    codigo: codigoRecibo(row.id),
    institucionNombre: row.institucionNombre,
    institucionTipo: row.institucionTipo,
    isla: row.isla,
    mesaGrupo: row.mesaGrupo,
    reporta: { nombre: row.reportaNombre, cargo: row.reportaCargo, correo: row.reportaCorreo, telefono: row.reportaTelefono },
    principal: {
      nombre: row.principalNombre,
      cargo: row.principalCargo,
      documento: row.principalDocumento,
      correo: row.principalCorreo,
      telefono: row.principalTelefono,
    },
    alterno: {
      nombre: row.alternoNombre,
      cargo: row.alternoCargo,
      documento: row.alternoDocumento,
      correo: row.alternoCorreo,
      telefono: row.alternoTelefono,
    },
    createdAt: row.createdAt.toISOString(),
  }));
}
