// Rain × sea risk matrix. Ported from the Flask app's riesgo.py, keeping the
// same levels, ports and decision rules. Nothing emits a level until a sector's
// criterion is configured and both a valid rain window and a valid observed sea
// level are in force; otherwise `motivos` explains why.

import type {
  SimatCriterio,
  SimatEstacion,
  SimatEvaluacion,
  SimatIsla,
  SimatNivelMar,
  SimatNivelRiesgo,
  SimatPuertos,
  SimatSerieLluvia,
} from "@pma/types";

const LEVELS: Record<string, SimatNivelRiesgo> = {
  "false,false": "Normal",
  "false,true": "Precaución",
  "true,false": "Alerta",
  "true,true": "Emergencia",
};

export const PUERTOS: SimatPuertos = {
  "Santa Cruz": { "Isla Santa Cruz": "Puerto Ayora", "Isla Baltra": "Baltra · Puerto Seymour" },
  "San Cristóbal": { "Puerto Baquerizo Moreno": "Puerto Baquerizo Moreno" },
  Isabela: { "Puerto Villamil": "Puerto Villamil" },
  Floreana: { "Puerto Velasco Ibarra": "Puerto Velasco Ibarra" },
};

/** Risk windows the criterion may use (minutes). Mirrors riesgo.py WINDOWS. */
export const VENTANAS_RIESGO = [5, 15, 30, 60, 180, 360, 720] as const;

const CALIDAD_VALIDA = new Set(["válido", "validado", "validada"]);

export function puertoCoincideIsla(puerto: string, isla: string): boolean {
  let clave = puerto.trim().toLowerCase();
  if (clave === "baltra" || clave === "puerto seymour") clave = "isla baltra";
  const dueños = Object.entries(PUERTOS).filter(([, puertos]) =>
    Object.entries(puertos).some(([code, name]) => clave === code.toLowerCase() || clave === name.toLowerCase())
  );
  // The port must belong to exactly this island (and no other).
  return dueños.length > 0 && dueños.every(([owner]) => owner === isla);
}

function esValida(nivel: SimatNivelMar): boolean {
  return CALIDAD_VALIDA.has(String(nivel.calidad ?? "").trim().toLowerCase());
}

/** The most recent hand/instrument observed level for a port and datum. */
export function nivelObservado(
  registros: SimatNivelMar[],
  puerto: string,
  datum: string | null,
): SimatNivelMar | null {
  const candidatos = registros.filter((r) => {
    if (r.puerto !== puerto || r.tipo !== "Nivel observado" || r.horaPublicada || r.unidad !== "m") return false;
    if (datum != null && String(r.referencia ?? "").trim().toLowerCase() !== datum.toLowerCase()) return false;
    const t = Date.parse(r.instante);
    return Number.isFinite(t) && Number.isFinite(r.valor);
  });
  if (!candidatos.length) return null;
  return candidatos.reduce((mejor, r) =>
    Date.parse(r.instante) >= Date.parse(mejor.instante) ? r : mejor
  );
}

export function evaluar(
  criterio: SimatCriterio,
  estacion: SimatEstacion | undefined,
  rain: SimatSerieLluvia,
  marine: SimatNivelMar[],
  clock: Date,
): SimatEvaluacion {
  const latest = rain.latest;
  const window = rain.windows.find((w) => w.minutes === criterio.ventanaMin);
  const sea = nivelObservado(marine, criterio.puerto, criterio.datum);
  const motivos: string[] = [];
  const edadMs = criterio.vigenciaMin * 60_000;
  const desfaseMs = criterio.desfaseMin * 60_000;
  const rainTime = latest ? Date.parse(latest.time) : null;
  const seaTime = sea ? Date.parse(sea.instante) : null;

  if (!criterio.activo) motivos.push("El criterio está desactivado.");
  if (!estacion || !estacion.activa) {
    motivos.push("La estación no está activa.");
  } else if (!window || window.intensity == null) {
    motivos.push("Falta una ventana de lluvia completa y válida.");
  } else if (rainTime == null || !(clock.getTime() - rainTime >= 0 && clock.getTime() - rainTime <= edadMs)) {
    motivos.push("La ventana de lluvia está fuera de vigencia.");
  }
  if (!sea) {
    motivos.push("Falta un nivel observado en metros con el datum configurado.");
  } else if (!esValida(sea)) {
    motivos.push("La observación marina más reciente carece de calidad validada.");
  } else if (seaTime == null || !(clock.getTime() - seaTime >= 0 && clock.getTime() - seaTime <= edadMs)) {
    motivos.push("La observación marina está fuera de vigencia.");
  }
  if (rainTime != null && seaTime != null && Math.abs(rainTime - seaTime) > desfaseMs) {
    motivos.push("Las horas de lluvia y mar superan el desfase permitido.");
  }

  const sinProblemas = motivos.length === 0;
  const rainHigh = sinProblemas && window ? window.intensity! >= criterio.lluviaMmH : null;
  const seaHigh = sinProblemas && sea ? sea.valor >= criterio.marM : null;
  const nivel = rainHigh != null && seaHigh != null ? LEVELS[`${rainHigh},${seaHigh}`] ?? null : null;

  return {
    criterio,
    nivel,
    motivos,
    lluvia: {
      valor: window?.intensity ?? null,
      fecha: latest?.time ?? null,
      fuente: latest?.source ?? null,
      intervalos: window?.valid ?? null,
      esperados: window?.expected ?? null,
    },
    mar: sea,
  };
}

export interface CriterioValidado {
  estacion: string;
  isla: SimatIsla;
  puerto: string;
  datum: string;
  sector: string;
  respaldo: string;
  ventanaMin: number;
  vigenciaMin: number;
  desfaseMin: number;
  lluviaMmH: number;
  marM: number;
  activo: boolean;
}

/**
 * Validate a criterion against its station. Ported from build_criteria: the
 * window must be a risk window compatible with the station's cadence, the port
 * must belong to the station's island, and the thresholds must be finite.
 */
export function construirCriterio(
  entrada: {
    puerto: string;
    datum: string;
    sector: string;
    respaldo: string;
    ventanaMin: number;
    vigenciaMin: number;
    desfaseMin: number;
    lluviaMmH: number;
    marM: number;
    activo: boolean;
  },
  estacion: SimatEstacion,
): CriterioValidado {
  const etiqueta = (valor: string, limite: number, nombre: string): string => {
    const v = (valor ?? "").trim();
    if (!v || v.length > limite) throw new Error(`Revise el campo ${nombre}.`);
    return v;
  };
  const entero = (valor: number, bajo: number, alto: number, nombre: string): number => {
    if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < bajo || valor > alto) {
      throw new Error(`Revise el intervalo de ${nombre}.`);
    }
    return valor;
  };
  const metrica = (valor: number, minimo: number | null, nombre: string): number => {
    if (!Number.isFinite(valor) || (minimo != null && valor < minimo)) throw new Error(`Revise el valor de ${nombre}.`);
    return valor;
  };

  const ventanaMin = entero(entrada.ventanaMin, 5, 720, "ventana_min");
  if (!VENTANAS_RIESGO.includes(ventanaMin as (typeof VENTANAS_RIESGO)[number]) || ventanaMin % estacion.pasoMin !== 0) {
    throw new Error("La ventana debe ser compatible con la resolución de la estación.");
  }
  const puerto = etiqueta(entrada.puerto, 100, "puerto");
  if (!puertoCoincideIsla(puerto, estacion.isla)) {
    throw new Error("El puerto de referencia debe corresponder a la isla de la estación.");
  }
  return {
    estacion: estacion.id,
    isla: estacion.isla,
    puerto,
    datum: etiqueta(entrada.datum, 80, "datum"),
    sector: etiqueta(entrada.sector, 120, "sector"),
    respaldo: etiqueta(entrada.respaldo, 500, "respaldo"),
    ventanaMin,
    vigenciaMin: entero(entrada.vigenciaMin, 1, 1440, "vigencia_min"),
    desfaseMin: entero(entrada.desfaseMin, 0, 1440, "desfase_min"),
    lluviaMmH: metrica(entrada.lluviaMmH, 0, "lluvia_mm_h"),
    marM: metrica(entrada.marM, null, "mar_m"),
    activo: entrada.activo === true,
  };
}
