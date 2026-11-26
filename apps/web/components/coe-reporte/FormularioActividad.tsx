"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api-client";
import { coeApi, nuevoId } from "@/lib/coeReporte";
import type { CoeActividad, CoeCatalogos, CoeEvento, CoeInstancia, CoeMetrica } from "@/types";
import CamposResultado, { leerResultado, resultadoVacio } from "./CamposResultado";
import { EditorMetricas, boton, botonSecundario, control, etiqueta, metricasCompletas, tarjeta } from "./estilos";

const OTRA = "__otra__";

/**
 * Programmed activity (08h00 cut) or, with `extra`, an unprogrammed one that
 * is saved already with its result. The record id is created when the form
 * opens, so a retried save lands on the same activity.
 */
export default function FormularioActividad({
  catalogos,
  eventos,
  codigo,
  extra,
  eventoInicial,
  diaInicial,
  onEventoCreado,
  onGuardada,
  onCancelar,
  avisar,
}: {
  catalogos: CoeCatalogos;
  eventos: CoeEvento[];
  codigo: string;
  extra: boolean;
  eventoInicial: string;
  diaInicial: string;
  onEventoCreado: (evento: CoeEvento) => void;
  onGuardada: (actividad: CoeActividad) => void;
  onCancelar?: () => void;
  avisar: (mensaje: string) => void;
}) {
  const [id] = useState(nuevoId);
  const [evento, setEvento] = useState(eventoInicial);
  const [dia, setDia] = useState(diaInicial);
  const [isla, setIsla] = useState("");
  const [islaOtra, setIslaOtra] = useState("");
  const [sector, setSector] = useState("");
  const [institucion, setInstitucion] = useState("");
  const [institucionOtra, setInstitucionOtra] = useState("");
  const [instancia, setInstancia] = useState<"" | CoeInstancia>("");
  const [equipo, setEquipo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [metas, setMetas] = useState<CoeMetrica[]>([]);
  const [resultado, setResultado] = useState(resultadoVacio());
  const [guardando, setGuardando] = useState(false);

  const [creandoEvento, setCreandoEvento] = useState(false);
  const [tituloEvento, setTituloEvento] = useState("");
  const [guardandoEvento, setGuardandoEvento] = useState(false);

  const equipos = instancia === "MTT" || instancia === "GT" ? catalogos.equipos[instancia] : [];

  async function crearEvento(e: React.FormEvent) {
    e.preventDefault();
    const titulo = tituloEvento.trim();
    if (!titulo) return;
    setGuardandoEvento(true);
    try {
      const nuevo = await coeApi.crearEvento(titulo, codigo);
      onEventoCreado(nuevo);
      setEvento(nuevo.id);
      setCreandoEvento(false);
      setTituloEvento("");
      avisar(`Evento seleccionado: ${nuevo.id}.`);
    } catch (err) {
      avisar(apiErrorMessage(err, "No se pudo crear el evento."));
    } finally {
      setGuardandoEvento(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const islaFinal = isla === OTRA ? islaOtra.trim() : isla;
    const institucionFinal = institucion === OTRA ? institucionOtra.trim() : institucion;
    if (!evento || !islaFinal || !institucionFinal || !sector.trim() || !descripcion.trim() || !instancia) {
      avisar("Completa los campos obligatorios.");
      return;
    }
    let extraDatos = {};
    if (extra) {
      const leido = leerResultado(resultado, [], true);
      if (typeof leido === "string") {
        avisar(leido);
        return;
      }
      extraDatos = { resultado: leido.resultado, numeros: leido.numeros };
    }
    setGuardando(true);
    try {
      const guardada = await coeApi.guardarActividad(
        {
          id,
          evento,
          dia,
          isla: islaFinal,
          sector: sector.trim(),
          institucion: institucionFinal,
          instancia,
          equipo: instancia === "Directa" ? "" : equipo,
          descripcion: descripcion.trim(),
          metas: metricasCompletas(metas),
          estado: extra ? "extra" : "pending",
          ...extraDatos,
        },
        codigo,
      );
      onGuardada(guardada);
    } catch (err) {
      avisar(apiErrorMessage(err, "No se pudo guardar la actividad."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className={tarjeta}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#113349]">
          {extra ? "Registrar actividad no programada" : "Registrar actividad programada"}
        </h2>
        {!creandoEvento && (
          <button type="button" className={botonSecundario} onClick={() => setCreandoEvento(true)}>
            Crear evento
          </button>
        )}
      </div>

      {creandoEvento && (
        <form onSubmit={crearEvento} className="mb-5 space-y-3 rounded-lg border border-teal-200 bg-teal-50/50 p-4">
          <label className={etiqueta}>
            Nombre del nuevo evento
            <input className={control} required maxLength={150} value={tituloEvento} onChange={(e) => setTituloEvento(e.target.value)} autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={boton} disabled={guardandoEvento}>Crear y asignar código</button>
            <button type="button" className={botonSecundario} onClick={() => { setCreandoEvento(false); setTituloEvento(""); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <form onSubmit={guardar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={`${etiqueta} sm:col-span-2`}>
            Evento
            <select className={control} required value={evento} onChange={(e) => setEvento(e.target.value)}>
              <option value="">Seleccione un evento</option>
              {eventos.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.id} · {ev.titulo}</option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            Fecha
            <input className={control} type="date" required value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
          <label className={etiqueta}>
            Isla
            <select className={control} required value={isla} onChange={(e) => setIsla(e.target.value)}>
              <option value="">Seleccione</option>
              {catalogos.islas.map((i) => <option key={i}>{i}</option>)}
              <option value={OTRA}>Otra isla</option>
            </select>
          </label>
          {isla === OTRA && (
            <label className={etiqueta}>
              Nombre de la isla
              <input className={control} required maxLength={90} value={islaOtra} onChange={(e) => setIslaOtra(e.target.value)} />
            </label>
          )}
          <label className={etiqueta}>
            Sector
            <input className={control} required maxLength={120} placeholder="Ej. Bellavista" value={sector} onChange={(e) => setSector(e.target.value)} />
          </label>
          <label className={`${etiqueta} sm:col-span-2`}>
            Institución responsable
            <select className={control} required value={institucion} onChange={(e) => setInstitucion(e.target.value)}>
              <option value="">Seleccione</option>
              {catalogos.instituciones.map((g) => (
                <optgroup key={g.grupo} label={g.grupo}>
                  {g.nombres.map((n) => <option key={n}>{n}</option>)}
                </optgroup>
              ))}
              <option value={OTRA}>OTRO</option>
            </select>
          </label>
          {institucion === OTRA && (
            <label className={`${etiqueta} sm:col-span-2`}>
              Nombre de la institución
              <input className={control} required maxLength={150} value={institucionOtra} onChange={(e) => setInstitucionOtra(e.target.value)} />
            </label>
          )}
          <label className={etiqueta}>
            Instancia de coordinación
            <select
              className={control}
              required
              value={instancia}
              onChange={(e) => { setInstancia(e.target.value as "" | CoeInstancia); setEquipo(""); }}
            >
              <option value="">Seleccione</option>
              <option value="MTT">Mesa Técnica de Trabajo</option>
              <option value="GT">Grupo de Trabajo</option>
              <option value="Directa">Acción institucional directa</option>
            </select>
          </label>
          {equipos.length > 0 && (
            <label className={`${etiqueta} sm:col-span-2`}>
              Mesa o grupo
              <select className={control} required value={equipo} onChange={(e) => setEquipo(e.target.value)}>
                <option value="">Seleccione</option>
                {equipos.map((nombre, i) => (
                  <option key={nombre} value={`${instancia} ${i + 1}`}>{instancia} {i + 1} · {nombre}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className={etiqueta}>
          Descripción de la actividad
          <textarea className={`${control} min-h-24`} required maxLength={2500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </label>
        {!extra && (
          <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-700">Metas (opcional)</legend>
            <p className="text-xs text-muted-foreground">Al registrar el resultado se pedirá la cantidad alcanzada de cada meta.</p>
            <EditorMetricas valor={metas} onChange={setMetas} textoAgregar="Agregar meta" />
          </fieldset>
        )}
        {extra && <CamposResultado valor={resultado} onChange={setResultado} metas={[]} esExtra />}
        <div className="flex flex-wrap gap-2">
          <button className={boton} disabled={guardando}>{extra ? "Guardar resultado" : "Guardar programación"}</button>
          {onCancelar && (
            <button type="button" className={botonSecundario} onClick={onCancelar}>Cancelar</button>
          )}
        </div>
      </form>
    </section>
  );
}
