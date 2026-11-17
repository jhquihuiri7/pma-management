// INOCAR public tide tables. Ported from integraciones.py (inocar_predictions /
// TideTable): the astronomical pleamar/bajamar predictions for a port, with the
// published local times kept as text (hora_publicada=true). INOCAR's TLS chain
// needs Node's own roots (see red.ts). Ports map to the matrix's PUERTOS keys.

import { FuenteError, obtenerTextoLatin } from "../red.js";
import { filasTabla } from "../html.js";
import { fechaGalapagos } from "../geografia.js";
import { guardarNivelMar, type NivelMarRow } from "../persistencia.js";

const FUENTE = "INOCAR · Tabla pública de mareas";

/** cp code of INOCAR's table → the matrix port it feeds. */
export const PUERTOS_INOCAR: Array<{ cp: number; puerto: string }> = [
  { cp: 30, puerto: "Isla Santa Cruz" },
  { cp: 385, puerto: "Isla Baltra" },
];

export interface PrediccionMarea {
  fecha: string; // ISO date (YYYY-MM-DD)
  hora: string; // HH:MM, published local time
  valor: number;
  fase: "Pleamar" | "Bajamar";
}

/** Parse the tide table. State machine over table rows, as TideTable did. */
export function parseTablaInocar(html: string): PrediccionMarea[] {
  const entradas: PrediccionMarea[] = [];
  let fecha: string | null = null;
  for (const fila of filasTabla(html)) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(fila[0] ?? "");
    if (d) fecha = `${d[3]}-${d[2]}-${d[1]}`;
    if (fecha && fila.length === 2 && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fila[0])) {
      const altura = /^(-?\d+(?:[.,]\d+)?)\s*([PB])$/.exec(fila[1]);
      if (altura) {
        entradas.push({
          fecha,
          hora: fila[0],
          valor: Number(altura[1].replace(",", ".")),
          fase: altura[2] === "P" ? "Pleamar" : "Bajamar",
        });
      }
    }
  }
  return entradas;
}

export async function sincronizarInocar(): Promise<{ registros: number; resumen: string }> {
  const fecha = fechaGalapagos(new Date());
  const rows: NivelMarRow[] = [];
  let puertos = 0;
  for (const { cp, puerto } of PUERTOS_INOCAR) {
    const url = `https://www.inocar.mil.ec/mareas/consultan.php?task=generate&cp=${cp}&fecha=${fecha}&tipocon=link`;
    const html = await obtenerTextoLatin(url, { timeoutMs: 20_000 });
    const predicciones = parseTablaInocar(html);
    if (!predicciones.length) continue;
    puertos += 1;
    for (const p of predicciones) {
      rows.push({
        puerto,
        tipo: "Predicción astronómica",
        instante: `${p.fecha} ${p.hora}`,
        horaPublicada: true,
        valor: p.valor,
        unidad: "m",
        referencia: "MLWS",
        fase: p.fase,
        calidad: "Predicción publicada · verificar huso con el proveedor",
        fuente: FUENTE,
      });
    }
  }
  if (!puertos) throw new FuenteError("INOCAR no devolvió predicciones reconocibles.");
  const registros = await guardarNivelMar(rows);
  return { registros, resumen: `${puertos} puertos · ${registros} predicciones nuevas` };
}
