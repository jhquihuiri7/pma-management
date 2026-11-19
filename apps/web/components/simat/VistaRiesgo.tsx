"use client";

// Riesgo por lluvia y mar, réplica de la vista previa (risk-ui.js, riskPage()),
// integrada como sección del panel único (/simat), con todas las gráficas a la
// vista:
// filtros, evaluación del sector con dial y matriz (y modo de
// simulación), evidencia de lluvia y mar con medidores de umbral y gráficas
// desplegables (la de lluvia, con la marea y las zonas de la escala), nota del
// criterio y predicciones de marea.

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SimatCriterio, SimatEstacion, SimatEvaluacion, SimatMonitoreoMarea, SimatUmbralMarea, SimatMareografo, SimatNivelMar, SimatPronostico, SimatSerieLluvia } from "@pma/types";
import { obtenerMareas, obtenerMareografo, obtenerPronostico } from "@/lib/simat/api";
import { forecast, tide, type RangoTiempo, type TideExtreme } from "@/lib/simat/graficos";
import { clasificarPercentil, comparacionDatum, extremosMarea, horaMarina, MAREOGRAFO_POR_PUERTO, observacionPuerto, puertosIsla } from "@/lib/simat/marinos";
import { duracion, fechaDia, fechaHora, medida, numero } from "@/lib/simat/formato";
import { TODAS_LAS_ISLAS, useSimat } from "./contexto";
import { Icono } from "./iconos";
import { ESCALA, indiceNivel, nivelConMar, rangoLluvia } from "./matriz";
import ExploradorLluvia, { type MareaExplorador } from "./ExploradorLluvia";
import { CriterioModal, estacionesDeLluvia, NivelObservadoModal } from "./Formularios";
import { Cargando } from "./VistaGeneral";
import { CardHead, Dial, FiltroEstacion, FiltroIsla, Grafico, Pill, Tabla, Vacio } from "./piezas";

type EstadoMareografo = SimatMareografo | "cargando" | "sin" | "error" | null;
type EstadoPronostico = SimatPronostico | "cargando" | "error";

/* ---------- piezas ---------- */

/**
 * Matriz de decisión: cada fila es un tramo de lluvia de la escala del sector.
 * Con umbral de mar hay dos columnas (mar bajo / mar alto, que sube un nivel);
 * sin umbral de mar solo se muestra el nivel por lluvia y su acción (el usuario
 * pidió no ver la columna «mar alto · sin umbral»).
 */
function MatrizEscala({ fila, columna, criterio }: { fila: number | null; columna: number | null; criterio?: SimatCriterio }) {
  const conMar = criterio?.marM != null;
  const columnas = conMar ? [0, 1] : [0];
  const dos = (largo: string, corto: string) => (
    <>
      <span className="long">{largo}</span>
      <span className="short" aria-hidden="true">
        {corto}
      </span>
    </>
  );
  return (
    <div className="table-wrap matrix-wrap">
      <table className={`risk-matrix escala${conMar ? "" : " solo-lluvia"}`}>
        <thead>
          <tr>
            <th scope="col">{dos(`Lluvia${criterio ? ` · ${duracion(criterio.ventanaMin)}` : ""}`, "Lluvia")}</th>
            {conMar ? (
              <>
                <th scope="col">{dos("Nivel del mar bajo", "Mar bajo")}</th>
                <th scope="col">{dos(`Mar alto · ≥ ${medida(criterio!.marM)} m`, "Mar alto")}</th>
              </>
            ) : (
              <th scope="col">Nivel y acción</th>
            )}
          </tr>
        </thead>
        <tbody>
          {ESCALA.map((fil, i) => (
            <tr key={fil.name}>
              <th scope="row">{criterio ? rangoLluvia(i, criterio.lluvia) : fil.name}</th>
              {columnas.map((m) => {
                const item = nivelConMar(i, m === 1);
                const actual = fila === i && columna === m;
                return (
                  <td key={m} className={`matrix-cell ${item.code}${actual ? " is-current" : ""}`} title={conMar ? item.note : undefined}>
                    <strong>
                      <Icono nombre={item.icon} />
                      {item.name}
                      {actual ? <span className="matrix-selected">Resultado</span> : null}
                    </strong>
                    {conMar ? null : <p>{item.note}</p>}
                    <small>{item.decision}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {conMar ? (
        <p className="meta escala-mar">
          <Icono nombre="waves" />
          {`El mar alto (≥ ${medida(criterio!.marM)} m ${criterio!.datum}) sube un nivel.`}
        </p>
      ) : !criterio ? (
        <p className="meta escala-mar">Configura un criterio para ver los umbrales del sector.</p>
      ) : null}
    </div>
  );
}

/** Evaluación automática del sector (el modo de simulación se quitó a pedido del usuario). */
/** Lluvia medida en la ventana del criterio (lo que decide el nivel). */
interface LluviaVentana {
  valor: number | null;
  fecha: string | null;
  fuente: string | null;
  intervalos: number | null;
  esperados: number | null;
}

function Decision({ result, consultado, lluvia, ventanaMin }: { result?: SimatEvaluacion; consultado: string; lluvia: LluviaVentana; ventanaMin: number }) {
  const profile = result?.criterio;
  const conMar = profile?.marM != null;
  const oficial = result?.nivel ? ESCALA[indiceNivel(result.nivel)] : undefined;
  const orientativo = !oficial && result?.nivelOrientativo ? ESCALA[indiceNivel(result.nivelOrientativo)] : undefined;
  const item = oficial ?? orientativo;
  const filaLluvia = indiceNivel(result?.nivelLluvia);
  const fila = item && filaLluvia >= 0 ? filaLluvia : null;
  const columna = fila == null ? null : Number(conMar && result?.marAlto === true);
  const title = item?.name ?? (profile ? "Datos insuficientes" : "Sin evaluación");
  const subtitle = item?.decision ?? (profile ? "Se requiere una ventana de lluvia completa y vigente." : "Falta un criterio local para la estación, puerto y sector elegidos.");
  const notas = [...(result?.motivos ?? []), ...(result?.avisos ?? [])];
  return (
    <div className="decision con-matriz">
      <div className="decision-main">
        <div className={`decision-state ${item?.code ?? "unavailable"}${orientativo ? " es-orientativo" : ""}`}>
          <div className="dial-wrap">
            <Dial nivel={item ? ESCALA.indexOf(item) : -1} />
          </div>
          <div>
            <div className="mode-badge">
              <Icono nombre={orientativo ? "info" : "gauge"} />
              {orientativo ? "Experimental · orientativo, no oficial" : "Evaluación automática"}
            </div>
            <h2>
              {item ? (
                <>
                  <Icono nombre={item.icon} />{" "}
                </>
              ) : null}
              {title}
            </h2>
            <p>{subtitle}</p>
            {profile ? (
              <p className="meta">
                {profile.sector} · {profile.puerto}
                {profile.estadoValidacion === "experimental" ? " · umbrales experimentales" : ""}
              </p>
            ) : null}
            {notas.length ? (
              <ul>
                {notas.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="decision-lluvia">
          <div className="dl-top">
            <span className="measure-icon">
              <Icono nombre="rain" />
            </span>
            <span>Lluvia en {duracion(ventanaMin)}</span>
            <strong>
              {lluvia.valor == null ? "Sin dato" : medida(lluvia.valor)}
              {lluvia.valor == null ? null : <small> mm/h</small>}
            </strong>
          </div>
          {profile ? <MedidorEscala valor={lluvia.valor} criterio={profile} /> : null}
          <p className="meta">
            {lluvia.fecha ? `Cierre ${fechaHora(lluvia.fecha)}` : "Sin intervalo cerrado"} · {lluvia.fuente || "sin fuente"}
            {lluvia.esperados ? ` · ${lluvia.intervalos} / ${lluvia.esperados} intervalos válidos` : ""}
          </p>
        </div>
        <p className="decision-note">{`Consulta ${fechaHora(consultado)} · Galápagos. La autoridad competente emite las alertas oficiales.`}</p>
      </div>
      <div className="decision-matrix">
        <h3>{conMar ? "Matriz de decisión · lluvia × mar" : "Matriz de decisión · lluvia"}</h3>
        <MatrizEscala fila={fila} columna={columna} criterio={profile} />
      </div>
    </div>
  );
}

/** Medidor de lluvia con las tres marcas de la escala (vigilancia, preparación, respuesta). */
function MedidorEscala({ valor, criterio }: { valor: number | null | undefined; criterio: SimatCriterio }) {
  if (valor == null || !Number.isFinite(valor)) return null;
  const marcas = [criterio.lluvia.vigilancia, criterio.lluvia.preparacion, criterio.lluvia.respuesta];
  const tope = Math.max(valor, marcas[2]) * 1.15 || 1;
  const item = ESCALA[Math.min(3, marcas.filter((m) => valor >= m).length)];
  const color = { normal: "var(--rain)", caution: "#fab219", alert: "#ec835a", emergency: "var(--critical)" }[item.code];
  return (
    <div className="threshold-meter">
      <div className="meter-track" role="img" aria-label={`${medida(valor)} mm/h: nivel ${item.name}`}>
        <span className="meter-fill" style={{ width: `${Math.min(100, (valor / tope) * 100)}%`, background: color }} />
        {marcas.map((m, i) => (
          <span key={i} className="tm-mark" style={{ left: `calc(${(m / tope) * 100}% - 1px)`, background: ["#fab219", "#ec835a", "var(--critical)"][i] }} title={`${ESCALA[i + 1].name} ≥ ${medida(m)} mm/h`} />
        ))}
      </div>
      <div className="tm-cap">
        <span>Nivel por lluvia: {item.name}</span>
        <span>
          {marcas.map((m) => medida(m)).join(" · ")} mm/h
        </span>
      </div>
    </div>
  );
}

function MedidorUmbral({ valor, limite, unidad }: { valor: number | null | undefined; limite: number | null | undefined; unidad: string }) {
  if (valor == null || !Number.isFinite(valor) || limite == null || !Number.isFinite(limite) || limite <= 0) return null;
  const top = Math.max(valor, limite) * 1.2;
  return (
    <div className="threshold-meter">
      <div className="meter-track" role="img" aria-label={`${medida(valor)} ${unidad} frente al umbral de ${medida(limite)} ${unidad}`}>
        <span className="meter-fill" style={{ width: `${Math.min(100, (valor / top) * 100)}%`, background: valor >= limite ? "var(--critical)" : "var(--rain)" }} />
        <span className="tm-mark" style={{ left: `calc(${(limite / top) * 100}% - 1px)` }} />
      </div>
      <div className="tm-cap">
        <span>{numero((valor / limite) * 100)} % del umbral</span>
        <span>
          Umbral {medida(limite)} {unidad}
        </span>
      </div>
    </div>
  );
}

function Medicion({
  kind,
  titulo,
  valor,
  resumen,
  lineas,
  extra,
  pie,
  ancho = false,
}: {
  kind: "rain" | "gauge";
  titulo: string;
  valor: string;
  resumen: ReactNode;
  lineas: [string, ReactNode][];
  extra?: ReactNode;
  /** Bloque al final de la tarjeta, después de los datos. */
  pie?: ReactNode;
  /** A todo el ancho: datos a la izquierda y el pie a la derecha. */
  ancho?: boolean;
}) {
  const m = /^(.*) (mm\/h|m)$/.exec(valor);
  const cuerpo = (
    <>
      <h2>
        <span className="risk-measure-toggle">
          <span>
            <span className={`measure-icon ${kind === "gauge" ? "sea" : ""}`}>
              <Icono nombre={kind === "gauge" ? "waves" : "rain"} />
            </span>
            {titulo}
          </span>
        </span>
      </h2>
      <div className="risk-measure-value">
        {m ? (
          <>
            {m[1]} <small>{m[2]}</small>
          </>
        ) : (
          valor
        )}
      </div>
      <p className="meta">{resumen}</p>
      {extra}
      <dl>
        {lineas.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
  return (
    <section className={`card risk-measure fija${ancho ? " ancho" : ""}`} data-risk-chart={kind}>
      {ancho ? (
        <div className="rm-cols">
          <div className="rm-datos">{cuerpo}</div>
          <div className="rm-pie">{pie}</div>
        </div>
      ) : (
        <>
          {cuerpo}
          {pie}
        </>
      )}
      <div className="measure-foot" />
    </section>
  );
}

const ESTADO_MAREA: Record<SimatMonitoreoMarea["estado"], { etiqueta: string; color: string }> = {
  MONITOREO_VALIDO: { etiqueta: "Monitoreo válido", color: "green" },
  SOLO_PREDICCION: { etiqueta: "Solo predicción", color: "" },
  SIN_PREDICCION: { etiqueta: "Sin predicción", color: "" },
  DATUM_INCOMPATIBLE: { etiqueta: "Datum incompatible", color: "amber" },
  HORA_SIN_ZONA: { etiqueta: "Hora sin zona", color: "amber" },
  DATO_NO_VIGENTE: { etiqueta: "Dato no vigente", color: "amber" },
  SIN_HORA_PREDICCION: { etiqueta: "Predicción sin hora", color: "amber" },
  DATOS_DESFASADOS: { etiqueta: "Datos desfasados", color: "amber" },
};

function explicarMarea(m: SimatMonitoreoMarea): string {
  switch (m.estado) {
    case "MONITOREO_VALIDO":
      return "Anomalía = observada − predicha. Positiva: el mar está más alto de lo previsto.";
    case "SOLO_PREDICCION":
      return "Hay predicción, pero ninguna observación del nivel del mar para comparar.";
    case "SIN_PREDICCION":
      return "No hay predicción de marea publicada para este puerto a esa hora.";
    case "DATUM_INCOMPATIBLE":
      return `La predicción está en ${m.datum ?? "—"} y la observación en «${m.datumObservado ?? "—"}»: no se pueden comparar hasta tener el desfase entre ambas referencias o una medición en ${m.datum ?? "el mismo datum"}.`;
    case "HORA_SIN_ZONA":
      return "Una de las horas no indica su zona horaria.";
    case "DATO_NO_VIGENTE":
      return `La última observación compatible tiene más de ${m.vigenciaMin} min (o es posterior a la consulta).`;
    case "SIN_HORA_PREDICCION":
      return "La predicción no tiene hora.";
    case "DATOS_DESFASADOS":
      return `La predicción y la observación están separadas más de ${m.desfaseMin} min.`;
  }
}

/** Monitoreo de marea del puerto (evaluar_marea del equipo técnico): prevista frente a observada. */
function MonitoreoMarea({ m }: { m: SimatMonitoreoMarea }) {
  const e = ESTADO_MAREA[m.estado];
  const a = m.anomaliaMarM;
  return (
    <div className="monitoreo-marea">
      <div className="mm-top">
        <strong>Monitoreo de marea</strong>
        <Pill color={e.color}>{e.etiqueta}</Pill>
      </div>
      <dl>
        <dt>Prevista · INOCAR</dt>
        <dd>{m.mareaPredichaM == null ? "—" : `${medida(m.mareaPredichaM)} m ${m.datum ?? ""} · ${fechaHora(m.fechaPrediccion)}`}</dd>
        <dt>Observada</dt>
        <dd>{m.mareaObservadaM == null ? "—" : `${medida(m.mareaObservadaM)} m · ${m.datumObservado ?? "—"}`}</dd>
        <dt>Anomalía</dt>
        <dd>
          <b>{a == null ? "—" : `${a > 0 ? "+" : ""}${medida(a)} m`}</b>
        </dd>
      </dl>
      <p className="meta">{explicarMarea(m)}</p>
      <p className="meta">Sin alerta de inundación: no hay un umbral de inundación validado.</p>
    </div>
  );
}

const dosDecimales = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const horaGal = new Intl.DateTimeFormat("es-EC", { timeZone: "Pacific/Galapagos", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Percentiles de marea alta del puerto (equipo técnico, 0046): referencia de
 * monitoreo experimental. Si son comparables con la predicción de INOCAR,
 * clasifica la próxima pleamar; no es un umbral de inundación.
 */
function PercentilesMarea({ u, comparable, proxima }: { u: SimatUmbralMarea; comparable: "si" | "no_confirmado" | "no"; proxima?: TideExtreme }) {
  const clase = comparable !== "no" && proxima ? clasificarPercentil(proxima.h, u) : null;
  const datum = u.datum.replace(/_NO_CONFIRMADO$/i, " (no confirmado)");
  return (
    <div className="percentiles-marea">
      <div className="mm-top">
        <strong>Marea alta de referencia · {u.nombre}</strong>
        <Pill color={u.validado ? "green" : ""}>{u.validado ? "Validado" : "Monitoreo experimental"}</Pill>
      </div>
      <div className="pct-fila">
        {(["p90", "p95", "p99"] as const).map((k) => (
          <span key={k}>
            {k}
            <b>{dosDecimales.format(u[k])} m</b>
          </span>
        ))}
      </div>
      {clase && proxima ? (
        <p>
          Próxima pleamar prevista <b>{dosDecimales.format(proxima.h)} m</b> · {horaGal.format(proxima.t)} → <b>{clase.texto}</b>
          {comparable === "no_confirmado" ? " (datum MLWS no confirmado)" : ""}
        </p>
      ) : comparable === "no" ? (
        <p className="meta">No hay predicciones de marea comparables en el sistema para este puerto.</p>
      ) : null}
      <p className="meta">
        Datum {datum} · periodo {u.periodo} · método {u.metodo.replace(/_/g, " ")}. {u.alertasOficiales ? "" : "Sin alertas oficiales: "}son percentiles de las pleamares, no un umbral de inundación.
      </p>
    </div>
  );
}

/** Pronóstico de lluvia de Open-Meteo para la estación (una consulta por estación). */
function usePronostico(id: string | undefined): EstadoPronostico {
  const [data, setData] = useState<EstadoPronostico>("cargando");
  useEffect(() => {
    if (!id) {
      setData("error");
      return;
    }
    const ctrl = new AbortController();
    setData("cargando");
    obtenerPronostico(id, ctrl.signal).then(
      (p) => !ctrl.signal.aborted && setData(p),
      () => !ctrl.signal.aborted && setData("error"),
    );
    return () => ctrl.abort();
  }, [id]);
  return data;
}

/**
 * Historia de la lluvia: el explorador (con la marea del puerto, los umbrales
 * del sector y las zonas de la escala) y el panel del modelo meteorológico.
 */
function HistoriaLluvia({
  estacion,
  lluvia,
  criterio,
  marea,
  codigoMareografo,
  pronostico,
  rango,
}: {
  estacion: SimatEstacion;
  lluvia: SimatSerieLluvia | null;
  criterio: SimatCriterio | null;
  marea: MareaExplorador | null;
  codigoMareografo?: string;
  pronostico: EstadoPronostico;
  /** Eje de tiempo común de los gráficos de lluvia prevista y de marea prevista. */
  rango: RangoTiempo;
}) {
  // Serie del mareógrafo de las últimas 48 h (una lectura cada 5 min) para
  // compararla con la marea prevista en la parte ya transcurrida.
  const [serieMedida, setSerieMedida] = useState<SimatMareografo | null>(null);
  useEffect(() => {
    if (!codigoMareografo) {
      setSerieMedida(null);
      return;
    }
    const ctrl = new AbortController();
    obtenerMareografo(codigoMareografo, ctrl.signal, { horas: 48, paso: 5 }).then(
      (m) => !ctrl.signal.aborted && setSerieMedida(m),
      () => !ctrl.signal.aborted && setSerieMedida(null),
    );
    return () => ctrl.abort();
  }, [codigoMareografo]);
  const mareaConMedida = useMemo(
    () =>
      marea
        ? {
            ...marea,
            medida: serieMedida
              ? {
                  puntos: serieMedida.serie.map((p) => ({ t: Date.parse(p.fecha), h: p.valor })).filter((p) => Number.isFinite(p.t)),
                  referencia: serieMedida.referencia,
                  estacion: serieMedida.estacion,
                }
              : null,
          }
        : null,
    [marea, serieMedida],
  );
  const tieneLluviaValida = !!lluvia?.recent.some((r) => r.quality === "válido");
  return (
    <>
      <section className="card wide rain-explorer" id="rain-explorer">
        <CardHead
          titulo={criterio ? `Lluvia, marea y riesgo · ${criterio.sector}` : "Evolución de la lluvia y la marea"}
          descripcion={`${estacion.nombre} · ${duracion(estacion.pasoMin)} por intervalo · Hora de Galápagos · Serie registrada${typeof pronostico === "object" ? " y pronóstico" : ""}`}
          icono="activity"
        />
        {lluvia && tieneLluviaValida ? (
          <ExploradorLluvia
            estacion={estacion}
            lluvia={lluvia}
            criterio={criterio}
            marea={mareaConMedida}
            pronostico={typeof pronostico === "object" ? pronostico.pronostico : null}
          />
        ) : (
          <Vacio>No hay intervalos de lluvia válidos para esta estación.</Vacio>
        )}
      </section>
      <PanelPronostico estacion={estacion} lluvia={lluvia} data={pronostico} rango={rango} />
    </>
  );
}

function PanelPronostico({ estacion, lluvia, data, rango }: { estacion: SimatEstacion; lluvia: SimatSerieLluvia | null; data: EstadoPronostico; rango: RangoTiempo }) {

  const valida = [...(lluvia?.recent ?? [])].reverse().find((r) => r.quality === "válido");
  const observacion = valida ? (
    <p className="meta">
      Última medición válida · {estacion.pasoMin === 1440 ? fechaDia(valida.time) : `${fechaHora(valida.time)} · Galápagos`} · {medida((valida.value * 60) / estacion.pasoMin)} mm/h en {duracion(estacion.pasoMin)} · {valida.source}
    </p>
  ) : (
    <p className="meta">Sin medición real de lluvia en la serie seleccionada.</p>
  );

  let contenido: ReactNode;
  if (data === "cargando") contenido = <Vacio>Consultando el pronóstico…</Vacio>;
  else if (data === "error")
    contenido = (
      <div className="pad">
        <p>Pronóstico temporalmente no disponible.</p>
        {observacion}
      </div>
    );
  else {
    const actual = data.estimacion;
    contenido = (
      <>
        <div className="rain-current">
          <div className="big">
            <strong>{actual ? medida(Number(actual.intensidad.toFixed(2))) : "—"}</strong>
            <span>{actual ? "mm/h estimados" : "Sin estimación"}</span>
          </div>
          <span className="meta">Estimación del modelo · hora de Galápagos</span>
          {actual ? (
            <p>
              <b>{medida(actual.mm)} mm</b> estimados en {duracion(actual.minutos)} · {fechaHora(actual.inicio)} → {fechaHora(actual.fin)}
            </p>
          ) : (
            <p>
              <b>Estimación actual no disponible</b>
            </p>
          )}
          {observacion}
          <p className="meta">Consultado {fechaHora(data.consultado)}</p>
        </div>
        {data.pronostico.length ? (
          <>
            <div className="chart-body">
              <Grafico id="forecast-chart" clave={`${estacion.id}|${data.consultado}|${rango.start}`} dibujar={(el) => forecast(el, { hours: data.pronostico, rango })} />
            </div>
            <div className="chart-legend">
              <span>
                <i style={{ "--c": "#0d9488" } as CSSProperties} />
                Precipitación prevista (mm por hora)
              </span>
              <span>
                <i className="ramp" />
                Probabilidad de 0 a 100 %
              </span>
            </div>
            <details className="rain-forecast-details">
              <summary>Pronóstico por hora · próximas 24 horas</summary>
              <Tabla
                cabeceras={["Intervalo en Galápagos", "Precipitación prevista", "Probabilidad"]}
                filas={data.pronostico.map((h) => [`${fechaHora(h.inicio)} → ${fechaHora(h.fin)}`, h.mm === null ? "—" : `${medida(h.mm)} mm`, h.probabilidad === null ? "—" : `${medida(h.probabilidad)} %`])}
              />
            </details>
          </>
        ) : (
          <Vacio>Sin horas previstas disponibles.</Vacio>
        )}
      </>
    );
  }

  return (
    <section id="rain-model" className="card wide">
      <CardHead
        titulo="Lluvia actual estimada y pronóstico"
        descripcion={`Modelo meteorológico para las coordenadas de ${estacion.nombre}`}
        extra={
          <a className="text-link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo <Icono nombre="external" />
          </a>
        }
        icono="rain"
      />
      <div id="rain-model-content" aria-live="polite">
        {contenido}
      </div>
    </section>
  );
}

/* ---------- vista ---------- */

export default function VistaRiesgo() {
  const { estado, isla, estacionId, estacion, lluvia, refrescar, notificar } = useSimat();
  const [puerto, setPuerto] = useState("");
  const [sector, setSector] = useState<string | null>(null);
  const [modal, setModal] = useState<"criterio" | "agregar" | "observado" | null>(null);
  const [marinos, setMarinos] = useState<SimatNivelMar[]>([]);
  const [mareografo, setMareografo] = useState<EstadoMareografo>(null);
  // Pronóstico de lluvia de la estación: lo usan el explorador, el panel del
  // modelo y, por su periodo, el eje de tiempo del gráfico de mareas.
  const pronostico = usePronostico(estacion?.id);
  const islaPrevia = useRef<string | undefined>(undefined);

  const islaRiesgo = isla === TODAS_LAS_ISLAS ? estacion?.isla : isla;
  const puertos = useMemo(() => (estado ? puertosIsla(estado.puertos, estado.riesgo, islaRiesgo) : new Map<string, string>()), [estado, islaRiesgo]);

  // El puerto pertenece al ámbito; al cambiar de isla vuelve al primero.
  useEffect(() => {
    if (islaPrevia.current !== islaRiesgo || !puertos.has(puerto)) {
      setPuerto(puertos.keys().next().value ?? "");
      setSector(null);
    }
    islaPrevia.current = islaRiesgo;
  }, [puertos, puerto, islaRiesgo]);

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

  const codigoMareografo = MAREOGRAFO_POR_PUERTO[puerto];
  useEffect(() => {
    if (!codigoMareografo || !estado) {
      setMareografo(null);
      return;
    }
    const ctrl = new AbortController();
    setMareografo((m) => (m && typeof m === "object" && m.codigo === codigoMareografo ? m : "cargando"));
    obtenerMareografo(codigoMareografo, ctrl.signal).then(
      (m) => !ctrl.signal.aborted && setMareografo(m),
      (err) => !ctrl.signal.aborted && setMareografo((err as { status?: number })?.status === 404 ? "sin" : "error"),
    );
    return () => ctrl.abort();
  }, [codigoMareografo, estado]);

  if (!estado) return <Cargando />;

  // Eje de tiempo común de «Lluvia actual estimada y pronóstico» y «Predicciones
  // de marea»: el periodo del pronóstico (o, sin él, desde la hora actual 24 h).
  const horaActual = Math.floor(Date.now() / 3600e3) * 3600e3;
  const horasPronostico = typeof pronostico === "object" ? pronostico.pronostico : [];
  const rangoPronostico: RangoTiempo = horasPronostico.length
    ? { start: Date.parse(horasPronostico[0].inicio), end: Date.parse(horasPronostico[horasPronostico.length - 1].fin) }
    : { start: horaActual, end: horaActual + 24 * 3600e3 };

  const mismaArea = (r: SimatEvaluacion) => isla === TODAS_LAS_ISLAS || r.criterio.isla === isla;
  // Los sectores sin estación (p. ej. Isabela, Floreana, Baltra) se listan con cualquier estación.
  const perfiles = estado.riesgo.filter((r) => mismaArea(r) && (r.criterio.estacion === estacionId || r.criterio.estacion === null) && r.criterio.puerto === puerto);
  const result = perfiles.find((r) => r.criterio.sector === sector) ?? perfiles[0];
  const profile = result?.criterio;
  const nombrePuerto = puertos.get(puerto) ?? puerto;
  const rwin = profile?.ventanaMin ?? 60;
  const raw = lluvia?.windows.find((w) => w.minutes === rwin);
  const latest = lluvia?.latest;
  const rain = result?.lluvia ?? { valor: raw?.intensity ?? null, fecha: latest?.time ?? null, fuente: latest?.source ?? null, intervalos: raw?.valid ?? null, esperados: raw?.expected ?? null };
  const marObservado = profile ? result.mar : (observacionPuerto(marinos, puerto) ?? null);
  const limiteMar = profile ? (profile.marM != null ? `${medida(profile.marM)} m · ${profile.datum} (sube un nivel)` : "Sin umbral: no modifica el nivel") : "Por calibrar";
  const marComparable = !!profile && profile.marM != null && !!marObservado && marObservado.unidad === "m" && String(marObservado.referencia).trim().toLowerCase() === profile.datum.toLowerCase();

  /* mareas */
  const extremos = extremosMarea(marinos, puerto);
  const refMarea = extremos[0]?.ref.toLowerCase();
  const umbralCompatible = !!profile?.activo && profile.marM != null && !!refMarea && profile.datum.toLowerCase() === refMarea;
  const observadosMarea = marinos
    .filter((r) => r.puerto === puerto && r.tipo === "Nivel observado" && r.unidad === "m" && String(r.referencia || "").trim().toLowerCase() === refMarea && Number.isFinite(r.valor))
    .map((r) => ({ t: Date.parse(r.instante), h: r.valor }))
    .filter((o) => Number.isFinite(o.t));

  const editar = estado.puedeEditar;
  const estacionesLluvia = estacionesDeLluvia(estado.estaciones, profile?.isla ?? islaRiesgo);
  const abrirCriterio = (tipo: "criterio" | "agregar") => {
    if (!puerto) return notificar("Selecciona un puerto de referencia.");
    setModal(tipo);
  };

  /* evidencia: nivel del mar (mareógrafo si responde) */
  const feedback =
    codigoMareografo && (mareografo === "cargando" || mareografo === null)
      ? "Consultando el mareógrafo de INOCAR…"
      : mareografo === "sin"
        ? "INOCAR no publicó una lectura utilizable en el periodo consultado."
        : mareografo === "error"
          ? "No se pudo consultar el mareógrafo de INOCAR. Puedes volver a intentar con Actualizar."
          : "";
  const monitoreo = estado.monitoreoMarea?.find((m) => m.puerto === puerto);
  const umbralMarea = estado.umbralesMarea?.find((u) => u.puerto === puerto);
  const comparablePct = umbralMarea ? comparacionDatum(umbralMarea.datum, extremos[0]?.ref) : "no";
  const percentiles = umbralMarea && comparablePct !== "no" ? { p90: umbralMarea.p90, p95: umbralMarea.p95, p99: umbralMarea.p99, confirmado: comparablePct === "si" } : null;
  const proximaPleamar = extremos.find((e) => e.t >= Date.now() && e.fase === "Pleamar");
  const pieMar = (
    <>
      {monitoreo ? <MonitoreoMarea m={monitoreo} /> : null}
      {umbralMarea ? <PercentilesMarea u={umbralMarea} comparable={comparablePct} proxima={proximaPleamar} /> : null}
    </>
  );
  let medicionMar: ReactNode;
  if (mareografo && typeof mareografo === "object") {
    const edad = Math.max(0, Math.floor((Date.now() - Date.parse(mareografo.fecha)) / 60000));
    medicionMar = (
      <Medicion
        kind="gauge"
        titulo="Nivel del mar observado"
        valor={`${medida(mareografo.valor)} m`}
        resumen={`${mareografo.estacion} · ${edad > 30 ? "Última lectura disponible · dato atrasado" : `Última lectura disponible · hace ${edad} min`}`}
        lineas={[
          ["Hora de medición", `${fechaHora(mareografo.fecha)} · Galápagos`],
          ["Sensor", mareografo.sensor],
          ["Referencia vertical", mareografo.referencia],
          [
            "Calidad y fuente",
            <>
              {mareografo.calidad} ·{" "}
              <a href={mareografo.enlace} target="_blank" rel="noopener noreferrer">
                {mareografo.fuente}
              </a>
            </>,
          ],
          ["Uso en la escala", "Sube un nivel solo con umbral de mar en el sector, lectura validada y datum compatible."],
        ]}
        pie={pieMar}
        ancho
      />
    );
  } else {
    medicionMar = (
      <Medicion
        kind="gauge"
        titulo="Nivel del mar observado"
        valor={marObservado ? `${medida(marObservado.valor)} ${marObservado.unidad}` : "Sin medición"}
        resumen={nombrePuerto}
        lineas={[
          ["Hora de medición", marObservado ? horaMarina(marObservado) : "—"],
          ["Referencia vertical", marObservado?.referencia || "—"],
          ["Calidad y fuente", marObservado ? `${marObservado.calidad} · ${marObservado.fuente}` : "—"],
          ["Umbral de mar", limiteMar],
        ]}
        pie={pieMar}
        ancho
        extra={
          <>
            {marComparable ? <MedidorUmbral valor={marObservado?.valor} limite={profile?.marM ?? null} unidad="m" /> : null}
            {feedback ? (
              <p className="meta gauge-feedback" role="status">
                {feedback}
              </p>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <>
      <div className="section-head ancla" id="riesgo-sector">
        <div>
          <div className="eyebrow">
            <Icono nombre="alert" />
            Riesgo por lluvia y mar
          </div>
          <h2>Riesgo por sector costero</h2>
          <p className="meta">Nivel, mediciones y criterio de decisión del sector, con la lluvia, la marea y el mareógrafo.</p>
        </div>
        {editar ? (
          <div className="toolbar">
            <button type="button" className="button" onClick={() => abrirCriterio("criterio")}>
              <Icono nombre="settings" />
              {profile ? "Editar criterio" : "Configurar criterio"}
            </button>
            {profile ? (
              <button type="button" className="button outline" onClick={() => abrirCriterio("agregar")}>
                <Icono nombre="plus" />
                Añadir sector
              </button>
            ) : null}
            <button type="button" className="button outline" onClick={() => setModal("observado")}>
              <Icono nombre="waves" />
              Registrar nivel observado
            </button>
          </div>
        ) : null}
      </div>

      <div className="filter-bar risk-filters">
        <FiltroIsla />
        <FiltroEstacion />
        <label>
          Puerto de referencia
          <select
            value={puerto}
            onChange={(e) => {
              setPuerto(e.target.value);
              setSector(null);
            }}
          >
            {Array.from(puertos).map(([codigo, etiqueta]) => (
              <option key={codigo} value={codigo}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>
        {perfiles.length ? (
          <label>
            Sector costero
            <select value={result?.criterio.sector} onChange={(e) => setSector(e.target.value)}>
              {perfiles.map((r) => (
                <option key={r.criterio.id} value={r.criterio.sector}>
                  {r.criterio.sector}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {/* El aviso por nivel del mar se quitó a pedido del usuario. */}
      <section className="card wide decision-card">
        <div className="decision-top">
          <h2 style={{ fontSize: 15.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="gauge" />
            Evaluación del sector
          </h2>
          <span className="mode-badge">
            <Icono nombre="clock" />
            Evaluación automática con el último dato
          </span>
        </div>
        <div id="risk-decision">
          <Decision result={result} consultado={estado.generadoEn} lluvia={rain} ventanaMin={rwin} />
        </div>
      </section>

      {/* La lluvia medida va dentro de la evaluación del sector; el nivel del mar, a todo el ancho. */}
      <div id="marine-observed" className="marine-wide">
        {medicionMar}
      </div>

      <div id="rain-history" className="ancla">
        {estacion ? (
            <HistoriaLluvia
              estacion={estacion}
              lluvia={lluvia}
              criterio={profile ?? null}
              marea={extremos.length >= 2 ? { extremos, observados: observadosMarea, percentiles } : null}
              codigoMareografo={codigoMareografo}
              pronostico={pronostico}
              rango={rangoPronostico}
            />
          ) : (
            <section className="card wide rain-explorer" id="rain-explorer">
              <CardHead titulo="Evolución de la lluvia y la marea" descripcion="Sin estación seleccionada" icono="activity" />
              <Vacio>Selecciona una estación del inventario.</Vacio>
            </section>
          )}
      </div>

      {/* El gráfico «Evolución del nivel del mar observado» se quitó a pedido del usuario. */}

      {profile ? (
        <section className="card wide">
          <div className="criteria-note">
            <Icono nombre="info" />
            <p>
              Criterio de {profile.sector} · vigencia máxima {duracion(profile.vigenciaMin)} · desfase máximo {duracion(profile.desfaseMin)}
              <br />
              Respaldo técnico y de conexión con el drenaje · {profile.respaldo}
            </p>
          </div>
        </section>
      ) : null}

      <section className="card wide ancla" id="mareas">
        <CardHead titulo={`Predicciones de marea · ${nombrePuerto}`} descripcion="Pleamares y bajamares publicadas. La evaluación automática usa mediciones observadas." icono="waves" />
        {extremos.length >= 2 ? (
          <>
            <div className="chart-body">
              <Grafico
                id="tide-chart"
                clave={`${puerto}|${extremos.length}|${extremos[0].t}|${observadosMarea.length}|${umbralCompatible ? profile?.marM : "-"}|${percentiles ? percentiles.p90 : "-"}|${rangoPronostico.start}|${rangoPronostico.end}`}
                dibujar={(el) =>
                  tide(el, {
                    extremes: extremos,
                    observed: observadosMarea,
                    threshold: umbralCompatible && profile ? profile.marM : null,
                    rango: rangoPronostico,
                    referencias: percentiles
                      ? [
                          { valor: percentiles.p90, etiqueta: `p90 ${dosDecimales.format(percentiles.p90)} m` },
                          { valor: percentiles.p95, etiqueta: `p95 ${dosDecimales.format(percentiles.p95)} m` },
                          { valor: percentiles.p99, etiqueta: `p99 ${dosDecimales.format(percentiles.p99)} m` },
                        ]
                      : [],
                  })
                }
              />
            </div>
            <div className="chart-legend">
              <span>
                <i className="line" style={{ "--c": "#2a78d6" } as CSSProperties} />
                Curva estimada entre extremos publicados
              </span>
              <span>
                <i className="dot" style={{ "--c": "#1c5cab" } as CSSProperties} />
                Pleamar o bajamar publicada
              </span>
              {observadosMarea.length ? (
                <span>
                  <i className="dot" style={{ "--c": "#eb6834" } as CSSProperties} />
                  Nivel observado
                </span>
              ) : null}
              {umbralCompatible ? (
                <span>
                  <i className="thr" />
                  Umbral de mar alto del sector
                </span>
              ) : null}
              {percentiles ? (
                <span>
                  <i className="pct" />
                  Percentiles de marea alta{percentiles.confirmado ? "" : " · datum MLWS no confirmado"}
                </span>
              ) : null}
              <span>Datum {extremos[0].ref || "—"} · hora publicada asumida en Galápagos</span>
            </div>
          </>
        ) : (
          // La tabla de pleamares y bajamares se quitó: el gráfico de lluvia y
          // marea ya las rotula con su hora y altura.
          <Vacio>Este puerto aún no tiene predicciones importadas.</Vacio>
        )}
      </section>

      {modal === "criterio" || modal === "agregar" ? (
        puerto ? (
          <CriterioModal
            estaciones={estacionesLluvia}
            estacionInicial={estacion && estacionesLluvia.some((e) => e.id === estacion.id) ? estacion.id : null}
            puerto={puerto}
            criterio={modal === "criterio" ? (profile ?? null) : null}
            onCerrar={() => setModal(null)}
            onGuardado={async (p, s) => {
              setPuerto(p);
              setSector(s);
              notificar("Criterio guardado.");
              await refrescar();
            }}
          />
        ) : null
      ) : null}
      {modal === "observado" ? (
        <NivelObservadoModal
          puerto={puerto}
          datum={profile?.datum ?? ""}
          onCerrar={() => setModal(null)}
          onGuardado={async (p) => {
            setPuerto(p);
            notificar("Medición marina guardada.");
            await refrescar();
          }}
        />
      ) : null}
    </>
  );
}
