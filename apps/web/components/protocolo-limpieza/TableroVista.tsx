"use client";

import { Fragment, useMemo } from "react";
import { MapPin, Route, Users } from "lucide-react";
import { conMayuscula, type RutaLimpieza } from "@pma/types/protocolo-limpieza";
import { computeAccumulation } from "@/lib/protocolo-limpieza/acumulacion";
import { colorLimpieza } from "@/lib/protocolo-limpieza/barrios";
import {
  currentDate,
  displayDate,
  limpiezaPorBarrio,
  listaLimpieza,
  number,
  recursosPorRuta,
  type FilaLimpieza,
  type RecursosRuta,
} from "@/lib/protocolo-limpieza/tablero";
import { useProtocoloLimpieza } from "./contexto";
import FlujoLogistico from "./FlujoLogistico";
import MapasCalor from "./MapasCalor";
import { RouteTag } from "./RutaIcono";

/** Tablero: flujo logístico, mapa de calor, recursos por ruta y limpieza por barrio. */
export default function TableroVista() {
  const { records, unit, nombresBarrios, showRouteRecords } = useProtocoloLimpieza();
  const today = currentDate();
  // Recomputed on every read (every 10 s): the ships move with the clock.
  const estado = useMemo(() => computeAccumulation(records, { unit, today }), [records, unit, today]);
  const limpieza = useMemo(() => limpiezaPorBarrio(records), [records]);
  const filasLimpieza = useMemo(() => listaLimpieza(nombresBarrios, limpieza), [nombresBarrios, limpieza]);
  const recursos = useMemo(() => recursosPorRuta(records), [records]);

  return (
    <section id="dashboard" className="view">
      <section className="panel flow-panel">
        <div className="panel-heading">
          <h2><Route className="ico" />Flujo logístico de residuos</h2>
          <span className="caption">Selecciona una ruta para ver sus registros</span>
        </div>
        <FlujoLogistico estado={estado} onRoute={showRouteRecords} />
      </section>
      <MapasCalor estado={estado} limpieza={limpieza} />
      <div className="overview">
        <RecursosPorRuta filas={recursos} onRoute={showRouteRecords} />
        <article className="panel">
          <div className="panel-heading">
            <h2><MapPin className="ico" />Limpieza por barrio</h2>
            <span className="caption">Último porcentaje reportado en R1</span>
          </div>
          <LimpiezaBarrios filas={filasLimpieza} />
        </article>
      </div>
    </section>
  );
}

/** Recursos disponibles de cada ruta, según su último reporte, con la institución de cada uno. */
function RecursosPorRuta({ filas, onRoute }: { filas: RecursosRuta[]; onRoute(route: RutaLimpieza): void }) {
  return (
    <article className="panel recursos-panel">
      <div className="panel-heading">
        <h2><Users className="ico" />Recursos por ruta</h2>
        <span className="caption">Del último reporte de cada ruta</span>
      </div>
      <div className="table-wrap">
        <table className="recursos-tabla">
          <thead>
            <tr><th scope="col">Ruta</th><th scope="col">Institución</th><th scope="col">Recurso disponible</th></tr>
          </thead>
          <tbody>
            {filas.map(({ route, fecha, recursos }) => {
              const ruta = (
                <td rowSpan={Math.max(1, recursos.length)} className="recursos-ruta">
                  <button type="button" className="recursos-ir" onClick={() => onRoute(route)} title={`Ver los registros de ${route}`}>
                    <RouteTag route={route} size={34} />
                  </button>
                  <small>{fecha ? displayDate(fecha) : "Sin reportes"}</small>
                </td>
              );
              if (!recursos.length) {
                return (
                  <tr key={route}>
                    {ruta}
                    <td colSpan={2} className="recursos-vacio">{fecha ? "Sin recursos en el último reporte" : "—"}</td>
                  </tr>
                );
              }
              return (
                <Fragment key={route}>
                  {recursos.map((r, i) => (
                    <tr key={i} className={i ? "is-continuacion" : undefined}>
                      {i === 0 && ruta}
                      <td>{r.institucion}</td>
                      <td className="recursos-cantidad">{number(r.cantidad)} {conMayuscula(r.recurso)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

/** Los barrios con reporte de limpieza, con su último porcentaje y el color con que se pintan en el mapa. */
function LimpiezaBarrios({ filas }: { filas: FilaLimpieza[] }) {
  if (!filas.length) return <div id="coverage"><p className="empty">Aún no hay reportes de limpieza por barrio.</p></div>;
  return (
    <div id="coverage">
      <div className="bars">
        {filas.map((fila) => {
          const { fillColor, fillOpacity } = colorLimpieza(fila.avance);
          // The same fill the neighbourhood gets on the map.
          const muestra = fillColor.replace("rgb(", "rgba(").replace(")", `, ${fillOpacity})`);
          return (
            <div key={fila.barrio}>
              <div className="bar-head">
                <span>
                  <i className="barrio-swatch" aria-hidden="true" style={{ background: muestra }} />
                  {fila.barrio}
                </span>
                <strong>{number(fila.avance)} %</strong>
              </div>
              <div className="track" aria-hidden="true">
                <div className="fill" style={{ width: `${fila.avance}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
