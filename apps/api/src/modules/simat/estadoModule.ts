import type { SimatEstado, SimatEvaluacion } from "@pma/types";
import { ISLAS } from "./geografia.js";
import { PUERTOS, evaluar, puertoCoincideIsla } from "./riesgo.js";
import { listarEstaciones, listarNivelMar, serieLluvia } from "./lecturas.js";
import { listarCriterios } from "./criteriosModule.js";
import { estadoConectores } from "./sincronizacionModule.js";
import { FUENTES } from "./fuentes.js";

/** Full snapshot the web reads on load (GET /simat/estado). */
export async function estado(puedeEditar: boolean): Promise<SimatEstado> {
  const [estaciones, criterios, marine, conectores] = await Promise.all([
    listarEstaciones(),
    listarCriterios(),
    listarNivelMar(),
    estadoConectores(),
  ]);
  const porId = new Map(estaciones.map((e) => [e.id, e]));
  const clock = new Date();

  const riesgo: SimatEvaluacion[] = [];
  for (const criterio of criterios) {
    const estacion = porId.get(criterio.estacion);
    if (!estacion || !puertoCoincideIsla(criterio.puerto, estacion.isla)) continue;
    const rain = await serieLluvia(estacion.id);
    riesgo.push(evaluar(criterio, estacion, rain, marine, clock));
  }

  return {
    generadoEn: clock.toISOString(),
    islas: ISLAS,
    estaciones,
    puertos: PUERTOS,
    riesgo,
    conectores,
    fuentes: FUENTES,
    puedeEditar,
  };
}
