import type { SimatEstado, SimatEvaluacion, SimatMonitoreoMarea } from "@pma/types";
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

  const riesgo: SimatEvaluacion[] = [];
  for (const criterio of criterios) {
    // Un sector sin estación se lista igual (sin nivel, con el motivo).
    const estacion = criterio.estacion ? porId.get(criterio.estacion) : undefined;
    if (criterio.estacion && (!estacion || !puertoCoincideIsla(criterio.puerto, estacion.isla))) continue;
    const rain = estacion ? await serieLluvia(estacion.id) : null;
    riesgo.push(evaluar(criterio, estacion, rain, marine, clock));
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
