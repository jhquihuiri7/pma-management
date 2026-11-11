"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  camposDe,
  clean,
  conMayuscula,
  forms,
  limpiarRecursos,
  MAX_RECURSOS,
  routes,
  type CampoLimpieza,
  type OperacionLimpieza,
  type RegistroLimpieza,
} from "@pma/types/protocolo-limpieza";
import { ApiError, apiErrorMessage } from "@/lib/api-client";
import { crearRegistro, editarRegistro, subirFoto, urlFoto } from "@/lib/protocolo-limpieza/api";
import { toJpeg } from "@/lib/protocolo-limpieza/foto";
import { claveBarrio } from "@/lib/protocolo-limpieza/barrios";
import {
  currentDate,
  executors,
  operationsOf,
  ordenarCampos,
  prellenado,
  sugerenciasRecurso,
  suggestedFields,
  suggestions,
} from "@/lib/protocolo-limpieza/tablero";
import { RouteIcon } from "./RutaIcono";

interface Props {
  abierto: boolean;
  /** Grows on every opening: the form starts over each time. */
  apertura: number;
  row: RegistroLimpieza | null;
  kind: OperacionLimpieza;
  records: RegistroLimpieza[];
  /** The neighbourhoods to choose from (the Geoportal's layer, or the protocol's list). */
  nombresBarrios: string[];
  onClose(): void;
  /** Reads the reports again: after a save, and after a conflict so that reopening shows the current version. */
  onRefresh(): Promise<void>;
  onSavingChange(saving: boolean): void;
}

/** Report form of the standalone app (dialog #entry), one per opening. */
export default function DialogoReporte(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.abierto && !dialog.open) dialog.showModal();
    if (!props.abierto && dialog.open) dialog.close();
  }, [props.abierto]);

  const { onClose, onSavingChange } = props;
  return (
    <dialog
      id="entry"
      ref={dialogRef}
      onCancel={(event) => { if (saving.current) event.preventDefault(); }}
      onClose={onClose}
    >
      {props.abierto && (
        <FormularioReporte
          key={props.apertura}
          {...props}
          onSavingChange={(value) => { saving.current = value; onSavingChange(value); }}
        />
      )}
    </dialog>
  );
}

interface EstadoFoto { texto: string; error: boolean }

/** A resource row as typed; empty rows are dropped when saving. */
interface FilaRecurso { clave: number; cantidad: string; recurso: string; institucion: string }

let siguienteFila = 0;
const filaRecurso = (r?: { cantidad: number; recurso: string; institucion: string }): FilaRecurso => ({
  clave: ++siguienteFila,
  cantidad: r ? String(r.cantidad) : "",
  recurso: conMayuscula(r?.recurso ?? ""),
  institucion: r?.institucion ?? "",
});
const filaVacia = (f: FilaRecurso) => !f.cantidad.trim() && !f.recurso.trim() && !f.institucion.trim();

const fotosDe = (row: RegistroLimpieza | null): Record<string, string> =>
  Object.fromEntries(
    row ? camposDe(row.kind).filter((f) => f.type === "photo" && row.data[f.id] !== undefined).map((f) => [f.id, String(row.data[f.id])]) : [],
  );

function FormularioReporte({ row, kind: kindInicial, records, nombresBarrios, onClose, onRefresh, onSavingChange }: Props) {
  const editando = !!row;
  const inicial = row?.kind ?? kindInicial;
  const [today] = useState(() => currentDate());
  const [executor, setExecutor] = useState(() => routes[forms[inicial].route][1]);
  const [kind, setKind] = useState<OperacionLimpieza>(inicial);
  // Changing the operation draws its fields again, as the standalone app did.
  const [version, setVersion] = useState(0);
  // A new report starts from the latest one of its operation (tablero.ts → prellenado);
  // editing shows the report itself.
  const [prefill, setPrefill] = useState(() => (row ? null : prellenado(records, inicial, today)));
  const base = row?.data ?? prefill?.data;
  const [barrio, setBarrio] = useState(() => String(base?.barrio ?? ""));
  // Without earlier resources, one empty row, so the section asks to be filled.
  const [recursos, setRecursos] = useState<FilaRecurso[]>(() => {
    const previos = row ? row.recursos : prefill?.recursos;
    return previos?.length ? previos.map((r) => filaRecurso(r)) : [filaRecurso()];
  });
  const [fotos, setFotos] = useState<Record<string, string>>(() => fotosDe(row));
  const [estadoFotos, setEstadoFotos] = useState<Record<string, EstadoFoto>>({});
  const [subiendo, setSubiendo] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const formulario = forms[kind];
  const [trayecto] = routes[formulario.route];
  const valores = (editando ? (version === 0 ? row?.data : undefined) : prefill?.data) ?? {};
  const campos = ordenarCampos(camposDe(kind));

  const empezarDeNuevo = (siguiente: OperacionLimpieza) => {
    const previo = editando ? null : prellenado(records, siguiente, today);
    setKind(siguiente);
    setPrefill(previo);
    setError("");
    setBarrio(String(previo?.data.barrio ?? ""));
    // The resources are those of that operation's latest report, or none.
    setRecursos(previo?.recursos.length ? previo.recursos.map((r) => filaRecurso(r)) : [filaRecurso()]);
    setFotos({});
    setEstadoFotos({});
    setVersion((n) => n + 1);
  };

  const cerrar = () => { if (!guardando) onClose(); };

  async function subir(campo: CampoLimpieza, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setSubiendo((n) => n + 1);
    setEstadoFotos((s) => ({ ...s, [campo.id]: { texto: "Subiendo fotografía…", error: false } }));
    try {
      const { id } = await subirFoto(await toJpeg(file));
      setFotos((s) => ({ ...s, [campo.id]: id }));
      setEstadoFotos((s) => ({ ...s, [campo.id]: { texto: "Fotografía adjunta.", error: false } }));
    } catch (err) {
      setEstadoFotos((s) => ({ ...s, [campo.id]: { texto: apiErrorMessage(err, "No se pudo subir la fotografía."), error: true } }));
    } finally {
      setSubiendo((n) => n - 1);
      input.value = "";
    }
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardando) return;
    if (subiendo) { setError("Espera a que termine de subir la fotografía."); return; }
    const enviado = Object.fromEntries(new FormData(event.currentTarget));
    setGuardando(true);
    onSavingChange(true);
    setError("");
    try {
      const data = clean(kind, enviado);
      const lista = limpiarRecursos(
        recursos.filter((f) => !filaVacia(f)).map(({ cantidad, recurso, institucion }) => ({ cantidad, recurso, institucion })),
      );
      if (row) await editarRegistro(row.id, { version: row.version, kind, data, recursos: lista });
      else await crearRegistro({ kind, data, recursos: lista });
      onClose();
      await onRefresh();
      toast.success("Reporte guardado.");
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo guardar el reporte."));
      // Someone saved first (or the same movement exists): read again, so the form reopens on what is there now.
      if (err instanceof ApiError && err.status === 409) void onRefresh();
    } finally {
      setGuardando(false);
      onSavingChange(false);
    }
  }

  const control = (p: CampoLimpieza) => {
    const v = valores[p.id] ?? (p.id === "fecha" ? today : "");
    const etiqueta = `${p.label}${p.required ? " *" : ""}`;
    if (p.type === "photo") {
      const id = fotos[p.id] ?? "";
      const estado = estadoFotos[p.id];
      return (
        <div key={p.id} className="photo-field">
          <span>{etiqueta}</span>
          <input type="hidden" name={p.id} value={id} />
          <label className="photo-pick">
            <input type="file" accept="image/*" capture="environment" onChange={(e) => void subir(p, e.currentTarget)} />
            <span className="photo-preview">{id ? <Image src={urlFoto(id)} alt="" width={72} height={72} unoptimized /> : null}</span>
            <span className="photo-action"><Camera className="ico" />{id ? "Cambiar fotografía" : "Tomar o elegir fotografía"}</span>
          </label>
          <small className={`photo-status${estado?.error ? " is-error" : ""}`} aria-live="polite">{estado?.texto ?? ""}</small>
        </div>
      );
    }
    if (p.id === "barrio") {
      // Chosen from the list. A saved report keeps its value even when spelt otherwise.
      const elegido = nombresBarrios.find((n) => claveBarrio(n) === claveBarrio(barrio)) ?? barrio;
      const opciones = elegido && !nombresBarrios.includes(elegido) ? [elegido, ...nombresBarrios] : nombresBarrios;
      return (
        <label key={p.id}>
          {etiqueta}
          <select name={p.id} required={p.required} value={elegido} onChange={(e) => setBarrio(e.target.value)}>
            <option value="">Selecciona el barrio…</option>
            {opciones.map((nombre) => <option key={nombre} value={nombre}>{nombre}</option>)}
          </select>
        </label>
      );
    }
    if (p.type === "select") {
      // An older report may hold a value the list no longer offers: the select starts empty then.
      const opciones = p.options ?? [];
      return (
        <label key={p.id}>
          {etiqueta}
          <select name={p.id} required={p.required} defaultValue={opciones.includes(String(v)) ? String(v) : ""}>
            <option value="">Selecciona…</option>
            {opciones.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      );
    }
    const lista = (suggestedFields as readonly string[]).includes(p.id) ? `known-${p.id}` : undefined;
    const extra = p.type !== "number" ? { maxLength: 500 } : p.integer ? { step: 1, min: 0, inputMode: "numeric" as const } : { step: "any" };
    return (
      <label key={p.id}>
        {etiqueta}
        <input name={p.id} type={p.type} defaultValue={String(v)} required={p.required} list={lista} {...extra} />
      </label>
    );
  };

  return (
    <form id="form" onSubmit={guardar}>
      <header className="dialog-head">
        <div>
          <p className="dialog-eyebrow">Reporte operativo</p>
          <h2 id="form-title">{editando ? "Editar reporte" : "Nuevo reporte"}</h2>
        </div>
        <button type="button" className="button secondary" id="close" aria-label="Cerrar" onClick={cerrar}>✕</button>
      </header>
      <div className="form-picker">
        <label>
          Ejecutor
          <select
            id="executor"
            value={executor}
            disabled={editando}
            onChange={(e) => { setExecutor(e.target.value); empezarDeNuevo(operationsOf(e.target.value)[0]); }}
          >
            {executors.map((nombre) => <option key={nombre} value={nombre}>{nombre}</option>)}
          </select>
        </label>
        <label>
          Operación
          <select id="kind" name="kind" value={kind} disabled={editando} onChange={(e) => empezarDeNuevo(e.target.value as OperacionLimpieza)}>
            {operationsOf(executor).map((k) => <option key={k} value={k}>{forms[k].route} · {forms[k].name}</option>)}
          </select>
        </label>
      </div>
      <div id="route-info" className="route-info">
        <RouteIcon route={formulario.route} size={44} />
        <div>
          <p><strong>{formulario.route} · {trayecto}</strong></p>
          <p className="small">{formulario.hint}</p>
        </div>
      </div>
      <div id="fields" className="fields" key={`principal-${kind}-${version}`}>{campos.map(control)}</div>
      <fieldset className="recursos-form">
        <legend>Recursos disponibles</legend>
        <p className="small">Personal, vehículos o maquinaria de esta operación y la institución de cada uno. El tablero muestra los del último reporte de cada ruta.</p>
        {recursos.map((f, i) => {
          const cambiarFila = (campo: "cantidad" | "recurso" | "institucion", valor: string) =>
            setRecursos((filas) => filas.map((x) => (x.clave === f.clave ? { ...x, [campo]: valor } : x)));
          return (
            <div key={f.clave} className="recurso-fila">
              <label>Cantidad<input type="number" min={1} step={1} inputMode="numeric" value={f.cantidad} onChange={(e) => cambiarFila("cantidad", e.target.value)} /></label>
              <label>Recurso<input list="known-recurso" maxLength={100} placeholder="personas, vehículos…" value={f.recurso} onChange={(e) => cambiarFila("recurso", e.target.value)} /></label>
              <label>Institución<input list="known-institucion" maxLength={200} value={f.institucion} onChange={(e) => cambiarFila("institucion", e.target.value)} /></label>
              <button type="button" className="button secondary recurso-quitar" aria-label={`Quitar el recurso ${i + 1}`} onClick={() => setRecursos((filas) => filas.filter((x) => x.clave !== f.clave))}>
                <X className="ico" />
              </button>
            </div>
          );
        })}
        <button type="button" className="button secondary recurso-agregar" disabled={recursos.length >= MAX_RECURSOS} onClick={() => setRecursos((filas) => [...filas, filaRecurso()])}>
          <Plus className="ico" />Agregar recurso
        </button>
      </fieldset>
      <p id="error" className="error" role="alert">{error}</p>
      <footer className="dialog-actions">
        <button className="button secondary" type="button" id="cancel" onClick={cerrar}>Cancelar</button>
        <button className="button primary" id="save" disabled={guardando || subiendo > 0}>Guardar reporte</button>
      </footer>
      {suggestedFields.map((key) => (
        <datalist key={key} id={`known-${key}`}>
          {suggestions(records, key).map((valor) => <option key={valor} value={valor} />)}
        </datalist>
      ))}
      {(["recurso", "institucion"] as const).map((campo) => (
        <datalist key={campo} id={`known-${campo}`}>
          {sugerenciasRecurso(records, campo).map((valor) => <option key={valor} value={valor} />)}
        </datalist>
      ))}
    </form>
  );
}
