"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import type { WorkspaceConfig } from "@/components/geo/rustgis/types";

const RustgisWorkspace = dynamic(() => import("@/components/geo/rustgis/RustgisWorkspace"), {
  ssr: false,
  loading: () => <Loading />,
});

function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white text-sm text-slate-500">
      Cargando Workspace…
    </div>
  );
}

/**
 * The Workspace. The API decides which one this user gets
 * (GEO_WORKSPACE_ENGINE / GEO_WORKSPACE_PILOT_USERS): RustGIS, or the classic
 * Leaflet Workspace, which also serves visitors without a session.
 */
export default function WorkspacePage() {
  const { status } = useAuth();
  const router = useRouter();
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    const classic = () => router.replace(`/geo/workspace/clasico${window.location.search}`);
    if (status !== "authenticated") {
      classic();
      return;
    }
    let cancelled = false;
    api
      .get<WorkspaceConfig>("/geo/workspace/v1/config")
      .then((c) => {
        if (cancelled) return;
        if (c.engine === "rustgis") setConfig(c);
        else classic();
      })
      .catch(() => {
        if (!cancelled) classic();
      });
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  if (!config) return <Loading />;
  return <RustgisWorkspace config={config} />;
}
