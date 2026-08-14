"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { GEO_MAPS } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

const ENABLE_GEO_MOCKS = process.env.NEXT_PUBLIC_ENABLE_GEO_MOCKS === "true";

const GisEditor = dynamic(() => import("@/components/geo/gis/GisEditor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
      Cargando editor GIS…
    </div>
  ),
});

export default function GisEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { user, status } = useAuth();
  // Reading the map is public; editing requires the same GEO grant as the API.
  const canEdit = user?.role === "ADMIN" || user?.apps.includes("geo") === true;
  const canDelete = user?.role?.toUpperCase() === "ADMIN";
  const canAppendFeatures = user?.role === "ADMIN" || (user?.role === "REPORTER" && user?.apps.includes("geo") === true);
  const [geoMap, setGeoMap] = useState<GeoMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const maps = await api.get<GeoMap[]>("/geo/api/maps");
        const found = maps.find((m) => m.id === id)
          ?? (ENABLE_GEO_MOCKS ? GEO_MAPS.find((m) => m.id === id) : undefined);
        if (!found) throw new Error("El mapa solicitado no existe");
        if (!cancelled) {
          setGeoMap(found);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setGeoMap(null);
          setLoadError(apiErrorMessage(error, "No se pudo cargar el mapa"));
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, reloadNonce]);

  // Wait for the map so the editor initializes at the remembered viewport.
  if (!loaded || status === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
        Cargando editor GIS…
      </div>
    );
  }

  if (loadError || !geoMap) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white text-sm text-red-600">
        <p>{loadError ?? "No se pudo cargar el mapa"}</p>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 text-slate-700"
          onClick={() => {
            setLoaded(false);
            setReloadNonce((value) => value + 1);
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <GisEditor
      geoMap={geoMap}
      mapId={id}
      mapTitle={geoMap?.title}
      backHref="/geo/dashboard"
      initialCenter={geoMap?.center}
      initialZoom={geoMap?.zoom}
      canEdit={canEdit}
      canDelete={canDelete}
      canAppendFeatures={canAppendFeatures}
    />
  );
}
