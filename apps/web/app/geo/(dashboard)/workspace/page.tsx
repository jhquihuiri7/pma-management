"use client";

import dynamic from "next/dynamic";

const GisEditor = dynamic(() => import("@/components/geo/gis/GisEditor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
      Cargando Workspace…
    </div>
  ),
});

export default function WorkspacePage() {
  return (
    <GisEditor
      mode="workspace"
      mapTitle="Workspace"
      backHref="/geo/dashboard"
      initialCenter={[-0.5, -90.5]}
      initialZoom={9}
      canEdit
      canDelete
    />
  );
}
