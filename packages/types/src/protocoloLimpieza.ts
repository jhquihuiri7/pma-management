// Protocolo de limpieza: rutas, formularios, campos y validaciones.
//
// One copy of the rules for both sides: the web validates the form with
// `clean` before sending it and the API validates again with the same
// function before saving. Ported from lib/schema.js of the standalone app
// (trazabilidad-san-cristobal) without changing its behaviour: same fields,
// same messages, same limits and the same duplicate key.
//
// The API imports this file by relative path, not through "@pma/types": the
// compiled API runs on Node 20, which cannot load the package's .ts sources,
// and tsc emits this file into the API's dist/ next to the code that uses it.

export type RutaLimpieza = "R1" | "R2" | "R2.1" | "R3" | "R4" | "R5" | "R6";

export type OperacionLimpieza =
  | "recoleccion"
  | "carga"
  | "patioSCY"
  | "relleno"
  | "puertoSCY"
  | "embarque"
  | "patioGYE"
  | "recepcion"
  | "gestion";

export type TipoCampoLimpieza = "text" | "date" | "number" | "select" | "photo";

export interface CampoLimpieza {
  id: string;
  label: string;
  type: TipoCampoLimpieza;
  required: boolean;
  /** Numeric field that only accepts whole numbers (the "unidades" count). */
  integer?: boolean;
  /** The values a "select" field accepts. */
  options?: readonly string[];
}

export interface FormularioLimpieza {
  route: RutaLimpieza;
  name: string;
  hint: string;
  fields: readonly CampoLimpieza[];
  /**
   * No longer offered for new reports. Its earlier reports still show, count
   * and can be edited (their operation never changes).
   */
  retirado?: true;
}

/** [trayecto, ejecución, apoyo, recursos disponibles] as the protocol lists them. */
export type InfoRutaLimpieza = readonly [trayecto: string, ejecucion: string, apoyo: string, recursos: string];

/** A validated report: numbers for numeric fields, trimmed text for the rest. */
export type DatosRegistroLimpieza = Record<string, string | number>;

/** A resource available for the operation: "10 personas, Consejo de Gobierno". */
export interface RecursoLimpieza {
  cantidad: number;
  recurso: string;
  institucion: string;
}

export interface RegistroLimpieza {
  id: string;
  kind: OperacionLimpieza;
  data: DatosRegistroLimpieza;
  /** Resources reported with the operation; the dashboard shows those of each route's latest report. */
  recursos: RecursoLimpieza[];
  version: number;
  updatedAt: string;
  /** The SIGTAR user who saved the report (the form no longer asks who reports it). */
  creadoPorNombre?: string;
}

/** Body of POST /protocolo-limpieza/registros. */
export interface RegistroLimpiezaEntrada {
  kind: OperacionLimpieza;
  data: DatosRegistroLimpieza;
  recursos?: RecursoLimpieza[];
}

/** Body of PUT /protocolo-limpieza/registros/:id: the version read, for the concurrency check. */
export interface RegistroLimpiezaEdicion extends RegistroLimpiezaEntrada {
  version: number;
}

/** Fotografía adjunta: JPG de hasta 4 MB; el registro conserva solo su identificador. */
export const MAX_FOTO_BYTES = 4 * 1024 * 1024;
export const FOTO_ID_PATTERN = /^[0-9a-f-]{36}\.jpg$/;

const field = (id: string, label: string, type: TipoCampoLimpieza = "text", required = true): CampoLimpieza => ({
  id,
  label,
  type,
  required,
});
const date = (id: string, label: string) => field(id, label, "date");
const num = (id: string, label: string, required = true) => field(id, label, "number", required);
/** El residuo es escombro o desecho; nada más. */
export const TIPOS_RESIDUO = ["Escombro", "Desecho"] as const;
const type: CampoLimpieza = { ...field("tipo", "Tipo de residuo", "select"), options: TIPOS_RESIDUO };
const box = field("contenedor", "Código de contenedor");
// Toda ruta registra cuánto movió, siempre en toneladas, metros cúbicos y unidades (número entero).
const moved = (action: string): CampoLimpieza[] => [
  num("t", `Cantidad ${action} (t)`),
  num("m3", `Cantidad ${action} (m³)`),
  { ...num("u", `Cantidad ${action} (unidades)`), integer: true },
];
// Fotografía adjunta: se guarda en el servidor y el registro conserva su identificador.
const photo = (id: string, label: string) => field(id, label, "photo");

// Barrios del protocolo (sugeridos en el formulario de recolección).
export const barrios: readonly string[] = [
  "Punta Estrada", "Central (Puerto Ayora)", "Pelikan Bay", "Las Ninfas", "La Alborada", "Las Acacias", "El Eden",
  "Los Arrayanes", "Escalesia", "La Cascada", "Las Orquídeas", "La Union", "Matazarnos", "El Mirador", "Los Cactus",
  "Miraflores", "Pampas Coloradas", "Parque Ecológico Artesanal", "El Bosque", "Miramar", "Tomas De Berlanga",
  "Gordon Wolf", "Miconia", "Central (Bellavista)", "Las Palmas", "13 De Junio", "Los Túneles 1", "24 De Mayo",
  "Central (Santa Rosa)", "Consejo De Gobierno", "Los Túneles 2",
];

// Columnas Trayecto, Ejecución, Apoyo y Recursos disponibles del documento del
// protocolo logístico, tal como están escritas. Los nombres de los lugares de
// todo el módulo (mapa, flujo, formularios) salen de estos trayectos.
export const routes: Readonly<Record<RutaLimpieza, InfoRutaLimpieza>> = {
  R1: ["Zona urbana → Acopio temporal", "GAD SCX", "CGREG", "Personal y maquinaria."],
  R2: ["Acopio temporal → Patio contenedores SCX", "OPC", "CGREG - NAVIERAS", "Maquinaria y contenedores."],
  "R2.1": ["Acopio temporal → Relleno sanitario SCX", "GAD SCX", "CGREG - MIT", "Personal y maquinaria."],
  R3: ["Patio contenedores SCX → Puerto de Baltra", "OPC", "CGREG", "-"],
  R4: ["Puerto Baltra → Puerto GYE", "NAVIERA", "CGREG", "Buques."],
  R5: ["Puerto GYE → Patio contenedores GYE", "OPC", "CGREG", "-"],
  R6: ["Patio GYE → Sitio de gestión de residuos", "GESTORA AMBIENTAL", "APEL - CGREG - GAD SCX", "-"],
};

/** Where a route starts and where it ends, as its trayecto names them. */
export function extremosRuta(route: RutaLimpieza): readonly [origen: string, destino: string] {
  const [origen, destino] = routes[route][0].split(" → ");
  return [origen, destino];
}

// Columna "Datos trazabilidad" del documento del protocolo logístico, tal como está escrita.
export const datosTrazabilidad: Readonly<Record<RutaLimpieza, readonly string[]>> = {
  R1: [
    "Barrio y fecha de recolección",
    "Tipo y cantidad recolectada (t y m³)",
    "Avance por barrio (%)",
    "Tipo y cantidad cargada por contenedor (t, m³ y unidad)",
  ],
  R2: ["Propietario de contenedor", "Código de contenedor", "Fecha de carga de residuos", "Fecha de traslado de contenedores"],
  "R2.1": ["Tipo y cantidad de desecho (t y m³)", "Fecha de traslado de desecho"],
  R3: ["Código de contenedor", "Fecha de traslado de contenedores", "Fotografía interior del contenedor", "Guía de remisión"],
  R4: ["Nombre del buque", "Fecha de salida de Baltra", "Fecha de llegada a Guayaquil"],
  R5: ["Código de contenedor", "Fecha de llegada al patio", "Fecha de retiro de los residuos"],
  R6: ["Constancia de recepción o gestión."],
};

// Campos mínimos de cada ruta según la columna "Datos trazabilidad" del protocolo, más los adicionales.
export const forms: Readonly<Record<OperacionLimpieza, FormularioLimpieza>> = {
  recoleccion: {
    route: "R1",
    name: "Recolección",
    hint: "Una fila por barrio y tipo de residuo en cada fecha. Registra el porcentaje de limpieza acumulado del barrio: su último reporte pinta el barrio en el mapa.",
    fields: [date("fecha", "Fecha de recolección"), field("barrio", "Barrio"), type, ...moved("recolectada"), num("avance", "Porcentaje de limpieza del barrio (%)")],
  },
  // Retired on 2026-11-11 at the user's request: R1 is reported only with Recolección.
  carga: {
    retirado: true,
    route: "R1",
    name: "Carga en contenedores",
    hint: "Una fila por contenedor y tipo de residuo en cada fecha. El tablero cuenta los códigos de contenedor distintos.",
    fields: [date("fecha", "Fecha de carga"), box, type, ...moved("cargada")],
  },
  patioSCY: {
    route: "R2",
    name: `Traslado al ${extremosRuta("R2")[1]}`,
    hint: "Una fila por contenedor y traslado, con la cantidad trasladada.",
    fields: [date("fecha", "Fecha de traslado"), date("fechaCarga", "Fecha de carga de residuos"), box, field("propietario", "Propietario del contenedor"), ...moved("trasladada"), field("recepcion", "Fecha de recepción en patio", "date", false)],
  },
  relleno: {
    route: "R2.1",
    name: `Entrega al ${extremosRuta("R2.1")[1]}`,
    hint: "Registra la cantidad efectivamente recibida. Distingue cada viaje por su comprobante.",
    fields: [date("fecha", "Fecha de traslado"), date("recepcion", "Fecha de ingreso al relleno"), type, ...moved("recibida"), field("documento", "N.º de constancia de ingreso")],
  },
  puertoSCY: {
    route: "R3",
    name: `Traslado al ${extremosRuta("R3")[1]}`,
    hint: "Una fila por contenedor y traslado, con la cantidad trasladada y la fotografía interior del contenedor.",
    fields: [date("fecha", "Fecha de traslado"), box, ...moved("trasladada"), photo("foto", "Fotografía interior del contenedor"), field("documento", "N.º de guía de remisión"), field("recepcion", "Fecha de ingreso al puerto", "date", false)],
  },
  embarque: {
    route: "R4",
    name: "Transporte marítimo",
    hint: "Una fila por contenedor y viaje, con la cantidad embarcada. Registra la llegada estimada: con la salida y la llegada, el mapa ubica el barco en tiempo real. Si la llegada cambia, edítala.",
    fields: [date("fecha", "Salida de Baltra"), date("recepcion", "Llegada estimada a Guayaquil"), box, ...moved("embarcada"), field("buque", "Nombre del buque"), field("documento", "N.º de guía de remisión")],
  },
  patioGYE: {
    route: "R5",
    name: `Traslado al ${extremosRuta("R5")[1]}`,
    hint: "Una fila por contenedor y retiro, con la cantidad trasladada.",
    fields: [date("fecha", "Fecha de retiro de los residuos (puerto)"), date("recepcion", "Fecha de llegada al patio"), box, ...moved("trasladada")],
  },
  recepcion: {
    route: "R6",
    name: "Recepción por la gestora",
    hint: "Una fila por contenedor y tipo de residuo recibido. Registra la gestión final en su propio formulario.",
    fields: [date("fecha", "Fecha de recepción"), box, type, field("sitio", extremosRuta("R6")[1]), ...moved("recibida"), field("documento", "N.º de constancia de recepción")],
  },
  gestion: {
    route: "R6",
    name: "Gestión acreditada",
    hint: "Registra solo la cantidad cubierta por la constancia de gestión. Para varios contenedores, distribuye sus cantidades.",
    fields: [date("fecha", "Fecha de gestión"), box, type, field("sitio", extremosRuta("R6")[1]), field("operacion", "Operación de gestión realizada"), ...moved("gestionada"), field("documento", "N.º de constancia de gestión")],
  },
};


/**
 * The fields of an operation's form. No form has additional data ("Más datos") any
 * more: who saves a report is recorded by SIGTAR, and the rest was dropped (2026-11-11).
 */
export function camposDe(kind: OperacionLimpieza): readonly CampoLimpieza[] {
  return forms[kind].fields;
}

/**
 * Fields the forms no longer ask (2026-11-11). Older reports keep their values:
 * they are shown, exported and kept when a report is edited, never asked again.
 */
export const camposAnteriores: Readonly<Record<string, string>> = {
  lote: "Código de lote",
  medicion: "Origen de las cantidades",
  metodo: "Método de estimación",
  responsable: "Reportado por",
  documento: "N.º de comprobante",
  sello: "Sello",
  viaje: "N.º de viaje",
  entrega: "Entrega",
  recibe: "Recibe",
  equipo: "Tipo y número de equipos",
  costo: "Costo imputado al registro (USD)",
  notas: "Novedades",
};

/** Values of a report that its form no longer asks (see camposAnteriores). */
export function datosAnteriores(kind: OperacionLimpieza, data: Readonly<Record<string, unknown>>): DatosRegistroLimpieza {
  const vigentes = new Set(camposDe(kind).map((f) => f.id));
  const out: DatosRegistroLimpieza = {};
  for (const [id, valor] of Object.entries(data)) {
    if (!vigentes.has(id) && id in camposAnteriores && (typeof valor === "string" || typeof valor === "number")) out[id] = valor;
  }
  return out;
}

export const RUTAS_LIMPIEZA = Object.keys(routes) as RutaLimpieza[];
export const OPERACIONES_LIMPIEZA = Object.keys(forms) as OperacionLimpieza[];

export function esOperacionLimpieza(kind: unknown): kind is OperacionLimpieza {
  return typeof kind === "string" && Object.hasOwn(forms, kind);
}

/** Whether a new report may use the operation: every one but the retired ones. */
export const admiteReportesNuevos = (kind: OperacionLimpieza): boolean => !forms[kind].retirado;

export const fold = (value: unknown): string => String(value ?? "").trim().normalize("NFC").toLocaleLowerCase("es");

/** Validates a report and returns its clean values; throws an Error whose message names the field. */
export function clean(kind: unknown, input: unknown): DatosRegistroLimpieza {
  if (!esOperacionLimpieza(kind) || !input || typeof input !== "object") throw Error("Selecciona una operación válida.");
  const values = input as Record<string, unknown>;
  const out: DatosRegistroLimpieza = {};
  for (const f of camposDe(kind)) {
    const raw = values[f.id];
    const s = String(raw ?? "").trim();
    if (!s) {
      if (f.required) throw Error(f.type === "photo" ? "Adjunta la " + f.label.toLowerCase() + "." : "Completa " + f.label + ".");
      continue;
    }
    if (s.length > 500) throw Error(f.label + " supera los 500 caracteres.");
    if (f.type === "number") {
      const n = Number(s);
      const limits: Record<string, [number, number]> = { avance: [0, 100] };
      const [min, max] = limits[f.id] ?? [0, 1e10];
      if (!Number.isFinite(n) || n < min || n > max) throw Error("Revisa el valor de " + f.label + ".");
      if (f.integer && !Number.isInteger(n)) throw Error("Usa un número entero en " + f.label + ".");
      out[f.id] = n;
    } else {
      if (f.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)) {
        throw Error("Revisa " + f.label + ".");
      }
      if (f.type === "select" && !(f.options ?? []).includes(s)) throw Error("Elige " + f.label + ".");
      if (f.type === "photo" && !FOTO_ID_PATTERN.test(s)) throw Error("Vuelve a adjuntar la " + f.label.toLowerCase() + ".");
      out[f.id] = f.id === "contenedor" ? s.toUpperCase() : s;
    }
  }
  // Dates are YYYY-MM-DD text, so comparing the strings compares the days.
  const fecha = out.fecha;
  if (out.recepcion && typeof fecha === "string" && String(out.recepcion) < fecha) {
    throw Error("La recepción debe ser el mismo día del traslado o después.");
  }
  if (out.fechaCarga && typeof fecha === "string" && String(out.fechaCarga) > fecha) {
    throw Error("La carga de residuos debe ser el mismo día del traslado o antes.");
  }
  return out;
}

/** Duplicate key: two reports of the same operation that describe the same movement. */
export function recordKey(kind: OperacionLimpieza, d: DatosRegistroLimpieza): string {
  const parts: Record<OperacionLimpieza, unknown[]> = {
    recoleccion: [d.fecha, d.barrio, d.tipo],
    carga: [d.contenedor, d.fecha, d.tipo],
    patioSCY: [d.contenedor, d.fecha],
    relleno: [d.tipo, d.documento],
    puertoSCY: [d.contenedor, d.fecha],
    embarque: [d.contenedor, d.viaje || d.fecha],
    patioGYE: [d.contenedor, d.fecha],
    recepcion: [d.contenedor, d.tipo, d.documento],
    gestion: [d.contenedor, d.tipo, d.documento],
  };
  return JSON.stringify([kind, ...parts[kind].map(fold)]);
}

/** "personas" → "Personas": the first letter in capitals, the rest as written. */
export const conMayuscula = (texto: string): string => (texto ? texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1) : texto);

// Recursos disponibles de cada reporte (personal, vehículos, maquinaria) y su institución.
export const MAX_RECURSOS = 20;

/** Validates the resources of a report; empty rows must be dropped before. Throws naming the row. */
export function limpiarRecursos(input: unknown): RecursoLimpieza[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw Error("Revisa los recursos disponibles.");
  if (input.length > MAX_RECURSOS) throw Error(`Registra como máximo ${MAX_RECURSOS} recursos por reporte.`);
  return input.map((valor, i) => {
    const n = i + 1;
    const fila = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
    const textoCantidad = String(fila.cantidad ?? "").trim();
    const cantidad = Number(textoCantidad);
    if (!textoCantidad || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000) {
      throw Error(`Usa un número entero mayor que cero en la cantidad del recurso ${n}.`);
    }
    const recurso = conMayuscula(String(fila.recurso ?? "").trim());
    if (!recurso) throw Error(`Completa el recurso ${n}.`);
    if (recurso.length > 100) throw Error(`El recurso ${n} supera los 100 caracteres.`);
    const institucion = String(fila.institucion ?? "").trim();
    if (!institucion) throw Error(`Completa la institución del recurso ${n}.`);
    if (institucion.length > 200) throw Error(`La institución del recurso ${n} supera los 200 caracteres.`);
    return { cantidad, recurso, institucion };
  });
}

// ── Nubes de puntos (Visualización 3D) ──────────────────────────────────────
// Each upload is one survey of a site on a date; the surveys of a site are its
// timeline. The original LAS/LAZ is kept as uploaded and the worker converts it
// to a COPC (cloud optimised point cloud) that the viewer reads by ranges.

export const EXTENSIONES_NUBE = [".las", ".laz"] as const;
export type ExtensionNube = (typeof EXTENSIONES_NUBE)[number];
/** 5 GiB per file: nginx accepts 6 GB per request. */
export const MAX_NUBE_BYTES = 5 * 1024 ** 3;
export const MAX_SITIO_NUBE = 120;
export const MAX_DESCRIPCION_NUBE = 500;
/** The LAS public header block is at most 375 bytes (LAS 1.4). */
export const BYTES_CABECERA_LAS = 375;

export type EstadoNube = "procesando" | "lista" | "error";

export interface LimitesNube {
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
}

/** What the worker learns from the converted cloud. */
export interface MetadatosNube {
  /** Horizontal coordinate system (name, WKT, EPSG code, proj4), or null for a cloud without one. */
  crs: { nombre: string; wkt: string; epsg: number | null; proj4: string } | null;
  limites: LimitesNube;
  dimensiones: string[];
  /** The points carry RGB colour. */
  color: boolean;
  /** Points per classification code, most frequent first. */
  clases: Array<{ codigo: number; puntos: number }>;
  /** Elevation statistics, for the elevation colour scale. */
  z: { min: number; max: number; media: number; desviacion: number };
}

export interface NubePuntos {
  id: string;
  sitio: string;
  /** Survey date (YYYY-MM-DD). */
  fecha: string;
  descripcion: string;
  archivoNombre: string;
  archivoBytes: number;
  estado: EstadoNube;
  error: string | null;
  /** From the LAS header at upload; the exact count once converted. */
  puntos: number;
  copcBytes: number | null;
  metadatos: MetadatosNube | null;
  version: number;
  creadoPorNombre: string;
  actualizadoPorNombre: string;
  creadoEn: string;
  actualizadoEn: string;
  procesadaEn: string | null;
}

export interface DatosNube {
  sitio: string;
  fecha: string;
  descripcion: string;
}

/** Key that groups the surveys of a site: case, accents and spacing do not split it. */
export const claveSitio = (sitio: string): string =>
  sitio.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");

const esFechaIso = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/**
 * Validates the data of a cloud (site, survey date, description) and returns it
 * clean. `hoy` is today's date in Galápagos: a survey cannot be in the future.
 * Throws an Error whose message is shown to the user.
 */
export function limpiarDatosNube(input: unknown, hoy: string): DatosNube {
  const datos = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sitio = String(datos.sitio ?? "").replace(/\s+/g, " ").trim();
  if (!sitio) throw Error("Indica el sitio del levantamiento.");
  if (sitio.length > MAX_SITIO_NUBE) throw Error(`El sitio supera los ${MAX_SITIO_NUBE} caracteres.`);
  const fecha = String(datos.fecha ?? "").trim();
  if (!esFechaIso(fecha)) throw Error("Indica la fecha del levantamiento.");
  if (fecha > hoy) throw Error("La fecha del levantamiento no puede ser posterior a hoy.");
  const descripcion = String(datos.descripcion ?? "").trim();
  if (descripcion.length > MAX_DESCRIPCION_NUBE) {
    throw Error(`La descripción supera los ${MAX_DESCRIPCION_NUBE} caracteres.`);
  }
  return { sitio, fecha, descripcion };
}

/** The extension of an uploaded file, or null when it is not a LAS/LAZ. */
export function extensionNube(nombre: string): ExtensionNube | null {
  const ext = /\.[^.]+$/.exec(nombre.trim().toLowerCase())?.[0];
  return (EXTENSIONES_NUBE as readonly string[]).includes(ext ?? "") ? (ext as ExtensionNube) : null;
}

export interface CabeceraLas {
  /** "1.2", "1.4"… */
  version: string;
  /** Point data record format (0–10). */
  formato: number;
  /** LAZ: the points are compressed. */
  comprimido: boolean;
  puntos: number;
  /** Bytes of each point record. */
  bytesPunto: number;
  /** Byte where the point records start. */
  inicioPuntos: number;
  limites: LimitesNube;
}

const NO_ES_LAS = "El archivo no es una nube de puntos LAS/LAZ válida.";

/**
 * Reads the public header block of a LAS/LAZ file. The first
 * BYTES_CABECERA_LAS bytes are enough; the browser checks a file with it before
 * uploading and the API again once it is stored. Throws a message for the user.
 */
export function leerCabeceraLas(bytes: Uint8Array): CabeceraLas {
  if (bytes.length < 227) throw Error(NO_ES_LAS);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firma = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (firma !== "LASF") throw Error(NO_ES_LAS);
  const mayor = bytes[24], menor = bytes[25];
  if (mayor !== 1 || menor > 4) throw Error(`Versión LAS ${mayor}.${menor} no admitida (se aceptan 1.0 a 1.4).`);
  const tamañoCabecera = v.getUint16(94, true);
  const inicioPuntos = v.getUint32(96, true);
  const idFormato = bytes[104];
  const formato = idFormato & 0x3f;
  // LAZ marks its compressed points with the two high bits of the format id.
  const comprimido = (idFormato & 0xc0) !== 0;
  const bytesPunto = v.getUint16(105, true);
  let puntos = v.getUint32(107, true);
  if (menor >= 4 && tamañoCabecera >= 375 && bytes.length >= 255) {
    const total = Number(v.getBigUint64(247, true));
    if (total > 0) puntos = total;
  }
  if (tamañoCabecera < 227 || inicioPuntos < tamañoCabecera || formato > 10 || bytesPunto === 0) throw Error(NO_ES_LAS);
  if (!Number.isSafeInteger(puntos) || puntos <= 0) throw Error("La nube de puntos no tiene puntos.");
  const limites: LimitesNube = {
    maxx: v.getFloat64(179, true),
    minx: v.getFloat64(187, true),
    maxy: v.getFloat64(195, true),
    miny: v.getFloat64(203, true),
    maxz: v.getFloat64(211, true),
    minz: v.getFloat64(219, true),
  };
  return { version: `${mayor}.${menor}`, formato, comprimido, puntos, bytesPunto, inicioPuntos, limites };
}

/**
 * An uncompressed LAS states exactly how long it must be: a shorter file was
 * cut during the copy or the upload. Returns the message to show, or null.
 */
export function lasIncompleto(cabecera: CabeceraLas, bytesArchivo: number): string | null {
  if (cabecera.comprimido) return null;
  const esperado = cabecera.inicioPuntos + cabecera.puntos * cabecera.bytesPunto;
  return bytesArchivo < esperado
    ? `El archivo está incompleto: tiene ${bytesArchivo} bytes y su cabecera indica ${esperado}. Vuelve a copiarlo y súbelo de nuevo.`
    : null;
}
