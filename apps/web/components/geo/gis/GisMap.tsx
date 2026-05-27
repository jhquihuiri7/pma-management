"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASEMAPS, COLOR_RAMPS } from "./gis-data";
import type { GisLayer, IdentifyInfo, FocusFeature } from "./types";

type ColorFn = (props: Record<string, unknown>) => string;

interface LayerRef {
  geo: L.GeoJSON;
  geojson: GisLayer["geojson"]; // identity used to detect data changes
  styleSig: string; // JSON of style, to detect style-only changes
}

function buildColorFn(layer: GisLayer): ColorFn {
  const { style, geojson } = layer;
  if (style.mode === "single") return () => style.color;

  if (style.mode === "category") {
    const key = style.colorBy;
    if (!key) return () => style.color;
    const palette = COLOR_RAMPS[style.palette] || COLOR_RAMPS.categorical;
    const uniqValues = Array.from(new Set(geojson.features.map((f) => (f.properties || {})[key])));
    const map = new Map<unknown, string>();
    uniqValues.forEach((v, i) => map.set(v, palette[i % palette.length]));
    return (props) => map.get(props[key]) || "#888";
  }

  if (style.mode === "ramp") {
    const key = style.colorBy;
    if (!key) return () => style.color;
    const ramp = COLOR_RAMPS[style.ramp] || COLOR_RAMPS.greens;
    const values = geojson.features.map((f) => (f.properties || {})[key]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return () => style.color;
    const sorted = [...values].sort((a, b) => a - b);
    const classes = style.classes || 5;
    const breaks: number[] = [];

    if (style.classification === "quantile" || style.classification === "jenks") {
      for (let i = 1; i < classes; i++) breaks.push(sorted[Math.floor((sorted.length * i) / classes)]);
    } else {
      const min = sorted[0], max = sorted[sorted.length - 1];
      const step = (max - min) / classes;
      for (let i = 1; i < classes; i++) breaks.push(min + step * i);
    }

    const colors: string[] = [];
    for (let i = 0; i < classes; i++) {
      const t = classes === 1 ? 0 : i / (classes - 1);
      colors.push(ramp[Math.round(t * (ramp.length - 1))]);
    }

    return (props) => {
      const v = props[key];
      if (typeof v !== "number") return "#888";
      let idx = 0;
      while (idx < breaks.length && v > breaks[idx]) idx++;
      return colors[idx];
    };
  }

  return () => style.color;
}

// Per-feature vector style for polygons/lines (points are styled on the marker).
function pathStyleFor(layer: GisLayer, colorFn: ColorFn) {
  return (feature?: GeoJSON.Feature): L.PathOptions => {
    const c = colorFn((feature?.properties || {}) as Record<string, unknown>);
    if (layer.geometry === "LineString") {
      return { color: c, weight: layer.style.strokeWidth + 1.5, opacity: layer.style.opacity };
    }
    return {
      color: "#333333", weight: layer.style.strokeWidth, opacity: layer.style.opacity,
      fillColor: c, fillOpacity: layer.style.opacity * 0.78,
    };
  };
}

interface Props {
  layers: GisLayer[];
  basemap: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  onIdentify?: (info: IdentifyInfo) => void;
  onCoordChange?: (c: [number, number]) => void;
  onViewportChange?: (center: [number, number], zoom: number) => void;
  focusFeature?: FocusFeature | null;
  onMapReady?: (map: L.Map) => void;
}

export default function GisMap({ layers, basemap, initialCenter, initialZoom, onIdentify, onCoordChange, onViewportChange, focusFeature, onMapReady }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const basemapRef = useRef<L.TileLayer | null>(null);
  const layerRefs = useRef<Map<string, LayerRef>>(new Map());
  const labelLayerRef = useRef<L.FeatureGroup | null>(null);
  const cbRef = useRef({ onIdentify, onCoordChange, onMapReady, onViewportChange });
  cbRef.current = { onIdentify, onCoordChange, onMapReady, onViewportChange };

  // Init (once)
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: initialCenter ?? [-1.6, -78.5],
      zoom: initialZoom ?? 7,
      zoomControl: false,
      attributionControl: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapRef.current = map;

    const base = BASEMAPS[basemap];
    basemapRef.current = L.tileLayer(base.url, { attribution: base.attribution, maxZoom: 19 }).addTo(map);
    labelLayerRef.current = L.featureGroup().addTo(map);

    map.on("mousemove", (e: L.LeafletMouseEvent) => cbRef.current.onCoordChange?.([e.latlng.lat, e.latlng.lng]));
    // Report viewport on user-driven pan/zoom so the editor can remember it.
    map.on("moveend", () => {
      const c = map.getCenter();
      cbRef.current.onViewportChange?.([c.lat, c.lng], map.getZoom());
    });
    cbRef.current.onMapReady?.(map);

    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 400);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (basemapRef.current) map.removeLayer(basemapRef.current);
    const base = BASEMAPS[basemap];
    basemapRef.current = L.tileLayer(base.url, { attribution: base.attribution, maxZoom: 19 }).addTo(map);
    if (basemapRef.current.bringToBack) basemapRef.current.bringToBack();
  }, [basemap]);

  // Reconcile layers incrementally: only rebuild what actually changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !labelLayerRef.current) return;

    const ids = new Set(layers.map((l) => l.id));
    Array.from(layerRefs.current.entries()).forEach(([id, ref]) => {
      if (!ids.has(id)) { map.removeLayer(ref.geo); layerRefs.current.delete(id); }
    });

    labelLayerRef.current.clearLayers();

    layers.forEach((layer) => {
      const ref = layerRefs.current.get(layer.id);

      // Hidden → drop any existing rendering.
      if (!layer.visible) {
        if (ref) { map.removeLayer(ref.geo); layerRefs.current.delete(layer.id); }
        return;
      }

      const colorFn = buildColorFn(layer);
      const styleSig = JSON.stringify(layer.style);
      const styleFn = pathStyleFor(layer, colorFn);

      const dataChanged = !ref || ref.geojson !== layer.geojson;

      if (dataChanged) {
        if (ref) map.removeLayer(ref.geo);
        const geo = L.geoJSON(layer.geojson, {
          style: styleFn as L.StyleFunction,
          pointToLayer: (feature, latlng) => {
            const c = colorFn((feature.properties || {}) as Record<string, unknown>);
            return L.circleMarker(latlng, {
              radius: layer.style.size, fillColor: c, color: "#ffffff",
              weight: 1.5, opacity: layer.style.opacity, fillOpacity: layer.style.opacity,
            });
          },
          onEachFeature: (feature, lyr) => {
            lyr.on("click", (e: L.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(e);
              cbRef.current.onIdentify?.({ layerId: layer.id, layerName: layer.name, feature, latlng: e.latlng });
            });
            lyr.on("mouseover", function (this: L.Path) {
              if (layer.geometry !== "Point") this.setStyle({ weight: (layer.style.strokeWidth || 1) + 1.5, color: "#0a0a0a" });
            });
            lyr.on("mouseout", function (this: L.Path) { geo.resetStyle(this); });
          },
        });
        geo.addTo(map);
        layerRefs.current.set(layer.id, { geo, geojson: layer.geojson, styleSig });
      } else if (ref.styleSig !== styleSig) {
        // Style-only change: restyle in place (cheap) instead of rebuilding.
        ref.geo.options.style = styleFn as L.StyleFunction; // keep resetStyle in sync
        ref.geo.setStyle(styleFn as L.StyleFunction);
        ref.geo.eachLayer((l) => {
          const cm = l as L.CircleMarker & { setRadius?: (r: number) => void };
          if (typeof cm.setRadius === "function") {
            const c = colorFn(((l as L.Layer & { feature?: GeoJSON.Feature }).feature?.properties || {}) as Record<string, unknown>);
            cm.setStyle({ fillColor: c, opacity: layer.style.opacity, fillOpacity: layer.style.opacity });
            cm.setRadius(layer.style.size);
          }
        });
        ref.styleSig = styleSig;
      }

      // Labels (rebuilt each pass; cheap when disabled).
      if (layer.style.labels && layer.style.labelField) {
        const field = layer.style.labelField;
        layer.geojson.features.forEach((f) => {
          let latlng: [number, number] | null = null;
          const g = f.geometry;
          if (g?.type === "Point") latlng = [g.coordinates[1], g.coordinates[0]];
          else if (g?.type === "Polygon") {
            const coords = g.coordinates[0];
            const c = coords.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
            latlng = [c[1] / coords.length, c[0] / coords.length];
          } else if (g?.type === "LineString") {
            const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
            latlng = [mid[1], mid[0]];
          }
          if (!latlng) return;
          labelLayerRef.current!.addLayer(
            L.marker(latlng, {
              interactive: false,
              icon: L.divIcon({
                className: "map-label",
                html: `<div style="font-family: var(--font-sans); font-size: 10.5px; font-weight: 600; color: #1a1a1a; text-shadow: 0 0 3px rgba(255,255,255,0.85), 0 0 3px rgba(255,255,255,0.85); white-space: nowrap; pointer-events: none; transform: translate(-50%, -50%);">${(f.properties || {})[field] ?? ""}</div>`,
                iconSize: [0, 0],
              }),
            })
          );
        });
      }
    });

    // Enforce stacking order: array is top-first, so push from bottom up.
    [...layers].reverse().forEach((l) => layerRefs.current.get(l.id)?.geo.bringToFront());
    labelLayerRef.current.bringToFront();
    // NOTE: no auto-fit here on purpose — style/visibility/order changes must
    // never move the user's view. First-layer framing is handled by the editor.
  }, [layers]);

  // Focus a feature when requested
  useEffect(() => {
    if (!focusFeature) return;
    const map = mapRef.current;
    const ref = layerRefs.current.get(focusFeature.layerId);
    if (!map || !ref) return;
    ref.geo.eachLayer((l) => {
      const lyr = l as L.Layer & { feature?: GeoJSON.Feature; getBounds?: () => L.LatLngBounds; getLatLng?: () => L.LatLng };
      const fid = lyr.feature?.properties?.id || JSON.stringify(lyr.feature?.properties);
      const target = focusFeature.feature?.properties?.id || JSON.stringify(focusFeature.feature?.properties);
      if (fid === target) {
        if (lyr.getBounds) map.fitBounds(lyr.getBounds(), { padding: [80, 80], maxZoom: 11 });
        else if (lyr.getLatLng) map.flyTo(lyr.getLatLng(), Math.max(map.getZoom(), 10));
      }
    });
  }, [focusFeature]);

  return <div className="gis-map" ref={containerRef} />;
}
