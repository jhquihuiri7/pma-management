import type { SimatEstado, SimatEvaluacion, SimatMonitoreoMarea, SimatSerieLluvia } from "@pma/types";
import { ISLAS } from "./geografia.js";
import { PUERTOS, evaluar, puertoCoincideIsla } from "./riesgo.js";
import { listarEstaciones, listarNivelMar, listarUmbralesMarea, nivelMarPuerto, serieLluvia } from "./lecturas.js";
import { monitoreoPuerto } from "./marea.js";
import { listarCriterios } from "./criteriosModule.js";
import { estadoConectores } from "./sincronizacionModule.js";
import { FUENTES } from "./fuentes.js";

/** Full snapshot the web reads on load (GET /simat/estado). */
export async function estado(puedeEditar: boolean): Promise<SimatEstado> {
  const [estaciones, criterios, marine, conectores, umbralesMarea] = await Promise.all([
    listarEstaciones(),
    listarCriterios(),
    listarNivelMar(),
    estadoConectores(),
    listarUmbralesMarea(),
  ]);
  const porId = new Map(estaciones.map((e) => [e.id, e]));
  const clock = new Date();
  // Varios sectores comparten estación: cada serie se lee una sola vez.
  const series = new Map<string, Promise<SimatSerieLluvia>>();
  const lluviaDe = (id: string) => {
    if (!series.has(id)) series.set(id, serieLluvia(id));
    return series.get(id)!;
  };

  const riesgo: SimatEvaluacion[] = [];
  for (const criterio of criterios) {
    // Un sector sin estación se lista igual (sin nivel, con el motivo).
    const estacion = criterio.estacion ? porId.get(criterio.estacion) : undefined;
    if (criterio.estacion && (!estacion || !puertoCoincideIsla(criterio.puerto, estacion.isla))) continue;
    const rain = estacion ? await lluviaDe(estacion.id) : null;
    // La de respaldo solo cuenta si sigue en el inventario y en la isla del puerto.
    const deRespaldo = criterio.estacionRespaldo ? porId.get(criterio.estacionRespaldo) : undefined;
    const respaldo =
      deRespaldo && puertoCoincideIsla(criterio.puerto, deRespaldo.isla) ? { estacion: deRespaldo, rain: await lluviaDe(deRespaldo.id) } : undefined;
    riesgo.push(evaluar(criterio, estacion, rain, marine, clock, respaldo));
  }

  // Monitoreo de marea (evaluar_marea) de cada puerto con predicciones u observaciones.
  const monitoreoMarea: SimatMonitoreoMarea[] = [];
  for (const puerto of Object.values(PUERTOS).flatMap((p) => Object.keys(p))) {
    const filas = await nivelMarPuerto(puerto);
    if (filas.length) monitoreoMarea.push(monitoreoPuerto(filas, puerto, clock));
  }

  return {
    generadoEn: clock.toISOString(),
    islas: ISLAS,
    estaciones,
    puertos: PUERTOS,
    riesgo,
    monitoreoMarea,
    umbralesMarea,
    conectores,
    fuentes: FUENTES,
    puedeEditar,
  };
}
