"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { SimatEstacion } from "@pma/types";
import { horaCorta } from "@/lib/simat/formato";

const COLOR: Record<string, string> = {
  IERSE: "#0f766e",
  INAMHI: "#4f46e5",
  FCD: "#64748b",
  METAR: "#d97706",
  MANUAL: "#0ea5e9",
};

const CENTRO: [number, number] = [-0.62, -90.5];
const LIMITES: [[number, number], [number, number]] = [
  [-1.6, -92.2],
  [0.9, -89.0],
];

export default function MapaEstaciones({ estaciones, alto = "320px" }: { estaciones: SimatEstacion[]; alto?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let map: import("leaflet").Map | undefined;
    let cancelado = false;

    void (async () => {
      const L = await import("leaflet");
      if (cancelado || !ref.current) return;
      map = L.map(el, { scrollWheelZoom: false, maxBounds: LIMITES, maxBoundsViscosity: 0.6 }).setView(CENTRO, 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 18,
      }).addTo(map);

      const puntos: Array<[number, number]> = [];
      for (const e of estaciones) {
        if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
        const color = COLOR[e.fuente] ?? "#64748b";
        const marker = L.circleMarker([e.lat, e.lon], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: e.activa ? 0.95 : 0.4,
        }).addTo(map);
        const ult = e.ultimoDato.find((u) => u.variable === "precipitacion") ?? e.ultimoDato[0];
        marker.bindPopup(
          `<strong>${e.nombre}</strong><br>${e.fuente} · ${e.isla}<br>` +
            `${e.activa ? "Activa" : "Inactiva"} · paso ${e.pasoMin} min` +
            (ult ? `<br>Último dato: ${horaCorta(ult.instante)}` : "")
        );
        puntos.push([e.lat, e.lon]);
      }
      if (puntos.length) map.fitBounds(puntos, { padding: [30, 30], maxZoom: 11 });
    })();

    return () => {
      cancelado = true;
      map?.remove();
    };
  }, [estaciones]);

  return <div ref={ref} className="simat-leaflet" style={{ height: alto }} />;
}
