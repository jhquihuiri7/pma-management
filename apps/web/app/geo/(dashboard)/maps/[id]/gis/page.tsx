"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { GEO_MAPS } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

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
  // Any logged-in geo user (incl. VIEWER) can edit; only ADMIN can delete layers.
  const canEdit = !!user;
  const canDelete = user?.role?.toUpperCase() === "ADMIN";
  const [geoMap, setGeoMap] = useState<GeoMap | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let found: GeoMap | undefined;
      try {
        const res = await apiFetch("/geo/api/maps");
        if (res.ok) {
          const maps: GeoMap[] = await res.json();
          found = maps.find((m) => m.id === id);
        }
      } catch {
        /* fall through to mock */
      }
      if (!found) found = GEO_MAPS.find((m) => m.id === id);
      if (!cancelled) { setGeoMap(found ?? null); setLoaded(true); }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  // Wait for the map so the editor initializes at the remembered viewport.
  if (!loaded || status === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
        Cargando editor GIS…
      </div>
    );
  }

  return (
    <GisEditor
      mapId={id}
      mapTitle={geoMap?.title}
      backHref="/geo/dashboard"
      initialCenter={geoMap?.center}
      initialZoom={geoMap?.zoom}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
