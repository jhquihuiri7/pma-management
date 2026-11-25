"use client";

import dynamic from "next/dynamic";
import { useAuth } from "@/lib/auth-context";

const GisEditor = dynamic(() => import("@/components/geo/gis/GisEditor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
      Cargando Workspace…
    </div>
  ),
});

/**
 * The Workspace before RustGIS (Leaflet), unchanged. /geo/workspace sends here
 * everyone the RustGIS Workspace isn't enabled for (GEO_WORKSPACE_ENGINE), and
 * it stays reachable while the pilot runs (docs/plan-integracion-rustgis.md §9).
 */
export default function ClassicWorkspacePage() {
  const { user, status } = useAuth();

  return (
    <GisEditor
      mode="workspace"
      mapTitle="Workspace"
      backHref="/geo/dashboard"
      initialCenter={[-0.5, -90.5]}
      initialZoom={9}
      canEdit
      canDelete
      signedIn={status === "authenticated" && !!user}
      loginHref="/login?next=%2Fgeo%2Fworkspace%2Fclasico"
    />
  );
}
