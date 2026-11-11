"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pencil,
  RefreshCw,
  Rotate3d,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { claveSitio, type NubePuntos } from "@pma/types/protocolo-limpieza";
import { ApiError, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  agruparPorSitio,
  claseNube,
  eliminarNube,
  formatoBytes,
  formatoPuntos,
  listarNubes,
  nubeInicial,
  RAMPA_ALTURA,
  rangoAltura,
  reintentarNube,
  textoEstado,
  urlCopc,
  urlOriginal,
} from "@/lib/protocolo-limpieza/nubes";
import { displayDate } from "@/lib/protocolo-limpieza/tablero";
import DialogoNube from "./DialogoNube";
import type { Calidad, ModoColor, NubeEnVisor } from "./visor/escena";

// The viewer only exists in the browser (WebGL); it is not rendered on the server.
const VisorNube = dynamic(() => import("./VisorNube"), { ssr: false });

/** "14,6 m": the module writes decimals with a comma. */
const metros = (v: number) => `${v.toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;

/** While a cloud is converting, the list is read again this often. */
const CONSULTA_MS = 5_000;

const CALIDADES: ReadonlyArray<readonly [Calidad, string]> = [
  ["equilibrada", "Equilibrada"],
  ["alta", "Alta"],
  ["maxima", "Máxima"],
];

/** Visualización 3D: point clouds of each site on their timeline of survey dates. */
export default function VisualizacionVista() {
  const { user } = useAuth();
  const esAdmin = user?.role === "ADMIN";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [nubes, setNubes] = useState<NubePuntos[]>([]);
  const [cargadas, setCargadas] = useState(false);
  const [falloLista, setFalloLista] = useState("");
  const [dialogo, setDialogo] = useState<{ abierto: boolean; apertura: number; nube: NubePuntos | null }>({ abierto: false, apertura: 0, nube: null });
  const [modo, setModo] = useState<ModoColor>("color");
  const [calidad, setCalidad] = useState<Calidad>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches ? "equilibrada" : "alta",
  );
  const [clasesOcultas, setClasesOcultas] = useState<ReadonlySet<number>>(new Set());
  const [tamaño, setTamaño] = useState(0);
  const [realce, setRealce] = useState(true);
  const [restablecer, setRestablecer] = useState(0);
  const [expandido, setExpandido] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const refrescar = useCallback(async () => {
    try {
      setNubes(await listarNubes());
      setFalloLista("");
    } catch (error) {
      setFalloLista(
        error instanceof ApiError && error.status === 403
          ? "Tu usuario no tiene acceso al Protocolo de limpieza."
          : apiErrorMessage(error, "No se pudo leer la lista de nubes de puntos."),
      );
    } finally {
      setCargadas(true);
    }
  }, []);

  useEffect(() => { void refrescar(); }, [refrescar]);
  const convirtiendo = nubes.some((n) => n.estado === "procesando");
  useEffect(() => {
    if (!convirtiendo) return;
    const reloj = setInterval(() => void refrescar(), CONSULTA_MS);
    return () => clearInterval(reloj);
  }, [convirtiendo, refrescar]);

  // Selection lives in the URL (?sitio=…&nube=…): a link opens that site and date.
  const sitios = useMemo(() => agruparPorSitio(nubes), [nubes]);
  const sitio = sitios.find((s) => s.clave === params.get("sitio")) ?? sitios[0] ?? null;
  const nube = sitio ? nubeInicial(sitio.nubes, params.get("nube")) : null;
  const elegir = useCallback(
    (clave: string, id?: string) => {
      const q = new URLSearchParams(params.toString());
      q.set("sitio", clave);
      if (id) q.set("nube", id);
      else q.delete("nube");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const indice = sitio && nube ? sitio.nubes.findIndex((n) => n.id === nube.id) : -1;
  const mover = (paso: -1 | 1) => {
    if (!sitio || indice < 0) return;
    const siguiente = sitio.nubes[indice + paso];
    if (siguiente) elegir(sitio.clave, siguiente.id);
  };

  // The viewer gets a new object only when the ready cloud changes.
  const enVisor = useMemo<NubeEnVisor | null>(
    () => (nube?.estado === "lista" && nube.metadatos ? { id: nube.id, url: urlCopc(nube.id), metadatos: nube.metadatos } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nube?.id, nube?.estado, nube?.procesadaEn],
  );
  const metadatos = nube?.metadatos ?? null;
  const conColor = !!metadatos?.color;
  const modoEfectivo: ModoColor = modo === "color" && metadatos && !conColor ? "altura" : modo;
  const clasesVisibles = useMemo(() => {
    if (!metadatos || clasesOcultas.size === 0) return null;
    return new Set(Array.from({ length: 256 }, (_, i) => i).filter((c) => !clasesOcultas.has(c)));
  }, [metadatos, clasesOcultas]);

  // Expanded, the viewer card fills the screen (like the Santa Cruz map); Escape brings it back.
  useEffect(() => {
    if (!expandido) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !dialogo.abierto) setExpandido(false); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", tecla);
    return () => {
      document.body.style.overflow = antes;
      document.removeEventListener("keydown", tecla);
    };
  }, [expandido, dialogo.abierto]);

  const abrirCarga = () => setDialogo((d) => ({ abierto: true, apertura: d.apertura + 1, nube: null }));
  const abrirEdicion = (n: NubePuntos) => setDialogo((d) => ({ abierto: true, apertura: d.apertura + 1, nube: n }));

  async function eliminar(n: NubePuntos) {
    if (!window.confirm(`¿Eliminar la nube del ${displayDate(n.fecha)} de «${n.sitio}»?\n\nSe borran el archivo original (${formatoBytes(n.archivoBytes)}) y su versión para el visor. No se puede deshacer.`)) return;
    setOcupado(true);
    try {
      await eliminarNube(n.id);
      toast.success("Nube eliminada.");
      if (sitio) elegir(sitio.clave);
      await refrescar();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo eliminar la nube."));
    } finally {
      setOcupado(false);
    }
  }

  async function reintentar(n: NubePuntos) {
    setOcupado(true);
    try {
      await reintentarNube(n.id);
      toast.success("La nube vuelve a convertirse.");
      await refrescar();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo reintentar la conversión."));
    } finally {
      setOcupado(false);
    }
  }

  const alternarClase = (codigo: number) =>
    setClasesOcultas((antes) => {
      const siguiente = new Set(antes);
      if (siguiente.has(codigo)) siguiente.delete(codigo);
      else siguiente.add(codigo);
      return siguiente;
    });

  if (!cargadas) {
    return <section className="view"><div className="panel nubes-vacio"><LoaderCircle className="ico nubes-giro" /> Cargando las nubes de puntos…</div></section>;
  }

  return (
    <section id="nubes" className="view">
      <div className="panel nubes-panel">
        <div className="panel-heading">
          <h2><Rotate3d className="ico" />Nubes de puntos</h2>
          <button type="button" className="button primary" onClick={abrirCarga}><Upload className="ico" />Cargar nube</button>
        </div>
        {falloLista && <p className="nubes-aviso is-error" role="alert">{falloLista}</p>}
        {!sitio ? (
          <div className="nubes-vacio">
            <p><strong>Aún no hay nubes de puntos.</strong></p>
            <p>Carga el archivo .las o .laz de un levantamiento con su sitio y fecha. Cargando el mismo sitio en otras fechas se arma su línea de tiempo.</p>
          </div>
        ) : (
          <>
            <div className="nubes-encabezado">
              <label className="nubes-sitio">
                Sitio
                <select value={sitio.clave} onChange={(e) => elegir(e.target.value)}>
                  {sitios.map((s) => (
                    <option key={s.clave} value={s.clave}>{s.sitio} ({s.nubes.length} {s.nubes.length === 1 ? "fecha" : "fechas"})</option>
                  ))}
                </select>
              </label>
              <div className="nubes-linea" role="group" aria-label={`Línea de tiempo de ${sitio.sitio}`}>
                <button type="button" className="nubes-paso" aria-label="Fecha anterior" disabled={indice <= 0} onClick={() => mover(-1)}><ChevronLeft className="ico" /></button>
                <ol>
                  {sitio.nubes.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`nubes-fecha is-${n.estado}`}
                        aria-current={n.id === nube?.id ? "true" : undefined}
                        title={`${displayDate(n.fecha)} · ${textoEstado(n)}`}
                        onClick={() => elegir(sitio.clave, n.id)}
                      >
                        <i aria-hidden="true" />
                        {displayDate(n.fecha)}
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="nubes-paso" aria-label="Fecha siguiente" disabled={indice < 0 || indice >= sitio.nubes.length - 1} onClick={() => mover(1)}><ChevronRight className="ico" /></button>
              </div>
            </div>

            {expandido && <div className="nubes-fondo" aria-hidden="true" onClick={() => setExpandido(false)} />}
            <figure className={`nubes-visor${expandido ? " is-expandido" : ""}`}>
              <figcaption className="nubes-herramientas">
                <div className="nubes-grupo" role="radiogroup" aria-label="Color de los puntos">
                  {([["color", "Color real"], ["clases", "Clasificación"], ["altura", "Altura"]] as const).map(([valor, texto]) => (
                    <button
                      key={valor}
                      type="button"
                      role="radio"
                      aria-checked={modoEfectivo === valor}
                      disabled={valor === "color" && !!metadatos && !conColor}
                      title={valor === "color" && metadatos && !conColor ? "Esta nube no tiene color" : undefined}
                      onClick={() => setModo(valor)}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                <div className="nubes-ajustes">
                  <label>
                    Calidad
                    <select value={calidad} onChange={(e) => setCalidad(e.target.value as Calidad)}>
                      {CALIDADES.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                    </select>
                  </label>
                  <label>
                    Punto
                    <select value={tamaño} onChange={(e) => setTamaño(Number(e.target.value))}>
                      <option value={0}>Automático</option>
                      {[1, 2, 3, 4, 6].map((px) => <option key={px} value={px}>{px} px</option>)}
                    </select>
                  </label>
                  <button type="button" className="nubes-boton" aria-pressed={realce} title="Iluminación de relieve (EDL) y relleno de huecos" onClick={() => setRealce((v) => !v)}>Relieve</button>
                  <button type="button" className="nubes-boton" title="Restablecer la vista" aria-label="Restablecer la vista" onClick={() => setRestablecer((n) => n + 1)}><RotateCcw className="ico" /></button>
                  <button type="button" className="nubes-boton" title={expandido ? "Contraer el visor" : "Expandir el visor"} aria-label={expandido ? "Contraer el visor" : "Expandir el visor"} aria-expanded={expandido} onClick={() => setExpandido((v) => !v)}>
                    {expandido ? <Minimize2 className="ico" /> : <Maximize2 className="ico" />}
                  </button>
                </div>
              </figcaption>
              <div className="nubes-escenario">
                <VisorNube
                  nube={enVisor}
                  modo={modoEfectivo}
                  calidad={calidad}
                  clases={clasesVisibles}
                  tamaño={tamaño}
                  realce={realce}
                  restablecer={restablecer}
                  etiqueta={nube ? `Nube de puntos de ${nube.sitio} del ${displayDate(nube.fecha)}` : "Visor de nubes de puntos"}
                />
                {nube && nube.estado !== "lista" && (
                  <div className={`nubes-estado is-${nube.estado}`}>
                    {nube.estado === "procesando" ? (
                      <>
                        <LoaderCircle className="ico nubes-giro" />
                        <p><strong>Preparando la nube para el visor…</strong></p>
                        <p>Se convierte a un formato que se carga por partes. Con unos 20 millones de puntos tarda alrededor de un minuto.</p>
                      </>
                    ) : (
                      <>
                        <TriangleAlert className="ico" />
                        <p><strong>No se pudo convertir esta nube.</strong></p>
                        <p>{nube.error}</p>
                        <button type="button" className="button secondary" disabled={ocupado} onClick={() => void reintentar(nube)}><RefreshCw className="ico" />Reintentar</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {metadatos && nube?.estado === "lista" && (
                <div className="nubes-leyenda">
                  {modoEfectivo === "clases" ? (
                    metadatos.clases.length ? (
                      metadatos.clases.map((c) => {
                        const clase = claseNube(c.codigo);
                        const total = metadatos.clases.reduce((s, x) => s + x.puntos, 0);
                        return (
                          <button key={c.codigo} type="button" className="nubes-clase" aria-pressed={!clasesOcultas.has(c.codigo)} onClick={() => alternarClase(c.codigo)} title="Mostrar u ocultar esta clase">
                            <i style={{ background: clase.color }} />
                            {clase.nombre} <small>{Math.round((c.puntos / total) * 100)} %</small>
                          </button>
                        );
                      })
                    ) : (
                      <span>Esta nube no tiene clasificación.</span>
                    )
                  ) : modoEfectivo === "altura" ? (
                    <span className="nubes-rampa">
                      {metros(rangoAltura(metadatos.z)[0])}
                      <i style={{ background: `linear-gradient(90deg, ${RAMPA_ALTURA.join(", ")})` }} />
                      {metros(rangoAltura(metadatos.z)[1])}
                    </span>
                  ) : (
                    <span>Colores reales del levantamiento.</span>
                  )}
                  <span className="nubes-ayuda">Arrastra para girar · clic derecho o dos dedos para desplazar · rueda para acercar</span>
                </div>
              )}
            </figure>

            {nube && (
              <div className="nubes-ficha">
                <dl>
                  <div><dt>Fecha</dt><dd>{displayDate(nube.fecha)}</dd></div>
                  <div><dt>Estado</dt><dd className={`nubes-estado-texto is-${nube.estado}`}>{nube.estado === "error" ? "Error" : textoEstado(nube)}</dd></div>
                  <div><dt>Puntos</dt><dd>{formatoPuntos(nube.puntos)}</dd></div>
                  <div><dt>Sistema</dt><dd>{metadatos?.crs?.nombre ?? (nube.estado === "lista" ? "Sin sistema de coordenadas" : "—")}</dd></div>
                  <div><dt>Archivo</dt><dd>{nube.archivoNombre} · {formatoBytes(nube.archivoBytes)}</dd></div>
                  <div><dt>Cargado por</dt><dd>{nube.creadoPorNombre}</dd></div>
                  {nube.descripcion && <div className="nubes-ficha-ancha"><dt>Descripción</dt><dd>{nube.descripcion}</dd></div>}
                </dl>
                <div className="nubes-acciones">
                  <a className="button secondary" href={urlOriginal(nube.id)} download><Download className="ico" />Descargar original</a>
                  <button type="button" className="button secondary" disabled={ocupado} onClick={() => abrirEdicion(nube)}><Pencil className="ico" />Editar datos</button>
                  {esAdmin && (
                    <button type="button" className="button secondary nubes-eliminar" disabled={ocupado} onClick={() => void eliminar(nube)}><Trash2 className="ico" />Eliminar</button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <DialogoNube
        abierto={dialogo.abierto}
        apertura={dialogo.apertura}
        nube={dialogo.nube}
        sitioSugerido={sitio?.sitio ?? ""}
        sitios={sitios.map((s) => s.sitio)}
        onClose={() => setDialogo((d) => ({ ...d, abierto: false }))}
        onGuardada={(n) => elegir(claveSitio(n.sitio), n.id)}
        onRefresh={refrescar}
      />
    </section>
  );
}
