import { randomUUID } from "node:crypto";

/**
 * The reports being written. Writing one takes minutes on the local model, so
 * the request only starts it and the browser polls. Jobs run one at a time
 * (the model answers one request at a time anyway) and live in memory: a
 * restart loses them and the browser says so. A finished file is kept for 30
 * minutes for its owner to download.
 */

export type EstadoTrabajo = "en_cola" | "redactando" | "listo" | "error";

export interface Trabajo {
  id: string;
  usuarioId: string;
  estado: EstadoTrabajo;
  paso: number;
  pasos: number;
  detalle: string;
  avisos: string[];
  error: string | null;
  nombreArchivo: string;
  archivo: Buffer | null;
  creado: number;
  terminado: number | null;
}

export type Avance = (paso: number, pasos: number, detalle: string) => void;
export type Tarea = (avance: Avance, aviso: (texto: string) => void) => Promise<Buffer>;

const CONSERVAR_MS = 30 * 60_000;
const trabajos = new Map<string, Trabajo>();
let cola: Promise<void> = Promise.resolve();

function purgar(ahora = Date.now()): void {
  for (const [id, t] of trabajos) if (t.terminado !== null && ahora - t.terminado > CONSERVAR_MS) trabajos.delete(id);
}

export function trabajoActivoDe(usuarioId: string): Trabajo | null {
  purgar();
  for (const t of trabajos.values()) if (t.usuarioId === usuarioId && (t.estado === "en_cola" || t.estado === "redactando")) return t;
  return null;
}

export function crearTrabajo(usuarioId: string, nombreArchivo: string, tarea: Tarea): Trabajo {
  purgar();
  const t: Trabajo = {
    id: randomUUID(),
    usuarioId,
    estado: "en_cola",
    paso: 0,
    pasos: 0,
    detalle: "",
    avisos: [],
    error: null,
    nombreArchivo,
    archivo: null,
    creado: Date.now(),
    terminado: null,
  };
  trabajos.set(t.id, t);
  cola = cola.then(async () => {
    t.estado = "redactando";
    try {
      t.archivo = await tarea(
        (paso, pasos, detalle) => Object.assign(t, { paso, pasos, detalle }),
        (texto) => t.avisos.push(texto),
      );
      t.estado = "listo";
    } catch (error) {
      t.estado = "error";
      t.error = error instanceof Error ? error.message : String(error);
    } finally {
      t.terminado = Date.now();
    }
  });
  return t;
}

/** A job of this user, or null (unknown, expired or someone else's). */
export function obtenerTrabajo(id: string, usuarioId: string): Trabajo | null {
  purgar();
  const t = trabajos.get(id);
  return t && t.usuarioId === usuarioId ? t : null;
}

/** How many jobs run or wait before this one (0 once it runs). */
export function posicionEnCola(t: Trabajo): number {
  if (t.estado !== "en_cola") return 0;
  let n = 0;
  for (const otro of trabajos.values()) {
    if (otro !== t && (otro.estado === "redactando" || (otro.estado === "en_cola" && otro.creado < t.creado))) n += 1;
  }
  return n;
}
