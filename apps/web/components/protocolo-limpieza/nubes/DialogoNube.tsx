"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { limpiarDatosNube, MAX_DESCRIPCION_NUBE, MAX_SITIO_NUBE, type CabeceraLas, type NubePuntos } from "@pma/types/protocolo-limpieza";
import { ApiError, apiErrorMessage } from "@/lib/api-client";
import { editarNube, formatoBytes, formatoPuntos, revisarArchivoNube, subirNube, type ProgresoSubida } from "@/lib/protocolo-limpieza/nubes";
import { currentDate } from "@/lib/protocolo-limpieza/tablero";

interface Props {
  abierto: boolean;
  /** Grows on every opening: the form starts over each time. */
  apertura: number;
  /** null: a new cloud; otherwise its data are edited (the file stays). */
  nube: NubePuntos | null;
  /** The site the timeline shows, offered for a new cloud. */
  sitioSugerido: string;
  sitios: string[];
  onClose(): void;
  /** After a save: the cloud to show, and the list read again. */
  onGuardada(nube: NubePuntos): void;
  onRefresh(): Promise<void>;
}

/** Upload of a point cloud with its data, or the edition of its data. */
export default function DialogoNube(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ocupado = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (props.abierto && !dialog.open) dialog.showModal();
    if (!props.abierto && dialog.open) dialog.close();
  }, [props.abierto]);
  return (
    <dialog id="nube-dialogo" ref={dialogRef} onCancel={(e) => { if (ocupado.current) e.preventDefault(); }} onClose={props.onClose}>
      {props.abierto && <FormularioNube key={props.apertura} {...props} onOcupado={(v) => { ocupado.current = v; }} />}
    </dialog>
  );
}

function FormularioNube({ nube, sitioSugerido, sitios, onClose, onGuardada, onRefresh, onOcupado }: Props & { onOcupado(v: boolean): void }) {
  const editando = !!nube;
  const [hoy] = useState(() => currentDate());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cabecera, setCabecera] = useState<CabeceraLas | null>(null);
  const [revision, setRevision] = useState("");
  const [progreso, setProgreso] = useState<ProgresoSubida | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const cancelar = useRef<AbortController | null>(null);

  useEffect(() => () => cancelar.current?.abort(), []);

  async function elegir(input: HTMLInputElement) {
    const f = input.files?.[0] ?? null;
    setArchivo(null);
    setCabecera(null);
    setRevision("");
    setError("");
    if (!f) return;
    try {
      setCabecera(await revisarArchivoNube(f));
      setArchivo(f);
    } catch (err) {
      input.value = "";
      setRevision((err as Error).message);
    }
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardando) return;
    const valores = Object.fromEntries(new FormData(event.currentTarget));
    let datos;
    try {
      datos = limpiarDatosNube(valores, hoy);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (!editando && !archivo) {
      setError("Elige el archivo .las o .laz de la nube de puntos.");
      return;
    }
    setGuardando(true);
    onOcupado(true);
    setError("");
    try {
      let guardada: NubePuntos;
      if (nube) {
        guardada = await editarNube(nube.id, nube.version, datos);
        toast.success("Datos de la nube guardados.");
      } else {
        cancelar.current = new AbortController();
        setProgreso({ enviados: 0, total: archivo!.size });
        guardada = await subirNube(datos, archivo!, setProgreso, cancelar.current.signal);
        toast.success("Nube cargada. Se está preparando para el visor; tarda unos minutos.");
      }
      onOcupado(false);
      onGuardada(guardada);
      onClose();
      void onRefresh();
    } catch (err) {
      if ((err as Error).name === "AbortError") setError("Subida cancelada.");
      else setError(apiErrorMessage(err, "No se pudo guardar la nube de puntos."));
      if (err instanceof ApiError && err.status === 409) void onRefresh();
      setProgreso(null);
      setGuardando(false);
      onOcupado(false);
    }
  }

  const pct = progreso && progreso.total ? Math.min(100, (progreso.enviados / progreso.total) * 100) : 0;
  return (
    <form onSubmit={guardar}>
      <header className="dialog-head">
        <div>
          <p className="dialog-eyebrow">Visualización 3D</p>
          <h2>{editando ? "Editar datos de la nube" : "Cargar nube de puntos"}</h2>
        </div>
        <button type="button" className="button secondary" aria-label="Cerrar" disabled={guardando} onClick={onClose}><X className="ico" /></button>
      </header>
      <div className="fields nubes-campos">
        <label>
          Sitio *
          <input name="sitio" required maxLength={MAX_SITIO_NUBE} list="nubes-sitios" defaultValue={nube?.sitio ?? sitioSugerido} placeholder="Acopio temporal – Puerto Ayora" />
        </label>
        <label>
          Fecha del levantamiento *
          <input name="fecha" type="date" required max={hoy} defaultValue={nube?.fecha ?? hoy} />
        </label>
        <label className="nubes-campo-ancho">
          Descripción
          <textarea name="descripcion" rows={2} maxLength={MAX_DESCRIPCION_NUBE} defaultValue={nube?.descripcion ?? ""} placeholder="Vuelo, equipo o notas del levantamiento" />
        </label>
        {!editando && (
          <div className="nubes-campo-ancho nubes-archivo">
            <span>Archivo de la nube (.las o .laz) *</span>
            <label className="nubes-elegir">
              <input type="file" accept=".las,.laz" disabled={guardando} onChange={(e) => void elegir(e.currentTarget)} />
              <FileUp className="ico" />
              <span>{archivo ? archivo.name : "Elegir archivo…"}</span>
            </label>
            {cabecera && archivo && (
              <small className="nubes-revision">
                LAS {cabecera.version}{cabecera.comprimido ? " comprimido (LAZ)" : ""} · {formatoPuntos(cabecera.puntos)} · {formatoBytes(archivo.size)}
              </small>
            )}
            {revision && <small className="nubes-revision is-error" role="alert">{revision}</small>}
          </div>
        )}
      </div>
      {progreso && (
        <div className="nubes-subida" role="status" aria-live="polite">
          <div className="nubes-subida-barra"><i style={{ width: `${pct}%` }} /></div>
          <span>
            {pct < 100 ? `Subiendo… ${Math.floor(pct)} % (${formatoBytes(progreso.enviados)} de ${formatoBytes(progreso.total)})` : "Comprobando el archivo en el servidor…"}
          </span>
        </div>
      )}
      <p className="error" role="alert">{error}</p>
      <footer className="dialog-actions">
        {guardando && progreso ? (
          <button type="button" className="button secondary" onClick={() => cancelar.current?.abort()}>Cancelar subida</button>
        ) : (
          <button type="button" className="button secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
        )}
        <button className="button primary" disabled={guardando}>{editando ? "Guardar datos" : "Cargar nube"}</button>
      </footer>
      <datalist id="nubes-sitios">
        {sitios.map((s) => <option key={s} value={s} />)}
      </datalist>
    </form>
  );
}
