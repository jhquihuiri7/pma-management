"use client";

import type { CoeActividad } from "@/types";
import { claveInstitucion } from "@/lib/coeReporte";

// Event → institution → island diagram of the original board, ported as is:
// one row per institution within each event, curves weighted by the number of
// activities, and the exact quantities in a table below.

// teal-600, sky-600, amber-600, violet-600, rose-600, emerald-600
const COLORES = ["#0d9488", "#0284c7", "#d97706", "#7c3aed", "#e11d48", "#059669"];
const numero = new Intl.NumberFormat("es-EC");

interface Institucion {
  nombre: string;
  cuenta: number;
  islas: Map<string, number>;
}
interface Evento {
  id: string;
  nombre: string;
  cuenta: number;
  instituciones: Map<string, Institucion>;
}

const recortar = (texto: string, max: number) => (texto.length > max ? `${texto.slice(0, max - 1)}…` : texto);

export default function DiagramaConexiones({
  filas,
  eventos,
  onElegirEvento,
}: {
  filas: CoeActividad[];
  eventos: Map<string, string>;
  onElegirEvento: (id: string) => void;
}) {
  if (!filas.length) return <p className="py-6 text-center text-sm text-slate-500">Sin conexiones para estos filtros.</p>;

  const porEvento = new Map<string, Evento>();
  const porIsla = new Map<string, number>();
  for (const fila of filas) {
    const clave = claveInstitucion(fila.institucion);
    const isla = fila.isla || "Sin isla indicada";
    if (!porEvento.has(fila.evento)) {
      porEvento.set(fila.evento, { id: fila.evento, nombre: eventos.get(fila.evento) ?? fila.evento, cuenta: 0, instituciones: new Map() });
    }
    const evento = porEvento.get(fila.evento)!;
    if (!evento.instituciones.has(clave)) {
      evento.instituciones.set(clave, { nombre: fila.institucion?.trim() || "Sin institución indicada", cuenta: 0, islas: new Map() });
    }
    const institucion = evento.instituciones.get(clave)!;
    institucion.islas.set(isla, (institucion.islas.get(isla) ?? 0) + 1);
    institucion.cuenta += 1;
    evento.cuenta += 1;
    porIsla.set(isla, (porIsla.get(isla) ?? 0) + 1);
  }

  const izquierda = Array.from(porEvento.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const derecha = Array.from(porIsla).sort(([a], [b]) => a.localeCompare(b, "es"));
  const medio = izquierda.flatMap((evento, i) =>
    Array.from(evento.instituciones.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      .map((item) => ({ ...item, evento, color: COLORES[i % COLORES.length], y: 0 })),
  );
  const alto = Math.max(174, 72 + Math.max(medio.length, derecha.length) * 34);
  const filaY = (i: number, n: number) => (n === 1 ? (alto + 22) / 2 : 52 + (i * (alto - 80)) / (n - 1));
  const islas = new Map(derecha.map(([nombre, cuenta], i) => [nombre, { nombre, cuenta, y: filaY(i, derecha.length) }]));
  const nodosEvento = new Map<string, { primero: number; ultimo: number; color: string }>();
  medio.forEach((item, i) => {
    item.y = filaY(i, medio.length);
    const nodo = nodosEvento.get(item.evento.id);
    if (!nodo) nodosEvento.set(item.evento.id, { primero: item.y, ultimo: item.y, color: item.color });
    else nodo.ultimo = item.y;
  });
  const centro = (id: string) => {
    const nodo = nodosEvento.get(id)!;
    return (nodo.primero + nodo.ultimo) / 2;
  };
  const aristas = medio.flatMap((item) =>
    Array.from(item.islas).sort(([a], [b]) => a.localeCompare(b, "es")).map(([nombre, cuenta]) => ({ item, destino: islas.get(nombre)!, cuenta })),
  );
  const maximo = medio.reduce((m, item) => Math.max(m, item.cuenta), 1);

  const curva = (x1: number, y1: number, x2: number, y2: number, cuenta: number, color: string, titulo: string, key: string) => {
    const d = (x2 - x1) * 0.48;
    return (
      <path
        key={key}
        d={`M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={1 + 9 * Math.sqrt(cuenta / maximo)}
        strokeOpacity={0.65}
        strokeLinecap="round"
      >
        <title>{`${titulo} · ${numero.format(cuenta)}`}</title>
      </path>
    );
  };
  const etiqueta = (nombre: string, cuenta: number, x: number, y: number, max: number) => (
    <text x={x} y={y} dominantBaseline="middle" fill="#0f172a" fontWeight={650} fontSize={14}>
      {recortar(nombre, max)}
      <title>{`${nombre} · ${numero.format(cuenta)}`}</title>
    </text>
  );
  const cifra = (cuenta: number, x: number, y: number) => (
    <text x={x} y={y} textAnchor="end" dominantBaseline="middle" fill="#475569" fontWeight={700} fontSize={14}>
      {numero.format(cuenta)}
    </text>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto" role="region" aria-label="Diagrama de conexiones" tabIndex={0}>
        <svg
          viewBox={`0 0 1240 ${alto}`}
          className="min-w-[860px]"
          role="img"
          aria-label="Conexiones entre eventos, instituciones e islas. Las cantidades exactas están en la tabla debajo del diagrama."
        >
          {([[17, "EVENTO"], [436, "INSTITUCIÓN"], [1007, "ISLA"]] as const).map(([x, t]) => (
            <text key={t} x={x} y={23} fill="#64748b" fontSize={11} fontWeight={750} letterSpacing="0.08em">{t}</text>
          ))}
          {medio.map((item, i) =>
            curva(254, centro(item.evento.id), 419, item.y, item.cuenta, item.color, `${item.evento.nombre} → ${item.nombre}`, `a${i}`))}
          {aristas.map(({ item, destino, cuenta }, i) =>
            curva(756, item.y, 990, destino.y, cuenta, item.color, `${item.evento.nombre} → ${item.nombre} → ${destino.nombre}`, `b${i}`))}
          {izquierda.map((evento) => {
            const y = centro(evento.id);
            return (
              <g key={evento.id}>
                {etiqueta(evento.nombre, evento.cuenta, 17, y, 27)}
                {cifra(evento.cuenta, 234, y)}
                <circle cx={254} cy={y} r={5} fill={nodosEvento.get(evento.id)!.color} />
              </g>
            );
          })}
          {medio.map((item, i) => (
            <g key={`m${i}`}>
              <circle cx={419} cy={item.y} r={5} fill={item.color} />
              {etiqueta(item.nombre, item.cuenta, 436, item.y, 37)}
              {cifra(item.cuenta, 735, item.y)}
              <circle cx={756} cy={item.y} r={5} fill={item.color} />
            </g>
          ))}
          {Array.from(islas.values()).map(({ nombre, cuenta, y }) => (
            <g key={nombre}>
              <circle cx={990} cy={y} r={5} fill="#475569" />
              {etiqueta(nombre, cuenta, 1007, y, 24)}
              {cifra(cuenta, 1223, y)}
            </g>
          ))}
        </svg>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-teal-700">Ver cantidades por conexión</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3">Evento</th>
                <th scope="col" className="py-2 pr-3">Institución</th>
                <th scope="col" className="py-2 pr-3">Isla</th>
                <th scope="col" className="py-2">Actividades</th>
              </tr>
            </thead>
            <tbody>
              {aristas.map(({ item, destino, cuenta }, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-3">
                    <button type="button" className="text-left font-medium text-teal-700 hover:underline" onClick={() => onElegirEvento(item.evento.id)}>
                      {item.evento.nombre}
                    </button>
                  </td>
                  <td className="py-2 pr-3">{item.nombre}</td>
                  <td className="py-2 pr-3">{destino.nombre}</td>
                  <td className="py-2">{numero.format(cuenta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
