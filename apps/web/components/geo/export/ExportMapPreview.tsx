"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";

import GisMap from "@/components/geo/gis/GisMap";
import type { GisLayer, RasterLayer } from "@/components/geo/gis/types";

import type { BuilderState } from "./types";

export interface ExportMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ExportMapView {
  center: [number, number];
  zoom: number;
  basemap: string;
  bounds?: ExportMapBounds;
}

interface ExportMapPreviewProps {
  layers: GisLayer[];
  rasterLayers: RasterLayer[];
  view: ExportMapView;
  extent: BuilderState["extent"];
  targetBounds?: ExportMapBounds | null;
  sourceMapElement?: HTMLElement | null;
}

function validBounds(bounds: ExportMapBounds | null | undefined): bounds is ExportMapBounds {
  return Boolean(bounds && [bounds.north, bounds.south, bounds.east, bounds.west].every(Number.isFinite));
}

export default function ExportMapPreview({ layers, rasterLayers, view, extent, targetBounds, sourceMapElement }: ExportMapPreviewProps) {
  const [map, setMap] = useState<LeafletMap | null>(null);
  const snapshotRef = useRef<HTMLDivElement>(null);
  const exportBounds = targetBounds ?? null;
  const useCurrentSnapshot = extent === "actual" && Boolean(sourceMapElement);

  useEffect(() => {
    const host = snapshotRef.current;
    if (!host || !sourceMapElement || !useCurrentSnapshot) return;
    const clone = sourceMapElement.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.setAttribute("aria-hidden", "true");
    clone.style.position = "absolute";
    clone.style.left = "50%";
    clone.style.top = "50%";
    clone.style.width = `${sourceMapElement.clientWidth}px`;
    clone.style.height = `${sourceMapElement.clientHeight}px`;
    clone.style.pointerEvents = "none";
    clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
    host.replaceChildren(clone);

    const resize = () => {
      const sourceWidth = Math.max(1, sourceMapElement.clientWidth);
      const sourceHeight = Math.max(1, sourceMapElement.clientHeight);
      const coverScale = Math.max(host.clientWidth / sourceWidth, host.clientHeight / sourceHeight);
      clone.style.transform = `translate(-50%, -50%) scale(${coverScale})`;
      clone.style.transformOrigin = "center";
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => {
      observer.disconnect();
      clone.remove();
    };
  }, [sourceMapElement, useCurrentSnapshot]);

  useEffect(() => {
    if (useCurrentSnapshot) return;
    if (!map) return;
    const target = extent === "actual" ? null : exportBounds;
    if (validBounds(target)) {
      map.fitBounds([[target.south, target.west], [target.north, target.east]], {
        animate: false,
        padding: [16, 16],
        maxZoom: 16,
      });
    } else if (extent === "actual" && validBounds(view.bounds)) {
      map.setView(view.center, view.zoom, { animate: false });
    }
  }, [exportBounds, extent, map, useCurrentSnapshot, view.bounds, view.center, view.zoom]);

  return (
    <div
      data-export-map="leaflet"
      className="gis-shell"
      style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}
      aria-label="Vista cartográfica"
    >
      {/* Static fallback remains visible if external Leaflet tiles reject DOM capture. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/imgs/geo/geo_header.png"
        alt=""
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      {useCurrentSnapshot ? (
        <div ref={snapshotRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }} />
      ) : (
        <div style={{ position: "absolute", inset: 0 }}>
          <GisMap
            layers={layers}
            rasterLayers={rasterLayers}
            basemap={view.basemap}
            initialCenter={view.center}
            initialZoom={view.zoom}
            onMapReady={setMap}
          />
        </div>
      )}
    </div>
  );
}
