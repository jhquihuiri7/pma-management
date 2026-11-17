import type { SimatNivelObservadoEntrada } from "@pma/types";
import { BadRequest } from "../../lib/errors.js";
import { guardarNivelMar } from "./persistencia.js";

/**
 * Register a validated observed sea level by hand (decision D4): the matrix
 * needs a level in metres with a datum and validated quality, which the
 * preliminary IOC gauge cannot provide on its own.
 */
export async function registrarNivelObservado(
  entrada: SimatNivelObservadoEntrada,
  usuario: { id: string; name: string },
): Promise<{ ok: true }> {
  const instante = new Date(entrada.instante);
  if (Number.isNaN(instante.getTime())) throw BadRequest("Hora de observación inválida.");
  if (instante.getTime() > Date.now() + 60_000) throw BadRequest("La hora de observación está en el futuro.");
  if (!Number.isFinite(entrada.valor)) throw BadRequest("Valor de nivel inválido.");
  const puerto = entrada.puerto?.trim();
  const referencia = entrada.referencia?.trim();
  if (!puerto) throw BadRequest("Indique el puerto.");
  if (!referencia) throw BadRequest("Indique la referencia vertical (datum).");

  await guardarNivelMar([
    {
      puerto,
      tipo: "Nivel observado",
      instante: instante.toISOString(),
      horaPublicada: false,
      valor: entrada.valor,
      unidad: (entrada.unidad || "m").trim(),
      referencia,
      fase: null,
      calidad: (entrada.calidad || "validado").trim(),
      fuente: entrada.fuente?.trim() ? `${entrada.fuente.trim()} · ${usuario.name}` : `MANUAL · ${usuario.name}`,
      registradoPor: usuario.id,
      registradoPorNombre: usuario.name,
    },
  ]);
  return { ok: true };
}
