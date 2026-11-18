"use client";

// Riesgo por lluvia y mar, réplica de la vista previa (risk-ui.js, riskPage()),
// integrada como sección del panel único (/simat), con todas las gráficas a la
// vista:
// filtros, aviso costero, evaluación del sector con dial y matriz (y modo de
// simulación), evidencia de lluvia y mar con medidores de umbral y gráficas
// desplegables (la de lluvia, con la marea y las zonas de la matriz), nota del
// criterio y predicciones de marea.

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SimatCriterio, SimatEstacion, SimatEvaluacion, SimatMareografo, SimatNivelMar, SimatPronostico, SimatSerieLluvia } from "@pma/types";
import { obtenerMareas, obtenerMareografo, obtenerPronostico } from "@/lib/simat/api";
import { forecast, sea, tide, type SeaPoint } from "@/lib/simat/graficos";
import { avisoMarino, extremosMarea, horaMarina, MAREOGRAFO_POR_PUERTO, observacionPuerto, prediccionesPuerto, puertosIsla } from "@/lib/simat/marinos";
import { duracion, fechaDia, fechaHora, medida, numero } from "@/lib/simat/formato";
import { TODAS_LAS_ISLAS, useSimat } from "./contexto";
import { Icono } from "./iconos";
import { MATRIZ, type NivelMatriz } from "./matriz";
import ExploradorLluvia, { type MareaExplorador } from "./ExploradorLluvia";
import { CriterioModal, NivelObservadoModal, ventanasCompatibles } from "./Formularios";
import { Cargando } from "./VistaGeneral";
import { CardHead, Dial, FiltroEstacion, FiltroIsla, Grafico, Pill, Tabla, Vacio } from "./piezas";

type EstadoMareografo = SimatMareografo | "cargando" | "sin" | "error" | null;
type EstadoPronostico = SimatPronostico | "cargando" | "error";

/* ---------- piezas ---------- */

function TablaMatriz({ actual }: { actual?: string }) {
  const celda = (item: NivelMatriz) => (
    <td key={item.name} className={`matrix-cell ${item.code}${actual === item.name ? " is-current" : ""}`}>
      <strong>
        <Icono nombre={item.icon} />
        {item.name}
        {actual === item.name ? <span className="matrix-selected">Resultado</span> : null}
      </strong>
      <p>{item.note}</p>
      <small>{item.decision}</small>
    </td>
  );
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
      <table className="risk-matrix">
        <thead>
          <tr>
            <th scope="col">{dos("Intensidad de lluvia", "Lluvia")}</th>
            <th scope="col">{dos("Nivel del mar bajo", "Mar bajo")}</th>
            <th scope="col">{dos("Nivel del mar alto", "Mar alto")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Baja</th>
            {MATRIZ.slice(0, 2).map(celda)}
          </tr>
          <tr>
            <th scope="row">Alta</th>
            {MATRIZ.slice(2).map(celda)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Decision({ result, simulacion, lluviaAlta, marAlto, consultado }: { result?: SimatEvaluacion; simulacion: boolean; lluviaAlta: boolean; marAlto: boolean; consultado: string }) {
  const item = simulacion ? MATRIZ[Number(lluviaAlta) * 2 + Number(marAlto)] : MATRIZ.find((i) => i.name === result?.nivel);
  const profile = result?.criterio;
  const title = item?.name ?? (profile ? "Datos insuficientes" : "Sin evaluación");
  const subtitle = item?.decision ?? (profile ? "Se requieren dos datos compatibles y vigentes." : "Falta un criterio local para la estación, puerto y sector elegidos.");
  return (
    <div className="decision">
      <div className="decision-main">
        <div className={`decision-state ${item?.code ?? "unavailable"}`}>
          <div className="dial-wrap">
            <Dial nivel={item ? MATRIZ.indexOf(item) : -1} />
          </div>
          <div>
            <div className="mode-badge">
              <Icono nombre={simulacion ? "flask" : "gauge"} />
              {simulacion ? "Simulación de la matriz" : "Evaluación automática · piloto"}
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
            {profile && !simulacion ? (
              <p className="meta">
                {profile.sector} · {profile.puerto}
              </p>
            ) : null}
            {result?.motivos.length && !simulacion ? (
              <ul>
                {result.motivos.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <p className="decision-note">{simulacion ? "Ejercicio con entradas manuales." : `Consulta ${fechaHora(consultado)} · Galápagos. La autoridad competente emite las alertas oficiales.`}</p>
      </div>
      <div className="decision-matrix">
        <h3>Matriz de toma de decisiones</h3>
        <TablaMatriz actual={item?.name} />
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
}: {
  kind: "rain" | "gauge";
  titulo: string;
  valor: string;
  resumen: ReactNode;
  lineas: [string, ReactNode][];
  extra?: ReactNode;
}) {
  const m = /^(.*) (mm\/h|m)$/.exec(valor);
  return (
    <section className="card risk-measure fija" data-risk-chart={kind}>
      <h2>
        <span className="risk-measure-toggle">
          <span>
            <span className={`measure-icon ${kind === "gauge" ? "sea" : ""}`}>
              <Icono nombre={kind === "gauge" ? "waves" : "rain"} />
            </span>
            {titulo}
          </span>
          <a className="risk-chart-chevron" href={`#${kind}-history`}>
            Ver gráfica
            <Icono nombre="down" />
          </a>
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
      <div className="measure-foot" />
    </section>
  );
}

function tendencia(points: SeaPoint[], edad: number) {
  const last = points[points.length - 1];
  const sinTendencia = { title: "Tendencia reciente no disponible", tone: "steady" as const, detail: "Se requieren lecturas recientes y continuas para comparar los últimos 15 minutos." };
  if (!last) return sinTendencia;
  const start = last.time - 15 * 60000;
  const recent = points.filter((p) => p.time >= start && p.time <= last.time);
  if (edad > 30 || recent.length < 2 || recent[0].time !== start || recent.some((p, i) => i > 0 && p.time - recent[i - 1].time > 180000)) return sinTendencia;
  const change = Math.round((last.level - recent[0].level) * 1e6) / 1e6;
  const tone = change > 0 ? ("up" as const) : change < 0 ? ("down" as const) : ("steady" as const);
  const title = { up: "Está subiendo", down: "Está bajando", steady: "Sin cambio neto" }[tone];
  return { title, tone, detail: `${change > 0 ? "+" : ""}${medida(change)} m · últimos 15 min` };
}

function HistoriaMareografo({ m }: { m: SimatMareografo }) {
  const points = m.serie.map((p) => ({ time: Date.parse(p.fecha), level: p.valor }));
  const edad = Math.max(0, Math.floor((Date.now() - Date.parse(m.fecha)) / 60000));
  const t = tendencia(points, edad);
  const hay = points.length > 1 && points[points.length - 1].time > points[0].time;
  const ultimo = points[points.length - 1];
  return (
    <section className="card wide">
      <CardHead
        titulo="Evolución del nivel del mar observado"
        descripcion={`${m.estacion} · Sensor RAS · Hora de Galápagos`}
        extra={
          <div className={`gauge-trend ${t.tone}`}>
            <Icono nombre={t.tone === "up" ? "up" : t.tone === "down" ? "downTrend" : "steady"} />
            <div>
              <strong>{t.title}</strong>
              <span>{t.detail}</span>
            </div>
          </div>
        }
        icono="waves"
      />
      {hay ? (
        <>
          <div className="chart-body">
            <Grafico id="gauge-chart" clave={`${m.codigo}|${m.fecha}|${points.length}`} dibujar={(el) => sea(el, { points, recentFrom: ultimo.time - 15 * 60000 })} />
          </div>
          <div className="chart-legend">
            <span>
              <i className="line" style={{ "--c": "#2a78d6" } as CSSProperties} />
              Nivel observado
            </span>
            <span>
              <i className="line" style={{ "--c": "#1c5cab", height: 4 } as CSSProperties} />
              Últimos 15 min
            </span>
            <span>Los cortes indican falta de datos.</span>
          </div>
          <div className="card-foot meta">
            De {fechaHora(new Date(points[0].time).toISOString())} a {fechaHora(m.fecha)} · Mediciones preliminares
          </div>
        </>
      ) : (
        <Vacio>Se necesitan al menos dos lecturas para graficar la evolución.</Vacio>
      )}
    </section>
  );
}

/** Pronóstico de lluvia de Open-Meteo para la estación (una consulta por estación). */
function usePronostico(id: string): EstadoPronostico {
  const [data, setData] = useState<EstadoPronostico>("cargando");
  useEffect(() => {
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
 * del sector y las zonas de la matriz) y el panel del modelo meteorológico.
 */
function HistoriaLluvia({ estacion, lluvia, criterio, marea }: { estacion: SimatEstacion; lluvia: SimatSerieLluvia | null; criterio: SimatCriterio | null; marea: MareaExplorador | null }) {
  const pronostico = usePronostico(estacion.id);
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
          <ExploradorLluvia estacion={estacion} lluvia={lluvia} criterio={criterio} marea={marea} pronostico={typeof pronostico === "object" ? pronostico.pronostico : null} />
        ) : (
          <Vacio>No hay intervalos de lluvia válidos para esta estación.</Vacio>
        )}
      </section>
      <PanelPronostico estacion={estacion} lluvia={lluvia} data={pronostico} />
    </>
  );
}

function PanelPronostico({ estacion, lluvia, data }: { estacion: SimatEstacion; lluvia: SimatSerieLluvia | null; data: EstadoPronostico }) {

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
              <Grafico id="forecast-chart" clave={`${estacion.id}|${data.consultado}`} dibujar={(el) => forecast(el, { hours: data.pronostico })} />
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
  const [simulacion, setSimulacion] = useState(false);
  const [lluviaAlta, setLluviaAlta] = useState(false);
  const [marAlto, setMarAlto] = useState(false);
  const [modal, setModal] = useState<"criterio" | "agregar" | "observado" | null>(null);
  const [marinos, setMarinos] = useState<SimatNivelMar[]>([]);
  const [mareografo, setMareografo] = useState<EstadoMareografo>(null);
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

  const mismaArea = (r: SimatEvaluacion) => isla === TODAS_LAS_ISLAS || r.criterio.isla === isla;
  const perfiles = estado.riesgo.filter((r) => mismaArea(r) && r.criterio.estacion === estacionId && r.criterio.puerto === puerto);
  const result = perfiles.find((r) => r.criterio.sector === sector) ?? perfiles[0];
  const profile = result?.criterio;
  const nombrePuerto = puertos.get(puerto) ?? puerto;
  const rwin = profile?.ventanaMin ?? 60;
  const raw = lluvia?.windows.find((w) => w.minutes === rwin);
  const latest = lluvia?.latest;
  const rain = result?.lluvia ?? { valor: raw?.intensity ?? null, fecha: latest?.time ?? null, fuente: latest?.source ?? null, intervalos: raw?.valid ?? null, esperados: raw?.expected ?? null };
  const marObservado = profile ? result.mar : (observacionPuerto(marinos, puerto) ?? null);
  const predicciones = prediccionesPuerto(marinos, puerto);
  const limiteMar = profile ? `${medida(profile.marM)} m · ${profile.datum}` : "Por calibrar";
  const limiteLluvia = profile ? `${medida(profile.lluviaMmH)} mm/h` : "Por calibrar";
  const marComparable = !!profile && !!marObservado && marObservado.unidad === "m" && String(marObservado.referencia).trim().toLowerCase() === profile.datum.toLowerCase();
  const aviso = avisoMarino(result, predicciones);

  /* mareas */
  const extremos = extremosMarea(marinos, puerto);
  const refMarea = extremos[0]?.ref.toLowerCase();
  const umbralCompatible = !!profile?.activo && !!refMarea && profile.datum.toLowerCase() === refMarea;
  const observadosMarea = marinos
    .filter((r) => r.puerto === puerto && r.tipo === "Nivel observado" && r.unidad === "m" && String(r.referencia || "").trim().toLowerCase() === refMarea && Number.isFinite(r.valor))
    .map((r) => ({ t: Date.parse(r.instante), h: r.valor }))
    .filter((o) => Number.isFinite(o.t));

  const editar = estado.puedeEditar;
  const abrirCriterio = (tipo: "criterio" | "agregar") => {
    if (!estacion) return notificar("Selecciona una estación del inventario.");
    if (!ventanasCompatibles(estacion).length) return notificar("Selecciona una estación con resolución compatible con intensidad de lluvia.");
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
          ["Uso en la matriz", "La lectura requiere validación y un datum compatible con el umbral del sector."],
        ]}
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
          ["Umbral de mar alto", limiteMar],
        ]}
        extra={
          <>
            {marComparable ? <MedidorUmbral valor={marObservado?.valor} limite={profile?.marM} unidad="m" /> : null}
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

      <section className={`card wide risk-result ${aviso.tone}`} id="marine-advisory">
        <div className="risk-result-main">
          <span className="risk-result-icon">
            <Icono nombre={aviso.tone === "caution" ? "alert" : "waves"} />
          </span>
          <div>
            <div className="eyebrow">Aviso por nivel del mar · {nombrePuerto}</div>
            <h2>{aviso.title}</h2>
            {aviso.row ? (
              <p>
                <strong>
                  {medida(aviso.row.valor)} {aviso.row.unidad}
                </strong>{" "}
                · {aviso.row.referencia} · {horaMarina(aviso.row)} · {aviso.row.fuente}
              </p>
            ) : null}
            <p>{aviso.detail}</p>
          </div>
        </div>
      </section>

      <section className="card wide decision-card">
        <div className="decision-top">
          <h2 style={{ fontSize: 15.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="gauge" />
            Evaluación del sector
          </h2>
          <div className="risk-mode">
            <label>
              Modo de consulta
              <select value={simulacion ? "simulate" : "automatic"} onChange={(e) => setSimulacion(e.target.value === "simulate")}>
                <option value="automatic">Evaluación automática</option>
                <option value="simulate">Simulación de la matriz</option>
              </select>
            </label>
            {simulacion ? (
              <>
                <label>
                  Intensidad de lluvia
                  <select value={lluviaAlta ? "Alta" : "Baja"} onChange={(e) => setLluviaAlta(e.target.value === "Alta")}>
                    <option>Baja</option>
                    <option>Alta</option>
                  </select>
                </label>
                <label>
                  Nivel del mar
                  <select value={marAlto ? "Alto" : "Bajo"} onChange={(e) => setMarAlto(e.target.value === "Alto")}>
                    <option>Bajo</option>
                    <option>Alto</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>
        <div id="risk-decision">
          <Decision result={result} simulacion={simulacion} lluviaAlta={lluviaAlta} marAlto={marAlto} consultado={estado.generadoEn} />
        </div>
      </section>

      <div className="grid risk-evidence">
        <Medicion
          kind="rain"
          titulo="Intensidad de precipitación"
          valor={rain.valor == null ? "Sin dato" : `${medida(rain.valor)} mm/h`}
          resumen={`Promedio del intervalo de ${duracion(rwin)}`}
          lineas={[
            ["Fin del intervalo", rain.fecha ? `${fechaHora(rain.fecha)} · Galápagos` : "—"],
            ["Fuente", rain.fuente || "—"],
            ["Intervalos válidos", rain.esperados ? `${rain.intervalos} / ${rain.esperados}` : "—"],
            ["Umbral de lluvia alta", limiteLluvia],
          ]}
          extra={profile ? <MedidorUmbral valor={rain.valor} limite={profile.lluviaMmH} unidad="mm/h" /> : null}
        />
        <div id="marine-observed">{medicionMar}</div>
      </div>

      <div id="rain-history" className="ancla">
        {estacion ? (
            <HistoriaLluvia estacion={estacion} lluvia={lluvia} criterio={profile ?? null} marea={extremos.length >= 2 ? { extremos, observados: observadosMarea } : null} />
          ) : (
            <section className="card wide rain-explorer" id="rain-explorer">
              <CardHead titulo="Evolución de la lluvia y la marea" descripcion="Sin estación seleccionada" icono="activity" />
              <Vacio>Selecciona una estación del inventario.</Vacio>
            </section>
          )}
      </div>

      <div id="gauge-history" className="ancla">
        {mareografo && typeof mareografo === "object" ? (
            <HistoriaMareografo m={mareografo} />
          ) : (
            <section className="card wide">
              <CardHead titulo="Evolución del nivel del mar observado" icono="waves" />
              <Vacio>{codigoMareografo ? feedback || "Consultando la serie del mareógrafo…" : "No hay una serie de mareógrafo disponible para este puerto."}</Vacio>
            </section>
          )}
      </div>

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
                clave={`${puerto}|${extremos.length}|${extremos[0].t}|${observadosMarea.length}|${umbralCompatible ? profile?.marM : "-"}`}
                dibujar={(el) => tide(el, { extremes: extremos, observed: observadosMarea, threshold: umbralCompatible && profile ? profile.marM : null })}
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
              <span>Datum {extremos[0].ref || "—"} · hora publicada asumida en Galápagos</span>
            </div>
          </>
        ) : null}
        {predicciones.length ? (
          <Tabla
            cabeceras={["Fecha y hora", "Fase", "Altura", "Referencia", "Frente al umbral marino", "Fuente"]}
            filas={predicciones.slice(0, 12).map((r) => [
              horaMarina(r),
              r.fase || "—",
              `${medida(r.valor)} ${r.unidad}`,
              r.referencia,
              profile?.activo && r.unidad === "m" && String(r.referencia).trim().toLowerCase() === profile.datum.toLowerCase() ? (
                <Pill color={r.valor >= profile.marM ? "amber" : "green"}>{r.valor >= profile.marM ? "Alto previsto" : "Bajo previsto"}</Pill>
              ) : (
                "—"
              ),
              r.fuente,
            ])}
          />
        ) : (
          <Vacio>Este puerto aún no tiene predicciones importadas.</Vacio>
        )}
      </section>

      {modal === "criterio" || modal === "agregar" ? (
        estacion ? (
          <CriterioModal
            estacion={estacion}
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
