import { asc, count, eq } from "drizzle-orm";
import type { CoeDirectorio } from "@pma/types";
import { getDb } from "../../db/client.js";
import { coeDelegados, coeDestinatarios } from "../../db/schema/coeReporte.js";
import { Conflict } from "../../lib/errors.js";
import { correoConfigurado } from "./avisosModule.js";
import { MAX_DELEGADOS, MAX_DESTINATARIOS } from "./modelo.js";

// Recipients of the notices and the directory of delegates. Neither grants
// access to anything: the board is reached through users/user_apps.

export async function directorio(): Promise<CoeDirectorio> {
  const db = getDb();
  const [destinatarios, delegados] = await Promise.all([
    db.select({ email: coeDestinatarios.email }).from(coeDestinatarios).orderBy(asc(coeDestinatarios.email)),
    db
      .select({ id: coeDelegados.id, nombre: coeDelegados.nombre, email: coeDelegados.email, institucion: coeDelegados.institucion })
      .from(coeDelegados)
      .orderBy(asc(coeDelegados.nombre)),
  ]);
  return { destinatarios: destinatarios.map((d) => d.email), delegados, correoConfigurado: correoConfigurado() };
}

export async function agregarDestinatario(email: string, usuarioId: string): Promise<CoeDirectorio> {
  await getDb().transaction(async (tx) => {
    const [{ total }] = await tx.select({ total: count() }).from(coeDestinatarios);
    const [existe] = await tx.select({ email: coeDestinatarios.email }).from(coeDestinatarios).where(eq(coeDestinatarios.email, email));
    if (existe) return;
    if (total >= MAX_DESTINATARIOS) throw Conflict("Se alcanzó el límite de destinatarios.");
    await tx.insert(coeDestinatarios).values({ email, creadoPor: usuarioId }).onConflictDoNothing();
  });
  return directorio();
}

export async function quitarDestinatario(email: string): Promise<CoeDirectorio> {
  await getDb().delete(coeDestinatarios).where(eq(coeDestinatarios.email, email));
  return directorio();
}

export async function agregarDelegado(d: { nombre: string; email: string; institucion: string }): Promise<CoeDirectorio> {
  await getDb().transaction(async (tx) => {
    const [{ total }] = await tx.select({ total: count() }).from(coeDelegados);
    if (total >= MAX_DELEGADOS) throw Conflict("Se alcanzó el límite de delegados.");
    const [creado] = await tx.insert(coeDelegados).values(d).onConflictDoNothing().returning({ id: coeDelegados.id });
    if (!creado) throw Conflict("Ese correo ya está registrado.");
  });
  return directorio();
}

export async function quitarDelegado(id: string): Promise<CoeDirectorio> {
  await getDb().delete(coeDelegados).where(eq(coeDelegados.id, id));
  return directorio();
}
