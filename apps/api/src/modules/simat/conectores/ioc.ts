// IOC Sea Level Monitoring (INOCAR gauges via UNESCO/IOC–VLIZ). Ported from
// mareografos.py: parse the HTML table, read the RAS radar column in metres,
// keep the last 12 h. The reading is PRELIMINARY and on an instrument reference
// without a published datum, so it never satisfies the risk matrix by itself
// (shown as reference only); a validated observed level is registered by hand.

import { FuenteError, obtenerTexto } from "../red.js";
import { filasTabla } from "../html.js";
import { guardarNivelMar, type NivelMarRow } from "../persistencia.js";

const IOC = "https://www.ioc-sealevelmonitoring.org";
const FUENTE = "INOCAR · UNESCO/COI–VLIZ";
const REFERENCIA = "Referencia instrumental sin datum publicado";
const CALIDAD = "Dato preliminar sin control de calidad";

export const GAUGES: Record<string, { puerto: string; estacion: string }> = {
  sant: { puerto: "Isla Santa Cruz", estacion: "Puerto Ayora" },
  balt: { puerto: "Isla Baltra", estacion: "Baltra" },
};

export interface LecturaMareografo {
  instante: Date;
  valor: number;
}

/** Parse the gauge table into readings up to `clock`. Port of latest_level. */
export function parseTablaIoc(html: string, clock: Date): LecturaMareografo[] {
  const filas = filasTabla(html);
  const header = filas.find((f) => f[0] === "Time (UTC)" && f.includes("ras(m)"));
  if (!header) throw new FuenteError("La tabla no identifica el sensor RAS en metros ni la hora UTC.");
  const columna = header.indexOf("ras(m)");
  const lecturas: LecturaMareografo[] = [];
  for (const fila of filas) {
    if (fila.length !== header.length) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(fila[0]);
    const nivel = Number(fila[columna]);
    if (!m || !Number.isFinite(nivel) || nivel === -999) continue;
    const instante = new Date(`${fila[0].replace(" ", "T")}Z`);
    if (Number.isNaN(instante.getTime()) || instante > clock) continue;
    lecturas.push({ instante, valor: nivel });
  }
  return lecturas;
}

export async function sincronizarIoc(): Promise<{ registros: number; resumen: string }> {
  const clock = new Date();
  const corte = clock.getTime() - 12 * 60 * 60 * 1000;
  const rows: NivelMarRow[] = [];
  let estaciones = 0;
  for (const [code, { puerto }] of Object.entries(GAUGES)) {
    const html = await obtenerTexto(`${IOC}/bgraph.php?code=${code}&output=tab&period=0.5`, { timeoutMs: 20_000 });
    const lecturas = parseTablaIoc(html, clock).filter((l) => l.instante.getTime() >= corte);
    if (!lecturas.length) continue;
    estaciones += 1;
    for (const l of lecturas) {
      rows.push({
        puerto,
        tipo: "Nivel observado",
        instante: l.instante.toISOString(),
        horaPublicada: false,
        valor: l.valor,
        unidad: "m",
        referencia: REFERENCIA,
        fase: null,
        calidad: CALIDAD,
        fuente: FUENTE,
      });
    }
  }
  if (!estaciones) throw new FuenteError("Ningún mareógrafo devolvió lecturas.");
  const registros = await guardarNivelMar(rows);
  return { registros, resumen: `${estaciones} mareógrafos · ${registros} lecturas nuevas` };
}
