"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiErrorMessage } from "@/lib/api-client";
import {
  PATRON_CODIGO,
  codigoHistorial,
  coeApi,
  hoyGalapagos,
  ordenarActividades,
  useCoeCatalogos,
  usarCodigoHistorial,
} from "@/lib/coeReporte";
import type { CoeActividad, CoeEvento } from "@/types";
import FormularioActividad from "./FormularioActividad";
import TarjetaActividad from "./TarjetaActividad";
import { ClipboardList, History } from "lucide-react";
import { Contenido, Encabezado, aviso, boton, botonSecundario, control, etiqueta, tarjeta, tituloTarjeta } from "./estilos";

type Pestana = "plan" | "resultados";

/** Public report: programming (08h00), results (19h00) and the history code. */
export default function ReporteVista() {
  const { catalogos, error } = useCoeCatalogos();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [eventos, setEventos] = useState<CoeEvento[]>([]);
  const [mias, setMias] = useState<CoeActividad[]>([]);
  const [pestana, setPestana] = useState<Pestana>("plan");
  const [nota, setNota] = useState("");
  const [hoy] = useState(hoyGalapagos);
  const [filtroDia, setFiltroDia] = useState(hoy);
  const [filtroEvento, setFiltroEvento] = useState("");
  const [formulario, setFormulario] = useState({ clave: 0, evento: "" });
  const [extra, setExtra] = useState<{ clave: number; evento: string } | null>(null);
  const [historial, setHistorial] = useState(false);

  useEffect(() => setCodigo(codigoHistorial()), []);

  const nombresEventos = useMemo(() => new Map(eventos.map((e) => [e.id, e.titulo])), [eventos]);

  const cargarEventos = useCallback(async () => {
    try {
      setEventos(await coeApi.eventos());
    } catch (err) {
      setNota(apiErrorMessage(err, "No se pudieron cargar los eventos."));
    }
  }, []);

  const cargarMias = useCallback(async (clave: string) => {
    try {
      const items = await coeApi.misActividades(clave);
      if (clave === codigoHistorial()) setMias(ordenarActividades(items));
    } catch (err) {
      setNota(apiErrorMessage(err, "No se pudo cargar tu historial."));
    }
  }, []);

  useEffect(() => {
    void cargarEventos();
  }, [cargarEventos]);

  useEffect(() => {
    if (codigo && pestana === "resultados") void cargarMias(codigo);
  }, [codigo, pestana, cargarMias]);

  const guardarLocal = (actividad: CoeActividad) =>
    setMias((actuales) => ordenarActividades([...actuales.filter((a) => a.id !== actividad.id), actividad]));

  const eventoCreado = (evento: CoeEvento) =>
    setEventos((actuales) => (actuales.some((e) => e.id === evento.id) ? actuales : [evento, ...actuales]));

  const visibles = mias.filter((a) => (!filtroDia || a.dia === filtroDia) && (!filtroEvento || a.evento === filtroEvento));

  const encabezado = (
    <Encabezado
      icono={ClipboardList}
      titulo="Reporte territorial diario"
      descripcion="Registra a las 08h00 las actividades programadas de tu institución y a las 19h00 sus resultados. No necesitas cuenta."
    />
  );
  if (error || !catalogos || !codigo) {
    return (
      <>
        {encabezado}
        <Contenido>
          <div className={`${tarjeta} text-sm ${error ? "text-red-600" : "text-slate-500"}`}>{error ?? "Cargando…"}</div>
        </Contenido>
      </>
    );
  }

  return (
    <>
      {encabezado}
      <Contenido>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Cortes del reporte" className="flex w-full rounded-xl border border-slate-100 bg-white p-1 shadow-sm sm:inline-flex sm:w-auto">
          {([["plan", "08h00 · Programación"], ["resultados", "19h00 · Resultados"]] as const).map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              aria-pressed={pestana === clave}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:flex-none sm:px-4 ${
                pestana === clave ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
              onClick={() => { setPestana(clave); setNota(""); setExtra(null); }}
            >
              {texto}
            </button>
          ))}
        </nav>
        <button type="button" className={`${botonSecundario} shadow-sm`} onClick={() => setHistorial(true)}>
          <History className="h-4 w-4" /> Mi historial
        </button>
      </div>

      <p role="status" aria-live="polite" className={nota ? aviso : "sr-only"}>
        {nota}
      </p>

      {pestana === "plan" && (
        <FormularioActividad
          key={formulario.clave}
          catalogos={catalogos}
          eventos={eventos}
          codigo={codigo}
          extra={false}
          eventoInicial={formulario.evento}
          diaInicial={hoy}
          onEventoCreado={eventoCreado}
          onGuardada={(actividad) => {
            guardarLocal(actividad);
            setFiltroDia(actividad.dia);
            setFiltroEvento(actividad.evento);
            setFormulario((f) => ({ clave: f.clave + 1, evento: actividad.evento }));
            setNota("Programación guardada. Podrás completarla en Resultados.");
          }}
          avisar={setNota}
        />
      )}

      {pestana === "resultados" && (
        <div className="space-y-4">
          <section className={tarjeta}>
            <h2 className={`${tituloTarjeta} mb-4`}>Resultados del día</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={etiqueta}>
                Fecha
                <input className={control} type="date" value={filtroDia} onChange={(e) => setFiltroDia(e.target.value)} />
              </label>
              <label className={etiqueta}>
                Evento
                <select className={control} value={filtroEvento} onChange={(e) => setFiltroEvento(e.target.value)}>
                  <option value="">Todos los eventos</option>
                  {eventos.map((ev) => <option key={ev.id} value={ev.id}>{ev.id} · {ev.titulo}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={boton} onClick={() => setExtra({ clave: Date.now(), evento: filtroEvento })}>
                Agregar actividad no programada
              </button>
              <button type="button" className={botonSecundario} onClick={() => { setFiltroDia(""); setFiltroEvento(""); }}>
                Ver todas mis actividades
              </button>
            </div>
          </section>

          {extra && (
            <FormularioActividad
              key={extra.clave}
              catalogos={catalogos}
              eventos={eventos}
              codigo={codigo}
              extra
              eventoInicial={extra.evento}
              diaInicial={filtroDia || hoy}
              onEventoCreado={eventoCreado}
              onGuardada={(actividad) => {
                guardarLocal(actividad);
                setFiltroDia(actividad.dia);
                setFiltroEvento(actividad.evento);
                setExtra(null);
                setNota("Actividad no programada guardada.");
              }}
              onCancelar={() => setExtra(null)}
              avisar={setNota}
            />
          )}

          <div className="space-y-3">
            {visibles.map((actividad) => (
              <TarjetaActividad
                key={actividad.id}
                actividad={actividad}
                catalogos={catalogos}
                eventos={nombresEventos}
                codigo={codigo}
                onActualizada={guardarLocal}
                avisar={setNota}
              />
            ))}
            {visibles.length === 0 && <p className={`${tarjeta} py-8 text-center text-sm text-slate-500`}>No hay actividades para esta selección.</p>}
          </div>
        </div>
      )}

      {historial && (
        <DialogoHistorial
          codigo={codigo}
          onCerrar={() => setHistorial(false)}
          onRecuperado={(nuevo, items) => {
            usarCodigoHistorial(nuevo);
            setCodigo(nuevo);
            setMias(ordenarActividades(items));
            setHistorial(false);
            setFiltroDia("");
            setFiltroEvento("");
            setPestana("resultados");
            setNota("Historial recuperado.");
          }}
        />
      )}
      </Contenido>
    </>
  );
}

function DialogoHistorial({
  codigo,
  onCerrar,
  onRecuperado,
}: {
  codigo: string;
  onCerrar: () => void;
  onRecuperado: (codigo: string, items: CoeActividad[]) => void;
}) {
  const [mensaje, setMensaje] = useState("");
  const [otro, setOtro] = useState("");
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const cerrar = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [onCerrar]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setMensaje("Código copiado.");
    } catch {
      (document.getElementById("coe-codigo-actual") as HTMLInputElement | null)?.select();
      setMensaje("Copia el código seleccionado.");
    }
  }

  async function recuperar(e: React.FormEvent) {
    e.preventDefault();
    const clave = otro.trim();
    if (!PATRON_CODIGO.test(clave)) {
      setMensaje("Revisa el código de historial.");
      return;
    }
    setBuscando(true);
    try {
      const items = await coeApi.misActividades(clave);
      if (!items.length) {
        setMensaje("No se encontraron actividades con ese código.");
        return;
      }
      onRecuperado(clave, items);
    } catch (err) {
      setMensaje(apiErrorMessage(err, "No se pudo recuperar el historial."));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coe-historial-titulo"
        className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-100 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="coe-historial-titulo" className="text-lg font-semibold text-slate-900">Mi historial</h2>
        <p className="text-sm text-slate-600">
          Guarda este código en privado. Te permite recuperar tus actividades si cambias de navegador o dispositivo.
        </p>
        <label className={etiqueta}>
          Tu código de historial
          <input id="coe-codigo-actual" className={`${control} font-mono`} readOnly value={codigo} autoComplete="off" />
        </label>
        <button type="button" className={botonSecundario} onClick={copiar}>Copiar código</button>
        <form onSubmit={recuperar} className="space-y-3 border-t border-slate-100 pt-4">
          <label className={etiqueta}>
            Recuperar historial con un código
            <input
              className={`${control} font-mono`}
              required
              maxLength={43}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={otro}
              onChange={(e) => setOtro(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={boton} disabled={buscando}>Recuperar historial</button>
            <button type="button" className={botonSecundario} onClick={onCerrar}>Cerrar</button>
          </div>
        </form>
        <p role="status" className="text-sm text-teal-800">{mensaje}</p>
      </div>
    </div>
  );
}
