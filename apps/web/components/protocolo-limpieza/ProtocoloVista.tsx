"use client";

import { datosTrazabilidad, routes, RUTAS_LIMPIEZA } from "@pma/types/protocolo-limpieza";
import { RouteTag } from "./RutaIcono";

/** Protocolo: trayecto, ejecución y datos de trazabilidad de cada ruta, como en el documento del protocolo logístico. */
export default function ProtocoloVista() {
  return (
    <section id="protocol" className="view">
      <div className="panel table-card">
        <div className="table-wrap" id="protocol-table">
          <table>
            <thead>
              <tr>
                {["Ruta", "Trayecto", "Ejecución", "Datos trazabilidad"].map((h) => (
                  <th key={h} scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RUTAS_LIMPIEZA.map((r) => (
                <tr key={r}>
                  <td><RouteTag route={r} size={52} /></td>
                  <td>{routes[r][0]}</td>
                  <td>{routes[r][1]}</td>
                  <td>
                    <ul className="protocol-datos">
                      {datosTrazabilidad[r].map((dato) => (
                        <li key={dato}>{dato}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
