import { eq } from "drizzle-orm";
import type { Pg2030InstitucionTipo } from "@pma/types";
import type { AccessTokenClaims } from "../../../auth/jwt.js";
import { getDb } from "../../../db/client.js";
import { pg2030Instituciones, pg2030Objetivos, pg2030SinAcciones } from "../../../db/schema/pg2030.js";
import { env } from "../../../lib/env.js";
import { BadRequest, NotFound } from "../../../lib/errors.js";
import type { Trimestre } from "../cortes.js";
import { getDashboard } from "../dashboardModule.js";
import { chatIa, esOllamaLocal, proveedorPg2030, ProveedorIaError, type ProveedorIa } from "../ia/cliente.js";
import { armarInforme, type CamposInforme, type ClaveGrafico, type TextosInforme } from "./documento.js";
import { leerHechos, type Hechos } from "./hechos.js";
import {
  SISTEMA,
  conclusiones,
  pedidoAlineacion,
  pedidoAvanceFisico,
  pedidoCoherencia,
  pedidoConclusiones,
  pedidoInversion,
  pedidoObservaciones,
  pedidoPresupuesto,
  textoCoherencia,
  textoInversion,
  textosAlineacion,
  textosAvanceFisico,
  textosPresupuesto,
  type PedidoIa,
} from "./redaccion.js";
import type { Avance } from "./trabajos.js";

/** Sends one request (the system prompt is fixed) and returns the model's raw text. */
export type Redactor = (usuario: string, maxTokens: number) => Promise<string>;

/** The report's own provider when PG2030_INFORME_IA_* is set, else the classification one. */
export function proveedorInforme(): ProveedorIa {
  if (!env.PG2030_INFORME_IA_BASE_URL) return proveedorPg2030();
  return { baseUrl: env.PG2030_INFORME_IA_BASE_URL, model: env.PG2030_INFORME_IA_MODEL, apiKey: env.PG2030_INFORME_IA_API_KEY };
}

export const redactorPg2030: Redactor = (usuario, maxTokens) => {
  const proveedor = proveedorInforme();
  // A hosted model may reason before answering (Nemotron 3 Ultra does by
  // default) and that counts against max_tokens: give it room so the answer
  // itself is not cut. The local one is CPU-bound and answers directly.
  const tokens = esOllamaLocal(proveedor.baseUrl) ? maxTokens : Math.max(maxTokens * 10, 4096);
  return chatIa(
    [
      { role: "system", content: SISTEMA },
      { role: "user", content: usuario },
    ],
    { maxTokens: tokens, timeoutMs: env.PG2030_INFORME_IA_TIMEOUT_MS, temperature: 0.2, proveedor },
  );
};

export interface SolicitudInforme {
  anio: number;
  trimestre: Trimestre;
  tipoInstitucion?: Pg2030InstitucionTipo;
  campos: CamposInforme;
}

/**
 * The figures of the report: the dashboard of the cutoff (the user's choice,
 * "cifras del panel"), without the axis and institution filters — the report
 * covers every institution of the chosen type.
 */
export async function hechosDelInforme(user: AccessTokenClaims, s: SolicitudInforme): Promise<Hechos> {
  const d = await getDashboard(user, { anio: s.anio, trimestre: s.trimestre, tipoInstitucion: s.tipoInstitucion });
  if (!d.anio || d.anio.anio !== s.anio || !d.corte) throw NotFound(`El año ${s.anio} no está abierto`);
  if (!d.corte.habilitado) throw BadRequest(`El corte T${s.trimestre} no está habilitado: sus meses se reportan con el siguiente corte habilitado`);
  if (d.corte.hasta === 0) throw BadRequest(`Todavía no termina ningún mes del corte T${s.trimestre}`);

  const db = getDb();
  const [declaradas, objetivos] = await Promise.all([
    db
      .select({ sigla: pg2030Instituciones.sigla, tipo: pg2030Instituciones.tipo })
      .from(pg2030SinAcciones)
      .innerJoin(pg2030Instituciones, eq(pg2030Instituciones.id, pg2030SinAcciones.institucionId))
      .where(eq(pg2030SinAcciones.anio, s.anio)),
    db.select({ ejeId: pg2030Objetivos.ejeId, texto: pg2030Objetivos.texto }).from(pg2030Objetivos).orderBy(pg2030Objetivos.codigo),
  ]);
  const porEje = new Map<string, string>();
  for (const o of objetivos) porEje.set(o.ejeId, porEje.has(o.ejeId) ? `${porEje.get(o.ejeId)} ${o.texto}` : o.texto);
  return leerHechos(d, {
    tipo: s.tipoInstitucion,
    sinAccionesSiglas: declaradas.filter((x) => !s.tipoInstitucion || x.tipo === s.tipoInstitucion).map((x) => x.sigla),
    objetivos: porEje,
  });
}

/**
 * The model's sentences for every analysis slot, in document order. A slot
 * whose answer breaks a rule keeps its fallback; once the provider fails
 * (unreachable, error, timeout) the remaining slots skip it instead of each
 * waiting out the timeout. A busy provider (429, 502–504, common on free
 * OpenRouter models) or a network error is retried twice first.
 */
export async function redactarAnalisis(
  h: Hechos,
  campos: CamposInforme,
  redactor: Redactor,
  avance: Avance,
  aviso: (texto: string) => void,
  { esperas = [10_000, 30_000], pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<TextosInforme> {
  const base = env.PG2030_INFORME_IA_MAX_TOKENS;
  const pedidos: Array<{ pedido: PedidoIa; maxTokens: number }> = [];
  const nota = campos.observaciones.trim();
  if (nota) pedidos.push({ pedido: pedidoObservaciones(nota), maxTokens: Math.max(base, Math.ceil(nota.split(/\s+/).length * 3)) });
  if (h.totalMetasAlineacion > 0) pedidos.push({ pedido: pedidoAlineacion(h, textosAlineacion(h).hallazgo), maxTokens: base });
  const fisico = textosAvanceFisico(h);
  if (fisico) {
    pedidos.push({ pedido: pedidoAvanceFisico(h, fisico.hallazgo), maxTokens: base });
    const presupuesto = textosPresupuesto(h);
    if (presupuesto && h.d.presupuesto.total.planificado > 0) pedidos.push({ pedido: pedidoPresupuesto(h, presupuesto.hallazgo), maxTokens: base });
    const coherencia = textoCoherencia(h);
    if (coherencia) pedidos.push({ pedido: pedidoCoherencia(h, coherencia), maxTokens: base });
  }
  const inversion = textoInversion(h);
  if (inversion) pedidos.push({ pedido: pedidoInversion(h, inversion), maxTokens: base });
  const lista = conclusiones(h);
  const pedidoFinal = lista.length ? pedidoConclusiones(h, lista) : null;

  const total = pedidos.length + (pedidoFinal ? 1 : 0);
  const interpretaciones = new Map<string, string>();
  let fallidos = 0;
  let caida: string | null = null;

  const pedir = async (pedido: PedidoIa, maxTokens: number): Promise<string | null> => {
    for (let intento = 0; !caida; intento++) {
      try {
        return await redactor(pedido.usuario, maxTokens);
      } catch (error) {
        if (!(error instanceof ProveedorIaError)) throw error;
        // Busy provider, or the server's DNS failing once (EAI_AGAIN, seen 2026-11-24).
        const ocupado = /^HTTP (429|502|503|504)\b|^Red:/.test(error.message);
        if (ocupado && intento < esperas.length) {
          await pausa(esperas[intento]);
          continue;
        }
        caida = error.message;
      }
    }
    return null;
  };

  for (const [i, { pedido, maxTokens }] of pedidos.entries()) {
    avance(i, total, pedido.titulo);
    const respuesta = await pedir(pedido, maxTokens);
    const texto = respuesta === null ? null : pedido.validar(respuesta);
    if (!texto) fallidos += 1;
    interpretaciones.set(pedido.clave, texto ?? pedido.respaldo);
  }

  let implicaciones: string[] = lista.map((c) => c.respaldo);
  if (pedidoFinal) {
    avance(pedidos.length, total, pedidoFinal.titulo);
    const respuesta = await pedir(pedidoFinal, base * 2);
    const separadas = respuesta === null ? lista.map(() => null) : pedidoFinal.separar(respuesta);
    if (separadas.some((x) => x === null)) fallidos += 1;
    implicaciones = lista.map((c, i) => separadas[i] ?? c.respaldo);
  }
  avance(total, total, "Armando el documento");

  if (caida) aviso(`No se pudo usar la IA (${(caida as string).slice(0, 120)}); el análisis usa el texto base.`);
  else if (fallidos) aviso(`La IA no dio una respuesta válida en ${fallidos} de ${total} apartados; en esos se usó el texto base.`);
  return { interpretaciones, implicaciones };
}

export async function generarInforme(
  h: Hechos,
  campos: CamposInforme,
  graficos: Partial<Record<ClaveGrafico, Buffer>>,
  redactor: Redactor,
  avance: Avance,
  aviso: (texto: string) => void,
): Promise<Buffer> {
  const textos = await redactarAnalisis(h, campos, redactor, avance, aviso);
  return armarInforme(h, campos, textos, graficos);
}
