"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoMap, GeoLayer } from "@/types/geo";
import { Layers, Eye, EyeOff } from "lucide-react";

interface Props {
  geoMap: GeoMap;
}

export default function MapViewerLeaflet({ geoMap }: Props) {
  const [layers, setLayers] = useState<GeoLayer[]>(geoMap.layers);
  const [panelOpen, setPanelOpen] = useState(true);

  // Keep layers in sync if geoMap changes
  useEffect(() => {
    setLayers(geoMap.layers);
  }, [geoMap]);

  const toggleLayer = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <div className="relative w-full h-full flex">
      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={geoMap.center}
          zoom={geoMap.zoom}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
        >
          {visibleLayers.map((layer) => (
            <TileLayer
              key={layer.id}
              url={layer.url}
              attribution={layer.attribution}
              opacity={layer.opacity}
            />
          ))}
        </MapContainer>
      </div>

      {/* Layer panel toggle button */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-md border border-slate-200 p-2 hover:bg-slate-50 transition-colors"
        title="Capas"
      >
        <Layers className="w-5 h-5 text-slate-600" />
      </button>

      {/* Layer panel */}
      {panelOpen && (
        <div className="absolute top-4 right-14 z-[1000] bg-white rounded-xl shadow-lg border border-slate-200 w-64 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-sm font-semibold text-slate-700">Capas del mapa</p>
          </div>
          <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {layers.map((layer) => (
              <li key={layer.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <span className="text-sm text-slate-700 truncate">{layer.name}</span>
                <button
                  onClick={() => toggleLayer(layer.id)}
                  className={`ml-3 flex-shrink-0 transition-colors ${
                    layer.visible ? "text-teal-600" : "text-slate-400"
                  }`}
                  title={layer.visible ? "Ocultar" : "Mostrar"}
                >
                  {layer.visible ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {visibleLayers.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4 px-4">
              Activa al menos una capa para ver el mapa.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
