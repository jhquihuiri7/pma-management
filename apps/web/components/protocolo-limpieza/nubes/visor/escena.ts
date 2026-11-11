import Instance from "@giro3d/giro3d/core/Instance.js";
import ColorMap from "@giro3d/giro3d/core/ColorMap.js";
import CoordinateSystem from "@giro3d/giro3d/core/geographic/CoordinateSystem.js";
import PointCloud from "@giro3d/giro3d/entities/PointCloud.js";
import COPCSource from "@giro3d/giro3d/sources/COPCSource.js";
import { setLazPerfPath } from "@giro3d/giro3d/sources/las/config.js";
import { Box3, Color, Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MetadatosNube } from "@pma/types/protocolo-limpieza";
import { claseNube, RAMPA_ALTURA, rangoAltura } from "@/lib/protocolo-limpieza/nubes";

// The 3D point cloud viewer (Giro3D on three.js). The only module that talks to
// Giro3D; the view loads it on demand, so three.js and Giro3D are downloaded
// only in the Visualización 3D tab.
//
// The COPC is read by HTTP ranges: the octree's root first, then the nodes in
// view, finer as the camera comes closer, so a cloud of tens of millions of
// points shows in seconds at full detail where one looks. Eye-dome lighting
// gives depth to the points, inpainting fills the gaps between them and
// occlusion hides the points behind a surface.

export type ModoColor = "color" | "clases" | "altura";
export type Calidad = "equilibrada" | "alta" | "maxima";

export interface NubeEnVisor {
  id: string;
  url: string;
  metadatos: MetadatosNube;
}

export interface EstadoCarga {
  cargando: boolean;
  /** 0–1 */
  progreso: number;
  /** Points on screen now. */
  puntosEnPantalla: number;
}

export interface VisorNubes {
  /** Shows a cloud. Of the same site, the camera stays where it is: the timeline compares in place. */
  mostrar(nube: NubeEnVisor): Promise<void>;
  colorear(modo: ModoColor): void;
  calidad(nivel: Calidad): void;
  /** Only these classification codes are drawn; null draws all. */
  clasesVisibles(codigos: ReadonlySet<number> | null): void;
  /** In pixels; 0 lets Giro3D size them by distance. */
  tamañoPunto(px: number): void;
  /** Eye-dome lighting and gap filling. */
  realce(activo: boolean): void;
  restablecerVista(): void;
  destruir(): void;
}

/**
 * The detail of each level: the lower the threshold, the sooner a node is
 * replaced by its finer children; the budget caps the points drawn at once.
 */
const CALIDADES: Record<Calidad, { umbral: number; presupuesto: number | null }> = {
  equilibrada: { umbral: 1.5, presupuesto: 2_000_000 },
  alta: { umbral: 1, presupuesto: 5_000_000 },
  maxima: { umbral: 0.75, presupuesto: null },
};

const FONDO = "#0f172a";

/**
 * Fixed camera planes. Giro3D derives the near plane from the octree nodes in
 * view, but a COPC's root node is a cube much taller than the ground: with the
 * camera inside it the distance comes out negative, Giro3D keeps the previous
 * near plane, and coming close to a pile then cuts away its first metres. A
 * quarter of a metre keeps centimetre depth precision for the lighting at the
 * distances of a site.
 */
const PLANO_CERCANO = 0.25;

/** How much of the view the cloud's box spans at first (1 = edge to edge). */
const ENCUADRE = 1.1;

/** The laz-perf decoder is served by SIGTAR (public/), not by a CDN. */
setLazPerfPath("/protocolo-limpieza/vendor");

const registrados = new Map<string, CoordinateSystem>();

function sistemaDe(m: MetadatosNube): { id: string; crs: CoordinateSystem } {
  if (!m.crs) return { id: "desconocido", crs: CoordinateSystem.unknown };
  const id = m.crs.epsg ? `EPSG:${m.crs.epsg}` : `WKT:${m.crs.nombre}`;
  let crs = registrados.get(id);
  if (!crs) {
    crs = CoordinateSystem.register(id, m.crs.wkt);
    registrados.set(id, crs);
  }
  return { id, crs };
}

interface Escena {
  sistema: string;
  instance: Instance;
  controles: OrbitControls;
  nube: PointCloud | null;
  metadatos: MetadatosNube | null;
  quitarEventos(): void;
}

export function crearVisorNubes(contenedor: HTMLDivElement, alCargar: (estado: EstadoCarga) => void): VisorNubes {
  let escena: Escena | null = null;
  let ajustes = { modo: "color" as ModoColor, calidad: "alta" as Calidad, clases: null as ReadonlySet<number> | null, tamaño: 0, realce: true };
  let turno = 0;
  let destruido = false;

  const crearEscena = (sistema: string, crs: CoordinateSystem): Escena => {
    const instance = new Instance({ target: contenedor, crs, backgroundColor: FONDO });
    instance.mainLoop.automaticCameraPlaneComputation = false;
    instance.view.minNearPlane = PLANO_CERCANO;
    instance.view.near = PLANO_CERCANO;
    const camara = instance.view.camera;
    camara.up.set(0, 0, 1);
    const controles = new OrbitControls(camara, instance.domElement);
    controles.enableDamping = true;
    controles.dampingFactor = 0.15;
    // Pan over the ground, not across the screen; zoom towards the cursor.
    controles.screenSpacePanning = false;
    controles.zoomToCursor = true;
    controles.maxPolarAngle = Math.PI / 2 + 0.25;
    instance.view.setControls(controles);
    const opciones = instance.renderingOptions;
    opciones.enableEDL = ajustes.realce;
    opciones.EDLStrength = 0.9;
    opciones.EDLRadius = 1.4;
    opciones.enableInpainting = ajustes.realce;
    opciones.inpaintingSteps = 2;
    opciones.enablePointCloudOcclusion = true;
    const informar = () => {
      const nube = escena?.nube;
      alCargar({ cargando: instance.loading, progreso: instance.progress, puntosEnPantalla: nube ? nube.displayedPointCount : 0 });
    };
    instance.addEventListener("update-end", informar);
    return { sistema, instance, controles, nube: null, metadatos: null, quitarEventos: () => instance.removeEventListener("update-end", informar) };
  };

  const destruirEscena = (e: Escena) => {
    e.quitarEventos();
    e.controles.dispose();
    e.instance.dispose();
    // Giro3D leaves its viewport element in the container.
    contenedor.replaceChildren();
  };

  const aplicarColor = (e: Escena) => {
    const { nube, metadatos } = e;
    if (!nube || !metadatos) return;
    nube.setColoringMode("attribute");
    const modo = ajustes.modo === "color" && !metadatos.color ? "altura" : ajustes.modo;
    if (modo === "color") nube.setActiveAttribute("Color");
    else if (modo === "clases") {
      nube.setActiveAttribute("Classification");
      const tabla = nube.getAttributeClassifications("Classification");
      tabla.forEach((clase, codigo) => {
        clase.color.set(claseNube(codigo).color);
        clase.visible = !ajustes.clases || ajustes.clases.has(codigo);
      });
    } else {
      nube.setActiveAttribute("Z");
      const [min, max] = rangoAltura(metadatos.z);
      nube.setAttributeColorMap("Z", new ColorMap({ colors: RAMPA_ALTURA.map((c) => new Color(c)), min, max }));
    }
    e.instance.notifyChange(nube);
  };

  const aplicarAjustes = (e: Escena) => {
    const nube = e.nube;
    if (!nube) return;
    const { umbral, presupuesto } = CALIDADES[ajustes.calidad];
    nube.subdivisionThreshold = umbral;
    nube.pointBudget = presupuesto;
    if (presupuesto === null) nube.decimation = 1;
    nube.pointSize = ajustes.tamaño;
    aplicarColor(e);
  };

  /** From the south-east, looking down obliquely, the whole cloud in view. */
  const encuadrar = (e: Escena) => {
    const m = e.metadatos;
    if (!m) return;
    const l = m.limites;
    const caja = e.nube?.getBoundingBox() ?? new Box3(new Vector3(l.minx, l.miny, l.minz), new Vector3(l.maxx, l.maxy, l.maxz));
    const centro = caja.getCenter(new Vector3());
    // The ground, not a few stray points far above or below, sets the height and the size.
    const [bajo, alto] = rangoAltura(m.z);
    centro.z = (bajo + alto) / 2;
    const camara = e.instance.view.camera as PerspectiveCamera;
    camara.updateProjectionMatrix();
    // The distance at which the box (ground height only) just overflows the narrower side of the
    // view (ENCUADRE): its 8 corners are projected and the distance is bisected. A survey seldom
    // fills its box (its corners are empty), so fitting the box exactly leaves the cloud small.
    const esquinas = [caja.min.x, caja.max.x].flatMap((x) => [caja.min.y, caja.max.y].flatMap((y) => [bajo, alto].map((z) => new Vector3(x, y, z))));
    const direccion = new Vector3(0.35, -0.6, 0.72).normalize();
    const ocupa = (d: number) => {
      camara.position.copy(centro).addScaledVector(direccion, d);
      camara.lookAt(centro);
      camara.updateMatrixWorld();
      let maximo = 0;
      for (const esquina of esquinas) {
        const enVista = esquina.clone().applyMatrix4(camara.matrixWorldInverse);
        if (enVista.z >= -PLANO_CERCANO) return Infinity; // behind the camera: too close
        const p = esquina.clone().project(camara);
        maximo = Math.max(maximo, Math.abs(p.x), Math.abs(p.y));
      }
      return maximo;
    };
    const tamaño = caja.getSize(new Vector3());
    let cerca = 1, lejos = Math.max(tamaño.x, tamaño.y, alto - bajo, 10) * 20;
    for (let i = 0; i < 40; i++) {
      const medio = (cerca + lejos) / 2;
      if (ocupa(medio) > ENCUADRE) cerca = medio;
      else lejos = medio;
    }
    const distancia = lejos;
    camara.position.copy(centro).addScaledVector(direccion, distancia);
    camara.lookAt(centro);
    e.instance.view.far = Math.max(5_000, distancia * 20);
    e.controles.target.copy(centro);
    e.controles.maxDistance = distancia * 6;
    e.controles.update();
    e.instance.notifyChange(camara);
  };

  return {
    async mostrar(nube) {
      const mio = ++turno;
      const { id: sistema, crs } = sistemaDe(nube.metadatos);
      const nuevaEscena = !escena || escena.sistema !== sistema;
      if (nuevaEscena) {
        if (escena) destruirEscena(escena);
        escena = crearEscena(sistema, crs);
      }
      const e = escena!;
      const entidad = new PointCloud({ source: new COPCSource({ url: nube.url }) });
      await e.instance.add(entidad);
      // A later date was chosen while this one loaded, or the view closed.
      if (mio !== turno || destruido || escena !== e) {
        e.instance.remove(entidad);
        return;
      }
      const anterior = e.nube;
      e.nube = entidad;
      e.metadatos = nube.metadatos;
      aplicarAjustes(e);
      if (anterior) e.instance.remove(anterior);
      if (nuevaEscena) encuadrar(e);
      e.instance.notifyChange();
    },
    colorear(modo) {
      ajustes = { ...ajustes, modo };
      if (escena) aplicarColor(escena);
    },
    calidad(nivel) {
      ajustes = { ...ajustes, calidad: nivel };
      if (escena) {
        aplicarAjustes(escena);
        escena.instance.notifyChange();
      }
    },
    clasesVisibles(codigos) {
      ajustes = { ...ajustes, clases: codigos };
      if (escena) aplicarColor(escena);
    },
    tamañoPunto(px) {
      ajustes = { ...ajustes, tamaño: px };
      if (escena?.nube) {
        escena.nube.pointSize = px;
        escena.instance.notifyChange(escena.nube);
      }
    },
    realce(activo) {
      ajustes = { ...ajustes, realce: activo };
      if (escena) {
        escena.instance.renderingOptions.enableEDL = activo;
        escena.instance.renderingOptions.enableInpainting = activo;
        escena.instance.notifyChange();
      }
    },
    restablecerVista() {
      if (escena) encuadrar(escena);
    },
    destruir() {
      destruido = true;
      turno++;
      if (escena) destruirEscena(escena);
      escena = null;
    },
  };
}
