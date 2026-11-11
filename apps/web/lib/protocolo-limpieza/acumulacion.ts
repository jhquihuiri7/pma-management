// Residuos por ruta y movimiento del día, a partir de las cantidades de cada ruta.
// Toda ruta registra cuánto movió (t y m³). En cada ruta se pinta lo que entró a ella menos
// lo que ya pasó a la siguiente: si entran 100 t al R1 se pintan 100 t en R1; si luego 50 t
// pasan al R2, R1 baja a 50 t y R2 se pinta con 50 t. Se usa la unidad elegida en el tablero.
//
// Ported from lib/accumulation.js of the standalone app without changing its behaviour; its
// tests live in tests/protocolo-limpieza-acumulacion.test.ts.
import { extremosRuta, fold, type RutaLimpieza } from "@pma/types/protocolo-limpieza";

export type Unidad = "t" | "m3" | "u";
export type ZonaPunto = "sc" | "gye";
export type LadoEtiqueta = "right" | "left" | "top" | "bottom";
export type EstadoViaje = "programado" | "navegando" | "arribado";

/** Lo que el cálculo necesita de un registro: la operación y sus valores. */
export interface RegistroCalculo {
  kind: string;
  data?: Record<string, string | number | undefined> | null;
  updatedAt?: string;
}

export interface PuntoRuta {
  id: RutaLimpieza;
  route: RutaLimpieza;
  name: string;
  /** Qué cantidad se pinta en el punto. */
  note: string;
  zone: ZonaPunto;
  lat: number;
  lon: number;
  scene: string;
  color: string;
  /** Lado del mapa donde se muestra la etiqueta del punto. */
  label: LadoEtiqueta;
  code?: string;
}

export interface Tramo {
  route: RutaLimpieza;
  from: string;
  to: string;
  branch?: boolean;
  sea?: boolean;
}

export interface Viaje {
  key: string;
  buque: string;
  salida: string;
  llegada: string;
  start: number;
  end: number;
  status: EstadoViaje;
  progress: number;
  amount: number;
  containers: number;
}

export interface EstadoAcumulacion {
  unit: Unidad;
  moved: Record<RutaLimpieza, number>;
  passed: Record<RutaLimpieza, number>;
  stock: Record<RutaLimpieza, number>;
  boxes: Record<RutaLimpieza, number>;
  total: number;
  active: Set<string>;
  activeLegs: Set<string>;
  voyages: Viaje[];
}

// Cada ruta tiene su punto donde empieza (R4 sale de Baltra, en Santa Cruz); R2.1, donde
// termina (sale del acopio, que es el punto de R2). Los nombres son los de los trayectos del
// protocolo (packages/types), para que el mapa diga lo mismo que el documento.
const origen = (route: RutaLimpieza) => extremosRuta(route)[0];
const destino = (route: RutaLimpieza) => extremosRuta(route)[1];
// R5 usa la escena del puerto de Guayaquil (en la app original repetía la de Baltra).
// Coordenadas en grados decimales (WGS84). Son referenciales: reemplázalas por las reales.
export const points: readonly PuntoRuta[] = [
  { id: "R1", route: "R1", name: origen("R1"), note: "Recolectado en R1 que aún no pasa a R2 ni a R2.1", zone: "sc", lat: -0.743, lon: -90.315, scene: "zona-urbana", color: "#16a34a", label: "bottom" },
  { id: "R2", route: "R2", name: origen("R2"), note: "Trasladado en R2 que aún no pasa a R3", zone: "sc", lat: -0.705, lon: -90.34, scene: "acopio-temporal", color: "#0d9488", label: "left" },
  { id: "R2.1", route: "R2.1", name: destino("R2.1"), note: "Entregado al relleno sanitario en R2.1", zone: "sc", lat: -0.56, lon: -90.33, scene: "relleno-sanitario", color: "#d97706", label: "left" },
  { id: "R3", route: "R3", name: origen("R3"), note: "Trasladado en R3 que aún no se embarca en R4", zone: "sc", lat: -0.72, lon: -90.295, scene: "patio-contenedores", color: "#0284c7", label: "right" },
  { id: "R4", route: "R4", name: origen("R4"), note: "Embarcado en R4 que aún no pasa a R5", zone: "sc", lat: -0.439, lon: -90.283, scene: "puerto-baltra", color: "#2563eb", label: "right" },
  { id: "R5", route: "R5", name: origen("R5"), note: "Trasladado en R5 que aún no recibe la gestora en R6", zone: "gye", lat: -2.284, lon: -79.911, scene: "puerto-guayaquil", color: "#4f46e5", label: "left" },
  { id: "R6", route: "R6", name: origen("R6"), note: "Recibido por la gestora ambiental en R6", zone: "gye", lat: -2.235, lon: -79.89, scene: "patio-contenedores", color: "#7c3aed", label: "right" },
];

/** The map scene of a route's point. It is also the route's icon in every other view. */
export function escenaRuta(route: string): string {
  return points.find((p) => p.route === route)?.scene ?? points[0].scene;
}

// Destino final del R6; solo marca el final del tramo.
export const destination = { id: "gestion", name: destino("R6"), note: "Destino final del R6", lat: -2.13, lon: -79.94 } as const;

// Tramos que unen los puntos; R4 es el tramo marítimo de Baltra a Guayaquil.
export const legs: readonly Tramo[] = [
  { route: "R1", from: "R1", to: "R2" },
  { route: "R2", from: "R2", to: "R3" },
  { route: "R2.1", from: "R2", to: "R2.1", branch: true },
  { route: "R3", from: "R3", to: "R4" },
  { route: "R4", from: "R4", to: "R5", sea: true },
  { route: "R5", from: "R5", to: "R6" },
  { route: "R6", from: "R6", to: "gestion" },
];

// Trayecto marítimo referencial del R4 [lat, lon]: Baltra, Pacífico, golfo y estero hasta el puerto.
export const seaRoute: ReadonlyArray<readonly [number, number]> = [
  [-0.439, -90.283], [-0.4, -90.2], [-0.62, -89.3], [-1.42, -86.8], [-2.05, -83.8],
  [-2.38, -81.4], [-2.55, -80.85], [-2.8, -80.42], [-2.73, -80.22], [-2.62, -80.1],
  [-2.5, -80.01], [-2.38, -79.95], [-2.284, -79.911],
];

type Datos = Record<string, string | number | undefined>;

// Formulario con el que cada ruta mueve material y fecha del movimiento.
// Carga en contenedores y gestión acreditada no mueven material a otra ruta.
const moves: Record<string, { route: RutaLimpieza; date: (d: Datos) => string | number | undefined }> = {
  recoleccion: { route: "R1", date: (d) => d.fecha },
  patioSCY: { route: "R2", date: (d) => d.fecha },
  relleno: { route: "R2.1", date: (d) => d.recepcion || d.fecha },
  puertoSCY: { route: "R3", date: (d) => d.fecha },
  embarque: { route: "R4", date: (d) => d.fecha },
  patioGYE: { route: "R5", date: (d) => d.fecha },
  recepcion: { route: "R6", date: (d) => d.fecha },
};
// Ruta de la que sale lo que mueve cada ruta.
const previous: Partial<Record<RutaLimpieza, RutaLimpieza>> = { R2: "R1", "R2.1": "R1", R3: "R2", R4: "R3", R5: "R4", R6: "R5" };
const routeOrder: RutaLimpieza[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
const containerRoute: Record<string, RutaLimpieza> = { carga: "R1", patioSCY: "R2", puertoSCY: "R3", embarque: "R4", patioGYE: "R5", recepcion: "R6", gestion: "R6" };

// Punto donde trabaja cada operación (para animarlo) y tramo que mueve cuando se registra.
const pointByKind: Record<string, string> = { recoleccion: "R1", carga: "R2", patioSCY: "R2", relleno: "R2.1", puertoSCY: "R3", patioGYE: "R5", recepcion: "R6", gestion: "R6" };
const legByKind: Record<string, string> = { recoleccion: "R1", patioSCY: "R2", relleno: "R2.1", puertoSCY: "R3", patioGYE: "R5", recepcion: "R6", gestion: "R6" };

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const porRuta = (value: number) => Object.fromEntries(points.map((p) => [p.id, value])) as Record<RutaLimpieza, number>;

// Viajes del R4 (Baltra → Guayaquil): un barco por buque y fecha de salida. Su posición sale del
// reloj: desde las 00:00 del día de salida (hora de Galápagos, UTC−6) hasta las 23:59 del día de
// llegada estimada (hora de Guayaquil, UTC−5), a velocidad constante. Antes de salir queda en
// Baltra (programado); después de llegar, en Guayaquil (arribado) hasta que sus contenedores pasan al R5.
const GALAPAGOS = -6, GUAYAQUIL = -5;
const localMidnight = (date: string, offset: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - offset * 36e5;
};

export function computeVoyages(
  records: readonly RegistroCalculo[],
  { unit = "t", today, now = Date.now() }: { unit?: Unidad; today?: string; now?: number } = {},
): Viaje[] {
  const inR5 = new Set(
    records
      .filter((r) => r.kind === "patioGYE" && r.data?.contenedor && r.data.fecha && (!today || String(r.data.fecha) <= today))
      .map((r) => fold(r.data!.contenedor)),
  );
  const voyages = new Map<string, { key: string; buque: string; salida: string; llegada: string; amount: number; containers: Set<string> }>();
  for (const r of records) {
    const d: Datos = r.data ?? {};
    if (r.kind !== "embarque" || !d.buque || !d.fecha || !d.recepcion) continue;
    if (d.contenedor && inR5.has(fold(d.contenedor))) continue;
    const key = fold(d.buque) + "|" + d.fecha;
    const v = voyages.get(key) ?? { key, buque: String(d.buque), salida: String(d.fecha), llegada: String(d.recepcion), amount: 0, containers: new Set<string>() };
    if (String(d.recepcion) > v.llegada) v.llegada = String(d.recepcion);
    v.amount += Number(d[unit]) || 0;
    if (d.contenedor) v.containers.add(fold(d.contenedor));
    voyages.set(key, v);
  }
  return Array.from(voyages.values())
    .map((v) => {
      const start = localMidnight(v.salida, GALAPAGOS), end = localMidnight(v.llegada, GUAYAQUIL) + 864e5 - 1;
      const status: EstadoViaje = now < start ? "programado" : now > end ? "arribado" : "navegando";
      const progress = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
      return { key: v.key, buque: v.buque, salida: v.salida, llegada: v.llegada, start, end, status, progress, amount: round(v.amount), containers: v.containers.size };
    })
    .sort((a, b) => a.start - b.start || a.buque.localeCompare(b.buque));
}

/**
 * unit: unidad elegida en el tablero. from/to (AAAA-MM-DD, opcionales): limitan los movimientos por fecha.
 * Los movimientos con fecha futura (por ejemplo, un embarque programado) cuentan desde su fecha.
 * now: hora actual (ms) para ubicar los barcos del R4.
 */
export function computeAccumulation(
  records: readonly RegistroCalculo[],
  { unit = "t", from = "", to = "", today, now = Date.now() }: { unit?: Unidad; from?: string; to?: string; today: string; now?: number },
): EstadoAcumulacion {
  const limit = to || today;
  const upto = (d: unknown) => !!d && (!limit || String(d) <= limit);
  const inRange = (d: unknown) => upto(d) && (!from || String(d) >= from);
  const moved = porRuta(0);
  const last = new Map<string | number, number>();

  for (const r of records) {
    const d: Datos = r.data ?? {}, move = moves[r.kind];
    if (move && inRange(move.date(d))) {
      const v = Number(d[unit]) || 0;
      moved[move.route] += v;
    }
    // Contenedores por ruta (según la última ruta registrada para cada código).
    const route = containerRoute[r.kind];
    if (route && d.contenedor && inRange(r.kind === "relleno" ? d.recepcion || d.fecha : d.fecha)) {
      const i = routeOrder.indexOf(route);
      if (i > (last.get(d.contenedor) ?? -1)) last.set(d.contenedor, i);
    }
  }

  // Lo que entró a cada ruta menos lo que ya pasó a la siguiente.
  const passed = porRuta(0);
  for (const [route, origin] of Object.entries(previous) as Array<[RutaLimpieza, RutaLimpieza]>) passed[origin] += moved[route];
  const stock = Object.fromEntries(points.map((p) => [p.id, Math.max(0, round(moved[p.id] - passed[p.id]))])) as Record<RutaLimpieza, number>;
  const total = round(Object.values(stock).reduce((a, b) => a + b, 0));
  const boxes = porRuta(0);
  last.forEach((i) => { boxes[routeOrder[i]]++; });

  const active = new Set<string>(), activeLegs = new Set<string>();
  for (const r of records) {
    const d: Datos = r.data ?? {};
    if (r.kind === "embarque") {
      if (d.fecha === today) { active.add("R4"); activeLegs.add("R4"); }
      if (d.recepcion === today) { active.add("R5"); activeLegs.add("R4"); }
      continue;
    }
    if (d.fecha !== today && d.recepcion !== today) continue;
    if (pointByKind[r.kind]) active.add(pointByKind[r.kind]);
    if (legByKind[r.kind]) activeLegs.add(legByKind[r.kind]);
  }
  const voyages = computeVoyages(records, { unit, today: limit, now });
  return { unit, moved, passed, stock, boxes, total, active, activeLegs, voyages };
}

/**
 * Balance de gestión para el mapa del tramo marítimo y Guayaquil: qué parte de lo que
 * debe salir de Galápagos sigue en Santa Cruz y qué parte ya gestionó la gestora.
 *
 * - Por sacar: lo que sigue en la isla esperando el barco (lo que queda en R1, R2 y R3).
 * - Gestionado: lo que ya llegó a Guayaquil (R5 y R6), lo mismo que cuenta su etiqueta en el mapa.
 * - Lo que va en el barco (R4) ya salió de Galápagos y aún no llega: no cuenta en ninguno.
 *
 * Ambas partes se miden sobre lo que debe ir a Guayaquil: todo lo recolectado menos lo
 * entregado al relleno sanitario (R2.1), que se gestiona en la isla.
 */
export interface BalanceGestion {
  porSacar: number;
  gestionado: number;
  /** Lo que debe ir a Guayaquil. */
  base: number;
  /** 0–1 */
  partePorSacar: number;
  /** 0–1 */
  parteGestionada: number;
}

export function balanceGestion(state: Pick<EstadoAcumulacion, "stock" | "total">): BalanceGestion {
  const { stock } = state;
  const porSacar = round(stock.R1 + stock.R2 + stock.R3);
  const gestionado = round(stock.R5 + stock.R6);
  const base = round(Math.max(0, state.total - stock["R2.1"]));
  const parte = (v: number) => (base > 0 ? Math.min(1, v / base) : 0);
  return { porSacar, gestionado, base, partePorSacar: parte(porSacar), parteGestionada: parte(gestionado) };
}
