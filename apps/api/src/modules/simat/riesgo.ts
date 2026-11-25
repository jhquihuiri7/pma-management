// Riesgo por lluvia y mar. Portado de riesgo.py (puertos, ventanas, reglas de
// vigencia y desfase) y adaptado a la escala del equipo técnico (0044): la
// lluvia promedio en la ventana del criterio frente a tres umbrales da Normal,
// Vigilancia, Preparación o Respuesta; si el sector tiene umbral de mar y el
// mar observado lo alcanza, el nivel sube uno. El nivel oficial exige el
// criterio activo; desactivado (experimental) se calcula como orientativo.
// Si faltan datos de lluvia vigentes no hay nivel y `motivos` explica por qué.
// Con estación de respaldo (0048), si la principal no da una ventana válida y
// vigente, la lluvia sale del respaldo y `avisos` lo dice.

import type {
  SimatCriterio,
  SimatEstacion,
  SimatEstadoValidacion,
  SimatEvaluacion,
  SimatIsla,
  SimatNivelMar,
  SimatNivelRiesgo,
  SimatPuertos,
  SimatSerieLluvia,
  SimatUmbralesLluvia,
} from "@pma/types";

// Copias de SIMAT_NIVELES_RIESGO y SIMAT_ESTADOS_VALIDACION (@pma/types): en
// tiempo de ejecución la API no ve los valores que el barril reexporta desde
// simat.ts (el paquete se resuelve como CommonJS); los tipos sí son comunes.
export const NIVELES_RIESGO: readonly SimatNivelRiesgo[] = ["Normal", "Vigilancia", "Preparación", "Respuesta"];
export const ESTADOS_VALIDACION = ["experimental", "validado"] as const satisfies readonly SimatEstadoValidacion[];

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

/** Índice 0–3 de la escala por la intensidad de lluvia (mm/h) en la ventana. */
export function indiceLluvia(intensidad: number, umbrales: SimatUmbralesLluvia): number {
  if (intensidad >= umbrales.respuesta) return 3;
  if (intensidad >= umbrales.preparacion) return 2;
  if (intensidad >= umbrales.vigilancia) return 1;
  return 0;
}

/** Nivel de la escala: el de la lluvia, uno más si el mar está alto. */
export function nivelEscala(indice: number, marAlto: boolean | null): SimatNivelRiesgo {
  return NIVELES_RIESGO[Math.min(3, indice + (marAlto ? 1 : 0))];
}

/** Una estación con su serie de lluvia, tal como la recibe `evaluar`. */
export interface FuenteLluvia {
  estacion: SimatEstacion | undefined;
  rain: SimatSerieLluvia | null;
}

type FallaLluvia = "inactiva" | "sin_ventana" | "vencida";

const MOTIVO_FALLA: Record<FallaLluvia, string> = {
  inactiva: "La estación no está activa.",
  sin_ventana: "Falta una ventana de lluvia completa y válida.",
  vencida: "La ventana de lluvia está fuera de vigencia.",
};

/** Por qué una estación no da la lluvia del criterio; null si su ventana es válida y vigente. */
function fallaLluvia(fuente: FuenteLluvia, ventanaMin: number, vigente: (t: number | null) => boolean): FallaLluvia | null {
  if (!fuente.estacion || !fuente.estacion.activa) return "inactiva";
  const window = fuente.rain?.windows.find((w) => w.minutes === ventanaMin);
  if (!window || window.intensity == null) return "sin_ventana";
  const latest = fuente.rain?.latest;
  if (!vigente(latest ? Date.parse(latest.time) : null)) return "vencida";
  return null;
}

/** «CHARLES DARWIN 1 no está activa», para el aviso de que se usa el respaldo. */
function faltaPrincipal(falla: FallaLluvia, nombre: string): string {
  if (falla === "inactiva") return `La estación principal ${nombre} no está activa`;
  if (falla === "sin_ventana") return `La estación principal ${nombre} no tiene una ventana de lluvia completa y válida`;
  return `El dato de la estación principal ${nombre} está fuera de vigencia`;
}

export function evaluar(
  criterio: SimatCriterio,
  estacion: SimatEstacion | undefined,
  rainPrincipal: SimatSerieLluvia | null,
  marine: SimatNivelMar[],
  clock: Date,
  respaldo?: FuenteLluvia,
): SimatEvaluacion {
  const sea = nivelObservado(marine, criterio.puerto, criterio.datum);
  const motivos: string[] = [];
  const avisos: string[] = [];
  const edadMs = criterio.vigenciaMin * 60_000;
  const desfaseMs = criterio.desfaseMin * 60_000;
  const vigente = (t: number | null) => t != null && clock.getTime() - t >= 0 && clock.getTime() - t <= edadMs;

  // Lluvia: sin ella no hay nivel. Si la principal no sirve, la de respaldo.
  let rain = rainPrincipal;
  let enRespaldo = false;
  if (!criterio.estacion) {
    motivos.push("El sector no tiene estación de lluvia asignada.");
  } else {
    const falla = fallaLluvia({ estacion, rain: rainPrincipal }, criterio.ventanaMin, vigente);
    if (falla) {
      const conRespaldo = criterio.estacionRespaldo != null && respaldo != null;
      const fallaRespaldo = conRespaldo ? fallaLluvia(respaldo, criterio.ventanaMin, vigente) : null;
      const nombreRespaldo = respaldo?.estacion?.nombre ?? criterio.estacionRespaldo ?? "";
      if (conRespaldo && !fallaRespaldo) {
        rain = respaldo.rain;
        enRespaldo = true;
        avisos.push(`${faltaPrincipal(falla, estacion?.nombre ?? criterio.estacion)}: el nivel se calcula con la estación de respaldo ${nombreRespaldo}.`);
      } else {
        motivos.push(MOTIVO_FALLA[falla]);
        if (conRespaldo && fallaRespaldo) {
          const motivo = MOTIVO_FALLA[fallaRespaldo];
          motivos.push(`Estación de respaldo ${nombreRespaldo}: ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}`);
        }
      }
    }
  }
  const latest = rain?.latest ?? null;
  const window = rain?.windows.find((w) => w.minutes === criterio.ventanaMin);
  const rainTime = latest ? Date.parse(latest.time) : null;
  const seaTime = sea ? Date.parse(sea.instante) : null;
  const lluviaLista = motivos.length === 0 && window?.intensity != null;
  const indice = lluviaLista ? indiceLluvia(window!.intensity!, criterio.lluvia) : null;

  // Mar: solo si el sector tiene umbral; si falta el dato, el nivel queda por lluvia.
  let marAlto: boolean | null = null;
  if (criterio.marM != null) {
    if (!sea) {
      avisos.push("Falta un nivel del mar observado con el datum configurado: el nivel se calcula solo con la lluvia.");
    } else if (!esValida(sea)) {
      avisos.push("La observación marina más reciente carece de calidad validada: el nivel se calcula solo con la lluvia.");
    } else if (!vigente(seaTime)) {
      avisos.push("La observación marina está fuera de vigencia: el nivel se calcula solo con la lluvia.");
    } else if (rainTime != null && seaTime != null && Math.abs(rainTime - seaTime) > desfaseMs) {
      avisos.push("Las horas de lluvia y mar superan el desfase permitido: el nivel se calcula solo con la lluvia.");
    } else {
      marAlto = sea.valor >= criterio.marM;
    }
  }

  const nivelOrientativo = indice != null ? nivelEscala(indice, marAlto) : null;
  if (!criterio.activo) {
    motivos.push(
      criterio.estadoValidacion === "experimental"
        ? "Umbrales experimentales: el criterio está desactivado y el nivel es solo orientativo."
        : "El criterio está desactivado: el nivel es solo orientativo.",
    );
  }

  return {
    criterio,
    nivel: criterio.activo ? nivelOrientativo : null,
    nivelOrientativo,
    nivelLluvia: indice != null ? NIVELES_RIESGO[indice] : null,
    marAlto,
    motivos,
    avisos,
    estacionUsada: enRespaldo ? criterio.estacionRespaldo : criterio.estacion,
    enRespaldo,
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
  estacion: string | null;
  estacionRespaldo: string | null;
  isla: SimatIsla;
  puerto: string;
  datum: string;
  sector: string;
  respaldo: string;
  ventanaMin: number;
  vigenciaMin: number;
  desfaseMin: number;
  lluvia: SimatUmbralesLluvia;
  marM: number | null;
  estadoValidacion: SimatEstadoValidacion;
  alertasPublicas: boolean;
  activo: boolean;
}

/** Isla a la que pertenece un puerto (por clave o nombre), si es solo una. */
export function islaDePuerto(puerto: string): SimatIsla | null {
  const islas = (Object.keys(PUERTOS) as SimatIsla[]).filter((isla) => puertoCoincideIsla(puerto, isla));
  return islas.length === 1 ? islas[0] : null;
}

/**
 * Valida un criterio. Portado de build_criteria: la ventana debe ser una de
 * riesgo y compatible con la cadencia de la estación, y el puerto, de la isla
 * de la estación. Sin estación, la isla es la del puerto. Los umbrales de
 * lluvia deben ir de menor a mayor; el de mar es opcional. La estación de
 * respaldo (opcional) exige una principal, distinta, y cumple lo mismo que ella.
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
    lluvia: SimatUmbralesLluvia;
    marM: number | null;
    estadoValidacion: SimatEstadoValidacion;
    alertasPublicas: boolean;
    activo: boolean;
  },
  estacion: SimatEstacion | null,
  estacionRespaldo: SimatEstacion | null = null,
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
  if (!VENTANAS_RIESGO.includes(ventanaMin as (typeof VENTANAS_RIESGO)[number]) || (estacion && ventanaMin % estacion.pasoMin !== 0)) {
    throw new Error("La ventana debe ser compatible con la resolución de la estación.");
  }
  const puerto = etiqueta(entrada.puerto, 100, "puerto");
  if (estacionRespaldo) {
    if (!estacion) throw new Error("La estación de respaldo requiere una estación principal.");
    if (estacionRespaldo.id === estacion.id) throw new Error("La estación de respaldo debe ser distinta de la principal.");
    if (ventanaMin % estacionRespaldo.pasoMin !== 0) {
      throw new Error("La ventana debe ser compatible con la resolución de la estación de respaldo.");
    }
    if (!puertoCoincideIsla(puerto, estacionRespaldo.isla)) {
      throw new Error("La estación de respaldo debe estar en la isla del puerto de referencia.");
    }
  }
  let isla: SimatIsla;
  if (estacion) {
    if (!puertoCoincideIsla(puerto, estacion.isla)) {
      throw new Error("El puerto de referencia debe corresponder a la isla de la estación.");
    }
    isla = estacion.isla;
  } else {
    const delPuerto = islaDePuerto(puerto);
    if (!delPuerto) throw new Error("Seleccione un puerto de referencia del inventario.");
    isla = delPuerto;
  }
  const vigilancia = metrica(entrada.lluvia?.vigilancia, 0, "lluvia_vigilancia");
  const preparacion = metrica(entrada.lluvia?.preparacion, 0, "lluvia_preparacion");
  const respuesta = metrica(entrada.lluvia?.respuesta, 0, "lluvia_respuesta");
  if (!(vigilancia <= preparacion && preparacion <= respuesta)) {
    throw new Error("Los umbrales de lluvia deben ir de menor a mayor: vigilancia ≤ preparación ≤ respuesta.");
  }
  if (!(ESTADOS_VALIDACION as readonly string[]).includes(entrada.estadoValidacion)) throw new Error("Revise el estado de validación.");
  return {
    estacion: estacion?.id ?? null,
    estacionRespaldo: estacionRespaldo?.id ?? null,
    isla,
    puerto,
    datum: etiqueta(entrada.datum, 80, "datum"),
    sector: etiqueta(entrada.sector, 120, "sector"),
    respaldo: etiqueta(entrada.respaldo, 500, "respaldo"),
    ventanaMin,
    vigenciaMin: entero(entrada.vigenciaMin, 1, 1440, "vigencia_min"),
    desfaseMin: entero(entrada.desfaseMin, 0, 1440, "desfase_min"),
    lluvia: { vigilancia, preparacion, respuesta },
    marM: entrada.marM == null ? null : metrica(entrada.marM, null, "mar_m"),
    estadoValidacion: entrada.estadoValidacion,
    alertasPublicas: entrada.alertasPublicas === true,
    activo: entrada.activo === true,
  };
}
