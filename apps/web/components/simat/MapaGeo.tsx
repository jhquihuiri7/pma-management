"use client";

import { useEffect, useRef, useState } from "react";
import type { SimatEstacion } from "@pma/types";
import { desmontarMapa, montarMapa, type GeoFeature, type MapaOpciones } from "@/lib/simat/mapa";

// Capa base del IGM (Islas Galápagos, ODbL 1.0), servida como estático.
let islas: Promise<GeoFeature[] | null> | null = null;
function cargarIslas() {
  islas ??= fetch("/simat/islas.json")
    .then((r) => (r.ok ? (r.json() as Promise<GeoFeature[]>) : null))
    .catch(() => null);
  return islas;
}

/** Visor cartográfico de la vista previa sobre la capa del IGM. */
export default function MapaGeo({
  variant,
  island,
  stations,
  selected,
  live,
  latest,
  latestShort,
  onStation,
}: Omit<MapaOpciones, "base" | "stations"> & { stations: SimatEstacion[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<GeoFeature[] | null>(null);
  const onStationRef = useRef(onStation);
  onStationRef.current = onStation;

  useEffect(() => {
    let vivo = true;
    void cargarIslas().then((f) => vivo && setBase(f));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    return () => desmontarMapa(el);
  }, []);

  const clave = [variant, island, base ? "igm" : "esquema", selected, live, latest, latestShort, stations.map((s) => s.id + (s.activa ? "+" : "-")).join(",")].join("|");

  useEffect(() => {
    montarMapa(ref.current, {
      variant,
      island,
      base,
      stations: stations.map((s) => ({ id: s.id, nombre: s.nombre, isla: s.isla, lat: s.lat, lon: s.lon, pasoMin: s.pasoMin, activa: s.activa, fuente: s.fuente })),
      selected,
      live,
      latest,
      latestShort,
      onStation: (id) => onStationRef.current?.(id),
    });
    // `clave` resume todas las entradas del mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return <div ref={ref} id="map" className={`map is-${variant}`} data-variant={variant} />;
}
