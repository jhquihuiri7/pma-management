"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Map,
  TreePine,
  Waves,
  Thermometer,
  Mountain,
  AlertTriangle,
  Shield,
  Scale,
} from "lucide-react";
import { GEO_MAPS, GEO_CATEGORIES } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

const MapViewerLeaflet = dynamic(
  () => import("@/components/geo/MapViewerLeaflet"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-slate-100 text-sm text-slate-500">
        Cargando mapa...
      </div>
    ),
  }
);

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  TreePine, Waves, Thermometer, Mountain, AlertTriangle, Shield, Scale,
};

const CATEGORY_GRADIENT: Record<string, string> = {
  biodiversidad: "from-green-400 to-emerald-600",
  "calidad-agua": "from-blue-400 to-cyan-600",
  clima: "from-orange-400 to-amber-600",
  suelo: "from-amber-400 to-yellow-600",
  riesgo: "from-red-400 to-rose-600",
  protegidas: "from-emerald-400 to-teal-600",
  gobernanza: "from-purple-400 to-violet-600",
};

export default function MapViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [geoMap, setGeoMap] = useState<GeoMap | null>(null);

  useEffect(() => {
    async function loadMap() {
      try {
        const res = await fetch("/geo/api/maps");
        if (res.ok) {
          const maps: GeoMap[] = await res.json();
          const found = maps.find((m) => m.id === id);
          setGeoMap(found || null);
        } else {
          const found = GEO_MAPS.find((m) => m.id === id);
          setGeoMap(found || null);
        }
      } catch (error) {
        console.error(error);
        const found = GEO_MAPS.find((m) => m.id === id);
        setGeoMap(found || null);
      }
    }
    loadMap();
  }, [id]);

  if (!geoMap) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Map className="w-12 h-12 text-slate-300" />
        <p className="text-slate-500 font-medium">Mapa no encontrado</p>
        <a href="/geo/dashboard" className="text-sm text-teal-600 hover:underline">
          Volver al geoportal
        </a>
      </div>
    );
  }

  const category = GEO_CATEGORIES.find((c) => c.id === geoMap.categoryId);
  const Icon = category ? (CATEGORY_ICONS[category.iconName] || Map) : Map;
  const gradient = CATEGORY_GRADIENT[geoMap.categoryId] || "from-slate-400 to-slate-600";

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-white border-b border-slate-200 z-10 flex-shrink-0">
        <a
          href="/geo/dashboard"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </a>

        <div className="h-4 w-px bg-slate-200" />

        <div
          className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0`}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-900 truncate">{geoMap.title}</h1>
          {category && (
            <p className={`text-xs ${category.textClass}`}>{category.name}</p>
          )}
        </div>

        {geoMap.description && (
          <p className="hidden md:block text-xs text-slate-400 truncate max-w-sm">
            {geoMap.description}
          </p>
        )}
      </div>

      {/* Content — fills all remaining height */}
      <div className="flex-1 relative overflow-hidden">
        {geoMap.arcgisUrl ? (
          <iframe
            src={geoMap.arcgisUrl}
            className="absolute inset-0 w-full h-full border-0"
            allow="fullscreen"
            title={geoMap.title}
          />
        ) : (
          <MapViewerLeaflet geoMap={geoMap} />
        )}
      </div>
    </div>
  );
}
