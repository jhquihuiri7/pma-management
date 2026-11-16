"use client";

import { Fragment, useMemo } from "react";
import { MapPin, Route, Users } from "lucide-react";
import { conMayuscula, type RutaLimpieza } from "@pma/types/protocolo-limpieza";
import { computeAccumulation } from "@/lib/protocolo-limpieza/acumulacion";
import { colorLimpieza } from "@/lib/protocolo-limpieza/barrios";
import {
  currentDate,
  displayDate,
  indicadores,
  limpiezaPorBarrio,
  listaLimpieza,
  number,
  pctText,
  recursosPorRuta,
  unitSymbol,
  type FilaLimpieza,
  type Indicadores,
  type RecursosRuta,
} from "@/lib/protocolo-limpieza/tablero";
import { useProtocoloLimpieza } from "./contexto";
import FlujoLogistico from "./FlujoLogistico";
import MapasCalor from "./MapasCalor";
import { RouteIcon, RouteTag } from "./RutaIcono";

/** Tablero: flujo logístico, mapa de calor, recursos por ruta y limpieza por barrio. */
export default function TableroVista() {
  const { records, unit, nombresBarrios, showRouteRecords } = useProtocoloLimpieza();
  const today = currentDate();
  // Recomputed on every read (every 10 s): the ships move with the clock.
  const estado = useMemo(() => computeAccumulation(records, { unit, today }), [records, unit, today]);
  const limpieza = useMemo(() => limpiezaPorBarrio(records), [records]);
  const filasLimpieza = useMemo(() => listaLimpieza(nombresBarrios, limpieza), [nombresBarrios, limpieza]);
  const recursos = useMemo(() => recursosPorRuta(records), [records]);
  const totales = useMemo(() => indicadores(records, limpieza, unit, today), [records, limpieza, unit, today]);

  return (
    <section id="dashboard" className="view">
      <FilaIndicadores datos={totales} unit={unit} />
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

/** Los seis totales de arriba del tablero, hasta hoy, con los nombres que dio el usuario. */
function FilaIndicadores({ datos, unit }: { datos: Indicadores; unit: string }) {
  const { limpieza, barriosReportados: n } = datos;
  const tarjetas: ReadonlyArray<{ route: string; nombre: string; valor: string; medida?: string; nota: string }> = [
    { route: "R1", nombre: "Residuos recolectados totales (R1)", valor: number(datos.recolectados), medida: unitSymbol(unit), nota: "Escombro y desecho" },
    { route: "R2.1", nombre: "Desechos trasladados al relleno sanitario SCX totales (R2.1)", valor: number(datos.relleno), medida: unitSymbol(unit), nota: "Solo escombro" },
    { route: "R6", nombre: "Residuos gestionados totales (R6)", valor: number(datos.gestionados), medida: unitSymbol(unit), nota: "Recepción por la gestora" },
    { route: "R1", nombre: "Cantidad de (Colchones) gestionados totales (R1)", valor: number(datos.colchones), medida: "unid.", nota: "Recolección" },
    { route: "R1", nombre: "Cantidad de (RAEE) gestionados totales (R1)", valor: number(datos.raee), medida: "unid.", nota: "Recolección" },
    {
      route: "R1",
      nombre: "Porcentaje de limpieza de barrios (R1)",
      valor: limpieza === null ? "—" : pctText(limpieza / 100),
      nota: n ? `Promedio de ${n} ${n === 1 ? "barrio reportado" : "barrios reportados"}` : "Sin reportes",
    },
  ];
  return (
    <dl className="indicadores" aria-label="Indicadores hasta hoy">
      {tarjetas.map(({ route, nombre, valor, medida, nota }) => (
        <div key={nombre} className="indicador">
          <dt>
            <RouteIcon route={route} size={30} />
            <span className="indicador-nombre">{nombre}</span>
          </dt>
          <dd>
            <span className="indicador-valor">{valor}{medida && <small> {medida}</small>}</span>
            <span className="indicador-nota">{nota}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Recursos / servicios disponibles de cada ruta, según su último reporte, con la institución de cada uno. */
function RecursosPorRuta({ filas, onRoute }: { filas: RecursosRuta[]; onRoute(route: RutaLimpieza): void }) {
  return (
    <article className="panel recursos-panel">
      <div className="panel-heading">
        <h2><Users className="ico" />Recursos / Servicios por ruta</h2>
        <span className="caption">Del último reporte de cada ruta</span>
      </div>
      <div className="table-wrap">
        <table className="recursos-tabla">
          <thead>
            <tr><th scope="col">Ruta</th><th scope="col">Institución</th><th scope="col">Disponible</th><th scope="col" className="recursos-num">Necesidad</th></tr>
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
                    <td colSpan={3} className="recursos-vacio">{fecha ? "Sin recursos en el último reporte" : "—"}</td>
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
                      {/* Reports saved before the need was asked have none. */}
                      <td className="recursos-cantidad recursos-num">{r.necesidad !== undefined ? number(r.necesidad) : "—"}</td>
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
