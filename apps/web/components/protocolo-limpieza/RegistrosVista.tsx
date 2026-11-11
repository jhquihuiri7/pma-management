"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Search } from "lucide-react";
import { forms, routes, RUTAS_LIMPIEZA } from "@pma/types/protocolo-limpieza";
import { buildCsv, CSV_FILE_NAME, displayDate, eventDate, visibleHistory } from "@/lib/protocolo-limpieza/tablero";
import { useProtocoloLimpieza } from "./contexto";
import { RouteTag } from "./RutaIcono";

/**
 * Registros: búsqueda, filtro por ruta, ver, editar y exportación CSV. The
 * route filter lives in the URL (?ruta=R3), so a click on a route of the flow
 * opens this view already filtered and the link can be shared.
 */
export default function RegistrosVista() {
  const { records, loaded, openReport, showDetail } = useProtocoloLimpieza();
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const pedida = parametros.get("ruta") ?? "";
  const ruta = (RUTAS_LIMPIEZA as readonly string[]).includes(pedida) ? pedida : "";
  const [busqueda, setBusqueda] = useState("");
  const filas = useMemo(() => visibleHistory(records, ruta, busqueda), [records, ruta, busqueda]);

  const filtrar = (siguiente: string) =>
    router.replace(siguiente ? `${pathname}?ruta=${encodeURIComponent(siguiente)}` : pathname, { scroll: false });

  const exportar = () => {
    const url = URL.createObjectURL(new Blob([buildCsv(filas)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = CSV_FILE_NAME;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section id="history" className="view">
      <div className="panel table-card">
        <div className="table-toolbar">
          <label className="search-field">
            <span className="sr-only">Buscar registros</span>
            <Search className="ico" />
            <input type="search" id="search" placeholder="Buscar por contenedor, barrio, tipo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </label>
          <label className="toolbar-select">
            <span className="sr-only">Filtrar por ruta</span>
            <select id="route-filter" value={ruta} onChange={(e) => filtrar(e.target.value)}>
              <option value="">Todas las rutas</option>
              {RUTAS_LIMPIEZA.map((r) => <option key={r} value={r}>{r} · {routes[r][1]}</option>)}
            </select>
          </label>
          <button type="button" className="button secondary" id="export" disabled={!filas.length} onClick={exportar}>
            <Download className="ico" />CSV
          </button>
        </div>
        <div className="table-wrap" id="history-table">
          {filas.length ? (
            <table>
              <thead>
                <tr>{["Ruta", "Operación", "Fecha del hito", "Lote / contenedor", "Reportado por", "Acciones"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <tr key={r.id}>
                    <td><RouteTag route={forms[r.kind].route} /></td>
                    <td>{forms[r.kind].name}</td>
                    <td>{displayDate(eventDate(r))}</td>
                    <td>{[r.data.lote, r.data.contenedor].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{String(r.data.responsable ?? r.creadoPorNombre ?? "")}</td>
                    <td>
                      <div className="actions">
                        <button type="button" className="button secondary" onClick={() => showDetail(r)}>Ver</button>
                        <button type="button" className="button secondary" onClick={() => openReport(r.kind, r)}>Editar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">{loaded ? "Sin registros para esta búsqueda." : "Cargando registros…"}</p>
          )}
        </div>
        <div className="table-footer">
          <p id="row-count" aria-live="polite">{filas.length}{filas.length === 1 ? " registro" : " registros"}</p>
        </div>
      </div>
    </section>
  );
}
