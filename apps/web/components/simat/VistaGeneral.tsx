"use client";

// Vista general de SIMAT-GAL, réplica del panel de la vista previa (ui.js,
// dashboard()) sobre los datos reales: hero con el visor del IGM, indicadores,
// banda de riesgo, precipitación reciente, actividad de las fuentes, lluvia
// antecedente e inventario de estaciones.

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import type { SimatConectorEstado, SimatEstacion, SimatNivelMar, SimatSerieLluvia } from "@pma/types";
import { obtenerMareas } from "@/lib/simat/api";
import { rain, spark, COLORES, type RainSlot } from "@/lib/simat/graficos";
import { extremosMarea, horaMarina, observacionPuerto } from "@/lib/simat/marinos";
import { duracion, fechaDia, fechaHora, hace, horaCorta, medida, numero } from "@/lib/simat/formato";
import { TODAS_LAS_ISLAS, useSimat } from "./contexto";
import { Icono, type NombreIcono } from "./iconos";
import { MATRIZ } from "./matriz";
import MapaGeo from "./MapaGeo";
import { CardHead, Dial, FiltroEstacion, FiltroIsla, Grafico, Pill, StatMini, Tabla, Vacio } from "./piezas";

/* ---------- serie de la estación ---------- */

export function ranurasLluvia(lluvia: SimatSerieLluvia | null, estacion: SimatEstacion | undefined): RainSlot[] {
  const rows = lluvia?.recent ?? [];
  if (!rows.length || !estacion) return [];
  const step = estacion.pasoMin * 60000;
  const first = Date.parse(rows[0].time);
  const last = Date.parse(rows[rows.length - 1].time);
  const toSlot = (r: SimatSerieLluvia["recent"][number]): RainSlot => ({ t: Date.parse(r.time), v: r.quality === "válido" ? r.value : null, q: r.quality });
  if ((last - first) / step + 1 > rows.length * 4) return rows.map(toSlot);
  const byTime = new Map(rows.map((r) => [Date.parse(r.time), r]));
  const out: RainSlot[] = [];
  for (let t = first; t <= last; t += step) {
    const r = byTime.get(t);
    out.push(r ? toSlot(r) : { t, v: null, q: null });
  }
  return out;
}

export function frescura(lluvia: SimatSerieLluvia | null, estacion: SimatEstacion | undefined) {
  if (!estacion || !lluvia?.latest) return null;
  const age = Date.now() - Date.parse(lluvia.latest.time);
  return { age, fresh: age >= -60000 && age <= Math.max(2 * estacion.pasoMin, 30) * 60000 };
}

/* ---------- conectores ---------- */

type EstadoConector = "ok" | "fallos" | "pendiente" | "off";
function estadoConector(c: SimatConectorEstado): EstadoConector {
  if (!c.habilitado) return "off";
  if (c.fallosSeguidos > 0) return "fallos";
  return c.ultimoExito ? "ok" : "pendiente";
}
const COLOR_CONECTOR: Record<EstadoConector, string> = { ok: "#1baf7a", fallos: "#d03b3b", pendiente: "#eda100", off: "#94a3b8" };
const NOMBRE_ESTADO: Record<EstadoConector, string> = { ok: "En línea", fallos: "Con fallos", pendiente: "Sin datos aún", off: "Desactivado" };
const ICONO_CONECTOR: Record<string, NombreIcono> = {
  ierse: "rain",
  ioc: "waves",
  inocar: "waves",
  "inamhi-inventario": "tower",
  "inamhi-series": "rain",
  fcd: "droplets",
  metar: "activity",
};

export function PillConector({ c }: { c: SimatConectorEstado }) {
  const e = estadoConector(c);
  if (e === "fallos")
    return (
      <span className="pill red pulse">
        <span className="pd" />
        Con fallos
      </span>
    );
  return <Pill color={e === "ok" ? "green" : e === "pendiente" ? "amber" : ""}>{NOMBRE_ESTADO[e]}</Pill>;
}

/* ---------- piezas del panel ---------- */

function Kpi({ etiqueta, valor, detalle, icono, tono = "", visual, texto = false }: { etiqueta: string; valor: React.ReactNode; detalle: React.ReactNode; icono: NombreIcono; tono?: string; visual?: React.ReactNode; texto?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{etiqueta}</span>
        <span className={`kpi-icon ${tono}`}>
          <Icono nombre={icono} />
        </span>
      </div>
      <div className={`kpi-value${texto ? " is-text" : ""}`}>{valor}</div>
      <div className="kpi-detail">{detalle}</div>
      {visual ? <div className="kpi-visual">{visual}</div> : null}
    </div>
  );
}

function Hecho({ icono, etiqueta, valor, clase = "" }: { icono: NombreIcono; etiqueta: string; valor: React.ReactNode; clase?: string }) {
  return (
    <div className="fact">
      <span className={`fact-icon ${clase}`}>
        <Icono nombre={icono} />
      </span>
      <div>
        <small>{etiqueta}</small>
        <strong>{valor}</strong>
      </div>
    </div>
  );
}

export function Cargando() {
  const { cargando, error, refrescar } = useSimat();
  if (!cargando && error)
    return (
      <div className="boot is-error">
        <Icono nombre="circleAlert" />
        <div>
          <strong>No se pudo cargar la información de vigilancia.</strong>
          <p>{error}</p>
        </div>
        <button type="button" className="button" onClick={() => void refrescar()}>
          <Icono nombre="refresh" />
          Reintentar
        </button>
      </div>
    );
  return (
    <div className="boot">
      <span className="live-dot" aria-hidden="true" />
      Cargando la situación territorial…
    </div>
  );
}

export default function VistaGeneral() {
  const { estado, isla, estacionesAmbito, estacionId, setEstacionId, estacion, lluvia } = useSimat();
  const [marinos, setMarinos] = useState<SimatNivelMar[]>([]);

  const islaRiesgo = isla === TODAS_LAS_ISLAS ? estacion?.isla : isla;
  const puerto = Object.keys(estado?.puertos?.[islaRiesgo ?? ""] ?? {})[0];
  const nombrePuerto = (puerto && estado?.puertos?.[islaRiesgo ?? ""]?.[puerto]) || puerto;

  useEffect(() => {
    if (!puerto || !estado) {
      setMarinos([]);
      return;
    }
    const ctrl = new AbortController();
    obtenerMareas(puerto, ctrl.signal).then(
      (rows) => !ctrl.signal.aborted && setMarinos(rows),
      () => !ctrl.signal.aborted && setMarinos([]),
    );
    return () => ctrl.abort();
  }, [puerto, estado]);

  if (!estado) return <Cargando />;

  const latest = lluvia?.latest ?? null;
  const f = frescura(lluvia, estacion);
  const daily = estacion?.pasoMin === 1440;
  const step = estacion?.pasoMin ?? 60;

  /* indicadores */
  const resultados = estado.riesgo.filter((r) => isla === TODAS_LAS_ISLAS || r.criterio.isla === isla);
  const evaluados = resultados.filter((r) => r.nivel);
  const peor = evaluados.reduce((max, r) => Math.max(max, MATRIZ.findIndex((i) => i.name === r.nivel)), -1);
  const nivelPeor = MATRIZ[peor];
  const pasos = (
    <>
      <div className="level-steps cuatro" role="img" aria-label={peor >= 0 ? `Nivel ${peor + 1} de 4: ${nivelPeor.name}` : "Sin nivel evaluado"}>
        {MATRIZ.map((n, i) => (
          <span key={n.name} className={peor >= 0 && i <= peor ? "on" : undefined} style={peor >= 0 && i <= peor ? ({ "--lvl": COLORES.status[peor] } as CSSProperties) : undefined} title={n.name} />
        ))}
      </div>
      <p className="level-caption">{peor >= 0 ? `Nivel ${peor + 1} de 4 · ${nivelPeor.decision}` : "Escala de 4 niveles de la matriz"}</p>
    </>
  );
  const activas = estacionesAmbito.filter((s) => s.activa).length;
  const inactivas = estacionesAmbito.length - activas;
  const chipsEstaciones = (
    <div className="station-chips">
      {activas ? <Pill color="teal">{`${activas} ${activas === 1 ? "activa" : "activas"}`}</Pill> : null}
      {inactivas ? <Pill color="amber">{`${inactivas} ${inactivas === 1 ? "inactiva" : "inactivas"}`}</Pill> : null}
      {estacionesAmbito.length ? null : <Pill>Sin estaciones</Pill>}
    </div>
  );
  const valoresSpark = (lluvia?.recent ?? []).map((r) => (r.quality === "válido" ? r.value : NaN));
  const visualLluvia =
    valoresSpark.filter(Number.isFinite).length > 1 ? (
      <>
        <Grafico className="" clave={`${estacionId}|${latest?.time}|${valoresSpark.length}`} dibujar={(el) => spark(el, valoresSpark)} />
        <div className="spark-cap">
          <span>{daily ? `Últimos ${valoresSpark.length} días` : `Últimas ${duracion(valoresSpark.length * step)}`}</span>
          <span>mm por intervalo</span>
        </div>
      </>
    ) : null;
  const rain24 = lluvia?.windows.find((w) => w.minutes === 1440);
  const conectores = estado.conectores;
  const conteo = (["ok", "fallos", "pendiente", "off"] as EstadoConector[]).map((e) => ({ e, n: conectores.filter((c) => estadoConector(c) === e).length }));
  const habilitados = conectores.filter((c) => c.habilitado).length;
  const visualConectores = conectores.length ? (
    <>
      <div className="seg-bar" role="img" aria-label={conteo.map(({ e, n }) => `${NOMBRE_ESTADO[e]}: ${n}`).join(", ")}>
        {conteo.map(({ e, n }) => (n ? <span key={e} style={{ flex: n, background: COLOR_CONECTOR[e] }} /> : null))}
      </div>
      <div className="seg-legend">
        {conteo.map(({ e, n }) =>
          n ? (
            <span key={e}>
              <i style={{ background: COLOR_CONECTOR[e] }} />
              {NOMBRE_ESTADO[e]} <b>{n}</b>
            </span>
          ) : null,
        )}
      </div>
    </>
  ) : null;

  /* hero */
  const chips: React.ReactNode[] = [];
  if (latest)
    chips.push(
      <span className="hero-chip" key="ultimo">
        <Icono nombre="clock" />
        Último dato <b>{daily ? fechaDia(latest.time) : horaCorta(latest.time)}</b>
      </span>,
    );
  if (f)
    chips.push(
      <span className="hero-chip" key="frescura">
        <Icono nombre={f.fresh ? "check" : "history"} />
        {f.fresh ? "Serie al día" : `Serie atrasada · ${hace(latest?.time)}`}
      </span>,
    );
  if (estacion && !estacion.activa)
    chips.push(
      <span className="hero-chip is-demo" key="inactiva">
        <Icono nombre="info" />
        Estación inactiva
      </span>,
    );
  if (!latest)
    chips.push(
      <span className="hero-chip" key="sin">
        <Icono nombre="info" />
        Sin serie para este ámbito
      </span>,
    );
  const etiquetaUltimo = latest ? `${daily ? fechaDia(latest.time) : fechaHora(latest.time)}${latest.quality === "válido" ? ` · ${numero(latest.value)} mm` : ` · ${latest.quality}`}` : "";

  /* banda de riesgo */
  const ahora = Date.now();
  const proxima = puerto ? extremosMarea(marinos, puerto, ahora).find((e) => e.t >= ahora && e.fase === "Pleamar") : undefined;
  const hora = lluvia?.windows.find((w) => w.minutes === 60);
  const observado = puerto ? observacionPuerto(marinos, puerto) : undefined;
  const provisionales = resultados.length > 0 && resultados.every((r) => !r.criterio.activo);

  /* precipitación reciente */
  const slots = ranurasLluvia(lluvia, estacion);
  const validos = slots.filter((s) => s.v != null);
  const maximo = validos.length ? Math.max(...validos.map((s) => s.v as number)) : null;
  const acumulado = validos.reduce((sum, s) => sum + (s.v as number), 0);
  const verHora = (iso?: string | null) => (daily ? fechaDia(iso) : fechaHora(iso));

  /* lluvia antecedente */
  const ventanas = (lluvia?.windows ?? []).filter((w) => w.minutes >= 60 && (!estacion || w.minutes >= estacion.pasoMin));
  const pico = Math.max(0, ...ventanas.map((w) => w.total ?? 0));
  const mag = pico > 0 ? 10 ** (Math.floor(Math.log10(pico)) - 1) : 1;
  const tope = pico > 0 ? Math.ceil(pico / mag) * mag : 1;

  /* actividad de las fuentes */
  const actividad = [...conectores].sort((a, b) => (Date.parse(b.ultimoIntento ?? "") || 0) - (Date.parse(a.ultimoIntento ?? "") || 0)).slice(0, 5);

  return (
    <>
      <section className="hero hero-map" aria-labelledby="hero-title">
        <MapaGeo
          variant="hero"
          island={isla}
          stations={estacionesAmbito}
          selected={estacionId}
          live={!!f?.fresh}
          latest={etiquetaUltimo}
          latestShort={latest?.quality === "válido" ? `${numero(latest.value)} mm` : ""}
          onStation={setEstacionId}
        />
        <div className="hero-inner">
          <div className="hero-panel">
            <div className="eyebrow">
              <Icono nombre="waves" />
              Vigilancia hidrometeorológica
            </div>
            <h1 id="hero-title">Panel de vigilancia</h1>
            <p>Seguimiento provincial y coordinación territorial</p>
            <div className="hero-live">{chips}</div>
            <div className="hero-filters">
              <FiltroIsla />
              <FiltroEstacion />
            </div>
          </div>
        </div>
      </section>

      <div className="kpis">
        <Kpi
          etiqueta="Nivel de riesgo"
          valor={nivelPeor?.name ?? "Sin evaluación"}
          detalle={evaluados.length ? `${evaluados.length} de ${resultados.length} sectores evaluados` : resultados.length ? `${resultados.length} criterios · sin evaluación vigente` : "Sin criterios en el ámbito"}
          icono="gauge"
          visual={pasos}
          texto
        />
        <Kpi etiqueta="Estaciones en inventario" valor={estacionesAmbito.length} detalle="Instrumentación registrada" icono="tower" tono="sky" visual={chipsEstaciones} />
        <Kpi
          etiqueta="Lluvia acumulada · 24 h"
          valor={
            rain24?.total != null ? (
              <>
                {numero(rain24.total)} <small>mm</small>
              </>
            ) : (
              "—"
            )
          }
          detalle={`${estacion?.nombre ?? "Sin estación"}${latest ? ` · ${verHora(latest.time)}` : ""}`}
          icono="rain"
          tono="violet"
          visual={visualLluvia}
        />
        <Kpi etiqueta="Conectores en línea" valor={`${conteo[0].n}/${habilitados}`} detalle="Fuentes sincronizadas por el worker" icono="database" tono="amber" visual={visualConectores} />
      </div>

      {provisionales ? (
        <div className="banner">
          <Icono nombre="alert" />
          <div>
            <strong>Criterios de riesgo por calibrar</strong> · Los {resultados.length} criterios del ámbito son provisionales y están desactivados: la matriz no emite niveles hasta que un técnico calibre sus umbrales y los active.
          </div>
        </div>
      ) : (
        <div className="banner info">
          <Icono nombre="info" />
          <div>
            <strong>Datos en vivo</strong> · Lluvia de IERSE e INAMHI, mareas de INOCAR e IOC y pronóstico de Open-Meteo. Cada valor indica su fuente.
          </div>
        </div>
      )}

      <section className={`card risk-band ${nivelPeor?.code ?? "unavailable"}`}>
        <div className="risk-band-dial">
          <Dial nivel={peor} />
          <div className="dial-caption">
            <strong>
              {nivelPeor ? (
                <>
                  <Icono nombre={nivelPeor.icon} />
                  {nivelPeor.name}
                </>
              ) : (
                "Sin evaluación"
              )}
            </strong>
            <span>{nivelPeor ? nivelPeor.decision : "Sin criterio vigente en el ámbito"}</span>
          </div>
        </div>
        <div className="risk-band-body">
          <h2>Riesgo por lluvia y nivel del mar</h2>
          <p className="meta">Matriz de decisión para sectores con influencia costera</p>
          {evaluados.length ? (
            <div className="risk-summary">
              {evaluados.map((r) => {
                const n = MATRIZ.find((i) => i.name === r.nivel);
                return n ? (
                  <span key={r.criterio.id} className={`risk-status ${n.code}`}>
                    <Icono nombre={n.icon} />
                    {r.criterio.sector} · {n.name}
                  </span>
                ) : null;
              })}
            </div>
          ) : (
            <p className="meta" style={{ marginTop: 10 }}>
              {resultados.length ? "Sin evaluación vigente. Consulta los datos y criterios de cada sector." : "Sin evaluación automática. Consulta la matriz y las predicciones de marea por puerto."}
            </p>
          )}
          <div className="risk-facts">
            <Hecho
              icono="rain"
              etiqueta="Intensidad media · 1 h"
              valor={
                hora?.intensity != null ? (
                  <>
                    {numero(hora.intensity)} mm/h <span>{estacion?.nombre ?? ""}</span>
                  </>
                ) : (
                  "Sin ventana completa"
                )
              }
            />
            {puerto ? (
              <Hecho
                icono="waves"
                clase="sea"
                etiqueta={`Próxima pleamar · ${nombrePuerto}`}
                valor={
                  proxima ? (
                    <>
                      {horaCorta(new Date(proxima.t).toISOString())} · {numero(proxima.h)} m <span>{proxima.ref}</span>
                    </>
                  ) : (
                    "Sin predicciones importadas"
                  )
                }
              />
            ) : null}
            {observado ? (
              <Hecho
                icono="anchor"
                clase="sea"
                etiqueta="Nivel del mar observado"
                valor={
                  <>
                    {medida(observado.valor)} {observado.unidad} <span>{horaMarina(observado)}</span>
                  </>
                }
              />
            ) : null}
          </div>
        </div>
        <Link className="button secondary" href="/simat/riesgo">
          Ver matriz y evidencia
          <Icono nombre="arrow" />
        </Link>
      </section>

      <div className="grid">
        <section className="card rain-card">
          <CardHead
            titulo="Precipitación reciente"
            descripcion={latest && estacion ? `${estacion.nombre} · intervalos de ${duracion(estacion.pasoMin)} · ${latest.source}` : "Sin datos"}
            extra={
              f ? (
                f.fresh ? (
                  <Pill color="green" punto>{`Dato vigente · ${hace(latest?.time)}`}</Pill>
                ) : (
                  <Pill color="amber" punto>{`Último dato ${hace(latest?.time)}`}</Pill>
                )
              ) : null
            }
            icono="rain"
          />
          {validos.length && latest && estacion ? (
            <>
              <div className="chart-stats" style={{ padding: "0 18px 6px" }}>
                <StatMini etiqueta="Último intervalo">
                  {latest.quality === "válido" ? (
                    <>
                      {numero(latest.value)} <span>mm</span>
                    </>
                  ) : (
                    latest.quality
                  )}
                </StatMini>
                <StatMini etiqueta="Máximo visible">
                  {numero(maximo)} <span>mm</span>
                </StatMini>
                <StatMini etiqueta="Acumulado visible">
                  {numero(acumulado)} <span>mm</span>
                </StatMini>
              </div>
              <div className="chart-body">
                <Grafico id="chart" clave={`${estacion.id}|${latest.time}|${slots.length}`} dibujar={(el) => rain(el, { slots, step: estacion.pasoMin, compact: true })} />
              </div>
              <div className="chart-legend">
                {slots.some((s) => s.v == null) ? (
                  <span>
                    <i className="gap" />
                    Sin dato válido
                  </span>
                ) : null}
                <span>
                  {daily ? "Fecha diaria de la serie" : "Hora de Galápagos"} · {verHora(lluvia?.recent[0]?.time)} → {verHora(latest.time)}
                </span>
              </div>
              <details className="table-toggle">
                <summary>Ver los datos en tabla</summary>
                <Tabla
                  cabeceras={["Intervalo", "Lluvia", "Intensidad", "Calidad"]}
                  filas={[...slots].reverse().map((s) => [
                    verHora(new Date(s.t).toISOString()),
                    s.v == null ? "—" : `${numero(s.v)} mm`,
                    s.v == null ? "—" : `${numero((s.v * 60) / estacion.pasoMin)} mm/h`,
                    s.q || "Sin registro",
                  ])}
                />
              </details>
            </>
          ) : (
            <Vacio>Sin intervalos válidos para la estación seleccionada.</Vacio>
          )}
        </section>

        <section className="card">
          <CardHead
            titulo="Actividad de las fuentes"
            descripcion="Últimas sincronizaciones del worker"
            extra={
              <Link className="button small" href="/simat/fuentes">
                <Icono nombre="tower" />
                Ver fuentes
              </Link>
            }
            icono="activity"
          />
          {actividad.length ? (
            <ol className="timeline">
              {actividad.map((c) => {
                const e = estadoConector(c);
                const tono = e === "ok" ? "is-ok" : e === "fallos" ? "is-urgent" : e === "pendiente" ? "is-review" : "";
                return (
                  <li className="tl-item" key={c.conector}>
                    <span className={`tl-node ${tono}`}>
                      <Icono nombre={ICONO_CONECTOR[c.conector] ?? "pin"} />
                    </span>
                    <div>
                      <div className="tl-top">
                        <strong>{c.nombre}</strong>
                        <PillConector c={c} />
                      </div>
                      <p className="tl-meta">{c.error ?? c.resultado ?? c.descripcion}</p>
                      <p className="tl-time">{c.ultimoIntento ? `${fechaHora(c.ultimoIntento)} · ${hace(c.ultimoIntento)}` : "Sin ejecuciones"}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Vacio>Sin conectores registrados.</Vacio>
          )}
        </section>
      </div>

      <div className="grid grid-even">
        <section className="card">
          <CardHead
            titulo="Lluvia antecedente"
            descripcion={estacion && ventanas.length ? `Acumulados móviles cerrados en la última marca · ${estacion.nombre}` : "Acumulados móviles de 1 a 72 h"}
            icono="droplets"
          />
          {estacion && ventanas.length ? (
            <ul className="meter-list">
              {ventanas.map((w) => {
                const ok = w.total != null;
                return (
                  <li key={w.minutes} className={`meter-row${ok ? "" : " is-missing"}`}>
                    <span className="meter-name">{duracion(w.minutes)}</span>
                    <span className="meter-track" role="img" aria-label={`${duracion(w.minutes)}: ${ok ? `${numero(w.total)} mm` : w.reason}`}>
                      {ok ? <span className="meter-fill" style={{ width: `${Math.max((w.total as number) > 0 ? 1.5 : 0, ((w.total as number) / tope) * 100)}%` }} /> : null}
                    </span>
                    <span className="meter-figure">
                      {ok ? (
                        <>
                          <strong>{numero(w.total)} mm</strong>
                          <span>
                            {numero(w.intensity)} mm/h · {w.valid}/{w.expected}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong className="warn">Incompleta</strong>
                          <span>{w.expected ? `${w.valid}/${w.expected} válidos` : w.reason}</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Vacio>No hay series para el ámbito seleccionado.</Vacio>
          )}
        </section>

        <section className="card">
          <CardHead titulo="Estaciones" descripcion="Inventario del ámbito · selecciona una para ver su serie" icono="tower" />
          {estacionesAmbito.length ? (
            <ul className="station-list">
              {estacionesAmbito.map((s) => {
                const seleccionada = s.id === estacionId;
                return (
                  <li key={s.id}>
                    <button type="button" className="station-row" aria-pressed={seleccionada} onClick={() => setEstacionId(s.id)}>
                      <span className="station-glyph">
                        <Icono nombre="tower" />
                      </span>
                      <span>
                        <span className="station-name">{s.nombre}</span>
                        <span className="station-sub">
                          {s.id} · {s.isla} · {s.pasoMin >= 1440 ? "diaria" : `cada ${duracion(s.pasoMin)}`}
                        </span>
                      </span>
                      <span className="station-side">
                        {s.activa ? <Pill color="teal">Activa</Pill> : <Pill color="amber">Inactiva</Pill>}
                        {seleccionada && f ? <span className="meta">{f.fresh ? "Dato vigente" : `Último dato ${hace(latest?.time)}`}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Vacio>Sin estaciones en este ámbito.</Vacio>
          )}
        </section>
      </div>
    </>
  );
}
