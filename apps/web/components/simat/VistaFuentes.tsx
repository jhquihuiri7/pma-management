"use client";

// Estaciones y fuentes, con los componentes de la vista previa: cabecera,
// filtros, visor del IGM, tablas y tarjetas del inventario de fuentes.

import { useState } from "react";
import type { SimatConector } from "@pma/types";
import { apiErrorMessage } from "@/lib/api-client";
import { sincronizarConector } from "@/lib/simat/api";
import { duracion, fechaHora, hace } from "@/lib/simat/formato";
import { useSimat } from "./contexto";
import { Icono } from "./iconos";
import MapaGeo from "./MapaGeo";
import { Cargando, frescura, PillConector } from "./VistaGeneral";
import { Cabecera, CardHead, FiltroEstacion, FiltroIsla, Pill, Tabla, Vacio } from "./piezas";

export default function VistaFuentes() {
  const { estado, isla, estacionesAmbito, estacionId, setEstacionId, estacion, lluvia, refrescar, notificar } = useSimat();
  const [sincronizando, setSincronizando] = useState<SimatConector | null>(null);

  if (!estado) return <Cargando />;

  const sincronizar = async (c: SimatConector) => {
    setSincronizando(c);
    try {
      const r = await sincronizarConector(c);
      notificar(r.mensaje || (r.ok ? "Sincronización completada." : "La fuente no respondió."), r.ok ? "" : "error");
      await refrescar();
    } catch (err) {
      notificar(apiErrorMessage(err, "No se pudo sincronizar la fuente."), "error");
    } finally {
      setSincronizando(null);
    }
  };

  const latest = lluvia?.latest ?? null;
  const f = frescura(lluvia, estacion);

  return (
    <>
      <Cabecera
        titulo="Estaciones y fuentes"
        descripcion="Estado de cada conexión, su último dato y su último error."
        icono="tower"
        acciones={
          <div className="toolbar">
            <button type="button" className="button outline" onClick={() => void refrescar()}>
              <Icono nombre="refresh" />
              Actualizar
            </button>
          </div>
        }
      />

      <div className="filter-bar">
        <FiltroIsla />
        <FiltroEstacion />
      </div>

      <section className="card">
        <CardHead titulo="Red de estaciones" descripcion="Inventario sobre la cartografía del IGM · selecciona una estación para ver su ficha" icono="pin" />
        <MapaGeo
          variant="visor"
          island={isla}
          stations={estacionesAmbito}
          selected={estacionId}
          live={!!f?.fresh}
          latest={latest ? `${fechaHora(latest.time)}${latest.quality === "válido" ? ` · ${latest.value} mm` : ""}` : ""}
          latestShort=""
          onStation={setEstacionId}
        />
      </section>

      <section className="card">
        <CardHead titulo="Conectores" descripcion="Sincronización programada del worker con cada fuente pública" icono="activity" />
        <Tabla
          cabeceras={["Fuente", "Estado", "Último éxito", "Resultado", ...(estado.puedeEditar ? [""] : [])]}
          filas={estado.conectores.map((c) => [
            <>
              <strong>{c.nombre}</strong>
              <div className="meta">{c.descripcion}</div>
            </>,
            <PillConector c={c} key="estado" />,
            c.ultimoExito ? hace(c.ultimoExito) : "—",
            c.error ? <span className="form-error">{c.error}</span> : (c.resultado ?? "—"),
            ...(estado.puedeEditar
              ? [
                  c.habilitado ? (
                    <button type="button" className={`button small outline${sincronizando === c.conector ? " is-loading" : ""}`} disabled={sincronizando === c.conector} onClick={() => void sincronizar(c.conector)}>
                      <Icono nombre="refresh" />
                      Sincronizar
                    </button>
                  ) : (
                    "—"
                  ),
                ]
              : []),
          ])}
        />
      </section>

      <section className="card">
        <CardHead titulo={`Estaciones · ${estacionesAmbito.length}`} descripcion="Inventario del ámbito con su última transmisión" icono="tower" />
        {estacionesAmbito.length ? (
          <Tabla
            cabeceras={["Estación", "Fuente", "Isla", "Estado", "Variables", "Última transmisión"]}
            filas={estacionesAmbito.map((e) => {
              const ultimo = e.ultimoDato.map((u) => (u.instante ? Date.parse(u.instante) : 0)).reduce((a, b) => Math.max(a, b), 0);
              return [
                <>
                  <strong>{e.nombre}</strong>
                  <div className="meta">
                    {e.id} · {e.pasoMin >= 1440 ? "diaria" : `cada ${duracion(e.pasoMin)}`}
                  </div>
                </>,
                e.propietario || e.fuente,
                e.isla,
                e.activa ? <Pill color="teal">Activa</Pill> : <Pill color="amber">{e.estado || "Inactiva"}</Pill>,
                e.variables.length ? e.variables.join(", ") : "—",
                ultimo ? fechaHora(new Date(ultimo).toISOString()) : "—",
              ];
            })}
          />
        ) : (
          <Vacio>Sin estaciones en este ámbito.</Vacio>
        )}
      </section>

      <section className="card">
        <CardHead titulo="Inventario de fuentes" descripcion="Instituciones que publican los datos y lo pendiente con cada una" icono="database" />
        <div className="fuentes-grid">
          {estado.fuentes.map((fuente) => (
            <article key={fuente.nombre} className="fuente-item">
              <div className="fuente-top">
                <strong>{fuente.nombre}</strong>
                <a className="text-link" href={fuente.url} target="_blank" rel="noopener noreferrer">
                  Sitio <Icono nombre="external" />
                </a>
              </div>
              <p className="meta">
                {fuente.cobertura} · {fuente.descripcion}
              </p>
              <div className="chips">
                <Pill color="amber">{`Pendiente: ${fuente.pendiente}`}</Pill>
                <Pill className="outline">{fuente.licencia}</Pill>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
