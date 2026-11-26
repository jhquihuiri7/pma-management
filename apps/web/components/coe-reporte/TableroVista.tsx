"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  COLOR_ESTADO,
  ETIQUETA_TABLERO,
  ORDEN_ESTADOS,
  claveInstitucion,
  coeApi,
  descargarCsv,
  ordenarActividades,
  useCoeCatalogos,
} from "@/lib/coeReporte";
import type { CoeActividad, CoeCatalogos, CoeDirectorio, CoeEstado, CoeEvento } from "@/types";
import DiagramaConexiones from "./DiagramaConexiones";
import TarjetaActividad from "./TarjetaActividad";
import { boton, botonSecundario, control, etiqueta, tarjeta } from "./estilos";

const numero = new Intl.NumberFormat("es-EC");
const porcentaje = new Intl.NumberFormat("es-EC", { style: "percent", maximumFractionDigits: 1 });
const REFRESCO_MS = 30_000;

interface Filtros {
  dia: string;
  evento: string;
  isla: string;
  estado: "" | CoeEstado;
  institucion: string;
}
const SIN_FILTROS: Filtros = { dia: "", evento: "", isla: "", estado: "", institucion: "" };

/** The board: every activity reported, the notice recipients and the delegates. */
export default function TableroVista() {
  const { user, status } = useAuth();
  const { catalogos, error: errorCatalogos } = useCoeCatalogos();
  const [filas, setFilas] = useState<CoeActividad[] | null>(null);
  const [eventos, setEventos] = useState<CoeEvento[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [nota, setNota] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [actividades, lista] = await Promise.all([
        api.get<CoeActividad[]>("/coe-reporte/actividades"),
        coeApi.eventos(),
      ]);
      setFilas(ordenarActividades(actividades));
      setEventos(lista);
    } catch (err) {
      setNota(apiErrorMessage(err, "No se pudo cargar el tablero."));
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void cargar();
    const temporizador = setInterval(() => {
      if (!document.hidden) void cargar();
    }, REFRESCO_MS);
    return () => clearInterval(temporizador);
  }, [user, cargar]);

  const nombresEventos = useMemo(() => new Map(eventos.map((e) => [e.id, e.titulo])), [eventos]);

  if (status === "loading") return <Skeleton className="h-96 w-full" />;
  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        Inicie sesión para ver el tablero.{" "}
        <a href="/login?next=/coe-reporte/tablero" className="font-medium text-teal-700 underline-offset-4 hover:underline">Ingresar</a>
      </p>
    );
  }
  if (errorCatalogos) return <p className="text-sm text-destructive">{errorCatalogos}</p>;
  if (!filas || !catalogos) {
    return (
      <div className="space-y-3">
        {nota && <p className="text-sm text-destructive">{nota}</p>}
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const islas = Array.from(new Set(filas.map((f) => f.isla).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  const instituciones = new Map<string, string>();
  for (const f of filas) {
    const clave = claveInstitucion(f.institucion);
    if (clave && !instituciones.has(clave)) instituciones.set(clave, f.institucion.trim());
  }
  const visibles = filas.filter((f) =>
    (!filtros.dia || f.dia === filtros.dia)
    && (!filtros.evento || f.evento === filtros.evento)
    && (!filtros.isla || f.isla === filtros.isla)
    && (!filtros.estado || f.estado === filtros.estado)
    && (!filtros.institucion || claveInstitucion(f.institucion) === filtros.institucion));
  const filtrado = Object.values(filtros).some(Boolean);
  const poner = (campo: keyof Filtros, valor: string) => setFiltros((f) => ({ ...f, [campo]: valor }));

  return (
    <div className="space-y-6">
      {nota && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900">{nota}</p>}

      <section className={`${tarjeta} space-y-4`} aria-labelledby="coe-territorio">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="coe-territorio" className="text-lg font-semibold text-[#113349]">Actividad territorial</h2>
            <p className="text-sm text-slate-600">Programación y resultados de los reportes del COE.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={botonSecundario} onClick={() => descargarCsv(visibles, nombresEventos, catalogos)}>Descargar CSV</button>
            <button type="button" className={botonSecundario} onClick={() => void cargar()}>Actualizar</button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className={etiqueta}>
            Fecha
            <input type="date" className={control} value={filtros.dia} onChange={(e) => poner("dia", e.target.value)} />
          </label>
          <label className={etiqueta}>
            Evento
            <select className={control} value={filtros.evento} onChange={(e) => poner("evento", e.target.value)}>
              <option value="">Todos los eventos</option>
              {eventos.map((ev) => <option key={ev.id} value={ev.id}>{ev.id} · {ev.titulo}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Isla
            <select className={control} value={filtros.isla} onChange={(e) => poner("isla", e.target.value)}>
              <option value="">Todas las islas</option>
              {islas.map((i) => <option key={i}>{i}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Estado
            <select className={control} value={filtros.estado} onChange={(e) => poner("estado", e.target.value)}>
              <option value="">Todos los estados</option>
              {ORDEN_ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_TABLERO[e]}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Institución
            <select className={control} value={filtros.institucion} onChange={(e) => poner("institucion", e.target.value)}>
              <option value="">Todas las instituciones</option>
              {Array.from(instituciones).sort(([, a], [, b]) => a.localeCompare(b, "es")).map(([clave, nombre]) => (
                <option key={clave} value={clave}>{nombre}</option>
              ))}
            </select>
          </label>
        </div>
        {filtrado && (
          <button type="button" className="text-sm font-medium text-teal-700 hover:underline" onClick={() => setFiltros(SIN_FILTROS)}>
            Limpiar filtros
          </button>
        )}
      </section>

      <Resumen filas={visibles} />

      <section className={`${tarjeta} space-y-3`} aria-labelledby="coe-conexiones">
        <h3 id="coe-conexiones" className="font-semibold text-[#113349]">Conexiones por evento, institución e isla</h3>
        <p className="text-sm text-slate-600">
          Cada línea agrupa actividades registradas. Selecciona un evento en la tabla para ver sus actividades en el tablero.
        </p>
        <DiagramaConexiones filas={visibles} eventos={nombresEventos} onElegirEvento={(id) => poner("evento", id)} />
      </section>

      <section aria-labelledby="coe-detalle" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 id="coe-detalle" className="font-semibold text-[#113349]">Detalle de actividades</h3>
          <span role="status" className="text-sm text-slate-600">
            {numero.format(visibles.length)} {visibles.length === 1 ? "actividad" : "actividades"}
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {visibles.map((f) => (
            <TarjetaActividad key={f.id} actividad={f} catalogos={catalogos} eventos={nombresEventos} tablero />
          ))}
        </div>
        {visibles.length === 0 && <p className={`${tarjeta} text-sm text-slate-600`}>No hay actividades para esta selección.</p>}
      </section>

      <Directorio catalogos={catalogos} puedeEditar={user.role === "ADMIN" || user.role === "REPORTER"} />
    </div>
  );
}

function Resumen({ filas }: { filas: CoeActividad[] }) {
  const cuenta = Object.fromEntries(ORDEN_ESTADOS.map((e) => [e, 0])) as Record<CoeEstado, number>;
  const porIsla = new Map<string, number>();
  for (const f of filas) {
    cuenta[f.estado] += 1;
    const isla = f.isla || "Sin isla indicada";
    porIsla.set(isla, (porIsla.get(isla) ?? 0) + 1);
  }
  const total = filas.length;
  const programadas = total - cuenta.extra;
  let acumulado = 0;
  const porciones = ORDEN_ESTADOS.filter((e) => cuenta[e] > 0).map((e) => {
    const inicio = acumulado;
    acumulado += cuenta[e];
    return `${COLOR_ESTADO[e]} ${(inicio / total) * 100}% ${(acumulado / total) * 100}%`;
  });
  const islas = Array.from(porIsla).sort(([a, n], [b, m]) => m - n || a.localeCompare(b, "es"));

  const indicadores = [
    { titulo: "Actividades", valor: numero.format(total), pie: "En la selección", color: "#113349" },
    { titulo: "Cumplidas", valor: numero.format(cuenta.done), pie: `${numero.format(programadas)} ${programadas === 1 ? "programada" : "programadas"}`, color: COLOR_ESTADO.done },
    { titulo: "Pendientes de reporte", valor: numero.format(cuenta.pending), pie: "Por completar", color: COLOR_ESTADO.pending },
    { titulo: "Cumplimiento", valor: programadas ? porcentaje.format(cuenta.done / programadas) : "—", pie: "Sobre las programadas", color: COLOR_ESTADO.partial },
  ];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de actividades">
        {indicadores.map((k) => (
          <div key={k.titulo} className={tarjeta} style={{ borderTop: `4px solid ${k.color}` }}>
            <p className="text-sm font-medium text-slate-600">{k.titulo}</p>
            <p className="mt-1 text-3xl font-bold" style={{ color: k.color }}>{k.valor}</p>
            <p className="text-xs text-slate-500">{k.pie}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={tarjeta} aria-labelledby="coe-estados">
          <h3 id="coe-estados" className="mb-4 font-semibold text-[#113349]">Estado de las actividades</h3>
          <div className="flex flex-wrap items-center gap-6">
            <div
              aria-hidden="true"
              className="relative grid size-40 shrink-0 place-items-center rounded-full"
              style={{ background: porciones.length ? `conic-gradient(${porciones.join(",")})` : "#e2e8f0" }}
            >
              <div className="grid size-28 place-items-center rounded-full bg-white text-center">
                <div>
                  <strong className="block text-2xl text-[#113349]">{numero.format(total)}</strong>
                  <span className="text-xs text-slate-500">Actividades</span>
                </div>
              </div>
            </div>
            <ul className="min-w-48 flex-1 space-y-2 text-sm">
              {ORDEN_ESTADOS.map((e) => (
                <li key={e} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-3 rounded-full" style={{ backgroundColor: COLOR_ESTADO[e] }} />
                  <span className="flex-1 text-slate-700">{ETIQUETA_TABLERO[e]}</span>
                  <strong className="text-slate-900">{numero.format(cuenta[e])}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className={tarjeta} aria-labelledby="coe-islas">
          <h3 id="coe-islas" className="mb-4 font-semibold text-[#113349]">Actividades por isla</h3>
          {islas.length === 0 ? (
            <p className="text-sm text-slate-500">Sin actividades para estos filtros.</p>
          ) : (
            <ul className="space-y-3">
              {islas.map(([isla, n]) => (
                <li key={isla}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700">{isla}</span>
                    <strong className="text-slate-900">{numero.format(n)}</strong>
                  </div>
                  <div aria-hidden="true" className="mt-1 h-2.5 rounded-full bg-slate-100">
                    <div className="h-2.5 rounded-full bg-[#21566c]" style={{ width: `${(n / islas[0][1]) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Directorio({ catalogos, puedeEditar }: { catalogos: CoeCatalogos; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<CoeDirectorio | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [correo, setCorreo] = useState("");
  const [delegado, setDelegado] = useState({ nombre: "", email: "", institucion: "" });

  useEffect(() => {
    api.get<CoeDirectorio>("/coe-reporte/directorio")
      .then(setDatos)
      .catch((err) => setMensaje(apiErrorMessage(err, "No se pudo cargar el directorio.")));
  }, []);

  async function escribir(accion: () => Promise<CoeDirectorio>, alTerminar?: () => void) {
    setOcupado(true);
    try {
      setDatos(await accion());
      alTerminar?.();
      setMensaje("Cambio guardado.");
    } catch (err) {
      setMensaje(apiErrorMessage(err, "No se pudo guardar el cambio."));
    } finally {
      setOcupado(false);
    }
  }

  if (!datos) return mensaje ? <p className="text-sm text-destructive">{mensaje}</p> : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className={`${tarjeta} space-y-4`} aria-labelledby="coe-destinatarios">
        <h2 id="coe-destinatarios" className="text-lg font-semibold text-[#113349]">Destinatarios de reportes automáticos</h2>
        <p className="text-sm text-slate-600">
          {datos.correoConfigurado
            ? "Se enviará un correo por cada programación o resultado guardado."
            : "El servidor de correo no está configurado: los avisos quedan en espera."}
        </p>
        {puedeEditar && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void escribir(() => api.post<CoeDirectorio>("/coe-reporte/destinatarios", { email: correo }), () => setCorreo(""));
            }}
          >
            <label className={`${etiqueta} min-w-60 flex-1`}>
              Correo electrónico
              <input type="email" required className={control} value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </label>
            <button className={boton} disabled={ocupado}>Agregar destinatario</button>
          </form>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {datos.destinatarios.map((email) => (
            <li key={email} className="flex items-center justify-between gap-2 py-2">
              <span className="break-all">{email}</span>
              {puedeEditar && (
                <button
                  type="button"
                  className={botonSecundario}
                  disabled={ocupado}
                  onClick={() => void escribir(() => api.delete<CoeDirectorio>("/coe-reporte/destinatarios", { body: { email } }))}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
          {datos.destinatarios.length === 0 && <li className="py-2 text-slate-500">Sin destinatarios.</li>}
        </ul>
      </section>

      <section className={`${tarjeta} space-y-4`} aria-labelledby="coe-delegados">
        <h2 id="coe-delegados" className="text-lg font-semibold text-[#113349]">Directorio de delegados</h2>
        <p className="text-sm text-slate-600">
          Delegados de las instituciones. Registrarlos aquí no les da acceso al tablero: los accesos se gestionan en la administración del SIGTAR.
        </p>
        {puedeEditar && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void escribir(
                () => api.post<CoeDirectorio>("/coe-reporte/delegados", delegado),
                () => setDelegado({ nombre: "", email: "", institucion: "" }),
              );
            }}
          >
            <label className={etiqueta}>
              Nombre
              <input required maxLength={150} className={control} value={delegado.nombre} onChange={(e) => setDelegado({ ...delegado, nombre: e.target.value })} />
            </label>
            <label className={etiqueta}>
              Correo electrónico
              <input type="email" required className={control} value={delegado.email} onChange={(e) => setDelegado({ ...delegado, email: e.target.value })} />
            </label>
            <label className={`${etiqueta} sm:col-span-2`}>
              Institución responsable
              <select required className={control} value={delegado.institucion} onChange={(e) => setDelegado({ ...delegado, institucion: e.target.value })}>
                <option value="">Seleccione</option>
                {catalogos.instituciones.map((g) => (
                  <optgroup key={g.grupo} label={g.grupo}>
                    {g.nombres.map((n) => <option key={n}>{n}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <button className={boton} disabled={ocupado}>Registrar delegado</button>
            </div>
          </form>
        )}
        <ul className="divide-y divide-slate-100 text-sm">
          {datos.delegados.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-slate-700">{d.nombre} · {d.email} · {d.institucion}</span>
              {puedeEditar && (
                <button
                  type="button"
                  className={botonSecundario}
                  disabled={ocupado}
                  onClick={() => void escribir(() => api.delete<CoeDirectorio>(`/coe-reporte/delegados/${d.id}`))}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
          {datos.delegados.length === 0 && <li className="py-2 text-slate-500">Sin delegados registrados.</li>}
        </ul>
      </section>
      {mensaje && <p role="status" className="text-sm text-teal-800 lg:col-span-2">{mensaje}</p>}
    </div>
  );
}
