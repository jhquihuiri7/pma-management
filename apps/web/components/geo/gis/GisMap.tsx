"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS } from "./gis-data";
import { buildSymbolizer, escapeHtml, labelAnchor, markerSvg, resolveLabelStyle, type ResolvedSymbol } from "./symbology";
import type { Feature, Geometry, Position } from "geojson";
import type { GisLayer, GisTool, RasterLayer, IdentifyInfo, FocusFeature } from "./types";

interface LayerRef {
  geo: L.GeoJSON;
  /** Lines with a casing: the wider strokes, drawn under `geo`. */
  casing: L.GeoJSON | null;
  geojson: GisLayer["geojson"]; // identity used to detect data changes
  styleSig: string; // JSON of style, to detect style-only changes
}

type FeatureProps = Record<string, unknown> | null | undefined;

function hasOutline(sym: ResolvedSymbol): boolean {
  return !!sym.strokeColor && sym.strokeWidth > 0;
}

// Per-feature vector style for polygons/lines (points are styled on the marker).
function pathOptions(sym: ResolvedSymbol): L.PathOptions {
  if (sym.geometry === "LineString") {
    return {
      color: sym.color, weight: sym.strokeWidth, opacity: sym.strokeOpacity,
      dashArray: sym.dash ?? undefined, lineCap: sym.dash ? "butt" : "round", lineJoin: "round",
    };
  }
  return {
    stroke: hasOutline(sym), color: sym.strokeColor ?? undefined, weight: sym.strokeWidth, opacity: sym.strokeOpacity,
    dashArray: sym.dash ?? undefined, fill: true, fillColor: sym.color, fillOpacity: sym.fillOpacity,
  };
}

function casingOptions(sym: ResolvedSymbol): L.PathOptions {
  return { color: sym.casingColor ?? undefined, weight: sym.casingWidth, opacity: sym.strokeOpacity, lineCap: "round", lineJoin: "round" };
}

function hasCasingSymbol(sym: ResolvedSymbol): boolean {
  return !!sym.casingColor && sym.casingWidth > 0;
}

function pointLayer(sym: ResolvedSymbol, latlng: L.LatLng): L.Layer {
  if (sym.marker === "circle" && !(sym.haloColor && sym.haloSize > 0)) {
    return L.circleMarker(latlng, {
      radius: sym.size / 2, fillColor: sym.color, fillOpacity: sym.fillOpacity,
      stroke: hasOutline(sym), color: sym.strokeColor ?? undefined, weight: sym.strokeWidth, opacity: sym.strokeOpacity,
    });
  }
  const { svg, box } = markerSvg(sym);
  return L.marker(latlng, {
    keyboard: false,
    icon: L.divIcon({ html: svg, className: "gis-marker", iconSize: [box, box], iconAnchor: [box / 2, box / 2] }),
  });
}

function haloShadow(color: string | null, width: number): string {
  if (!color || width <= 0) return "none";
  const w = Math.round(width * 10) / 10;
  return `0 0 ${w}px ${color}, 0 0 ${w}px ${color}, 0 0 1px ${color}`;
}

interface Props {
  layers: GisLayer[];
  rasterLayers?: RasterLayer[];
  basemap: string;
  tool?: GisTool;
  initialCenter?: [number, number];
  initialZoom?: number;
  onIdentify?: (info: IdentifyInfo) => void;
  onCoordChange?: (c: [number, number]) => void;
  onViewportChange?: (center: [number, number], zoom: number) => void;
  onPointInspect?: (c: [number, number]) => void;
  inspectPoint?: [number, number] | null;
  focusFeature?: FocusFeature | null;
  onMapReady?: (map: L.Map) => void;
  onDrawGeometry?: (geometry: Geometry) => void;
  onDrawCancel?: () => void;
  previewGeometry?: Geometry | null;
}

/** Shows each layer's labels only from its minimum zoom on. */
function applyLabelZoom(map: L.Map, labelLayer: L.FeatureGroup | null, groups: Array<{ minZoom: number | null; group: L.LayerGroup }>) {
  if (!labelLayer) return;
  const zoom = map.getZoom();
  for (const { minZoom, group } of groups) {
    const show = minZoom === null || zoom >= minZoom - 1e-6;
    if (show && !labelLayer.hasLayer(group)) labelLayer.addLayer(group);
    else if (!show && labelLayer.hasLayer(group)) labelLayer.removeLayer(group);
  }
}

/**
 * Both basemap flavours land in `tilePane`, so the pane order that keeps
 * orthophotos under vectors holds either way. The vector branch goes through
 * MapLibre, which has no `bringToBack` — hence the narrowing at the call site
 * rather than a duck-typed check.
 */
function createBasemapLayer(key: string): L.Layer {
  const base = BASEMAPS[key];
  if (base.kind === "vector") {
    return L.maplibreGL({
      style: base.style,
      attributionControl: { customAttribution: base.attribution },
    });
  }
  return L.tileLayer(base.url, { attribution: base.attribution, maxZoom: 19 });
}

export default function GisMap({ layers, rasterLayers, basemap, tool = "pan", initialCenter, initialZoom, onIdentify, onCoordChange, onViewportChange, onPointInspect, inspectPoint, focusFeature, onMapReady, onDrawGeometry, onDrawCancel, previewGeometry }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const basemapRef = useRef<L.Layer | null>(null);
  const layerRefs = useRef<Map<string, LayerRef>>(new Map());
  const rasterRefs = useRef<Map<string, L.TileLayer>>(new Map());
  const labelLayerRef = useRef<L.FeatureGroup | null>(null);
  // Labels per layer, shown from their minimum zoom on (applyLabelZoom).
  const labelGroupsRef = useRef<Array<{ minZoom: number | null; group: L.LayerGroup }>>([]);
  const inspectMarkerRef = useRef<L.Marker | null>(null);
  const previewRef = useRef<L.GeoJSON | null>(null);
  const cbRef = useRef({ onIdentify, onCoordChange, onMapReady, onViewportChange, onPointInspect, onDrawGeometry, onDrawCancel, tool });
  cbRef.current = { onIdentify, onCoordChange, onMapReady, onViewportChange, onPointInspect, onDrawGeometry, onDrawCancel, tool };

  // Init (once)
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: initialCenter ?? [-0.5, -90.5],
      zoom: initialZoom ?? 9,
      zoomControl: false,
      attributionControl: true,
    });
    mapRef.current = map;

    basemapRef.current = createBasemapLayer(basemap).addTo(map);

    // Dedicated pane for raster tiles, between the basemap (tilePane, z=200) and
    // the vector overlays (overlayPane, z=400) — so orthophotos always sit under
    // shapefiles/points/lines regardless of add order.
    map.createPane("rasters");
    const rasterPane = map.getPane("rasters");
    if (rasterPane) rasterPane.style.zIndex = "250";

    labelLayerRef.current = L.featureGroup().addTo(map);
    map.on("zoomend", () => applyLabelZoom(map, labelLayerRef.current, labelGroupsRef.current));

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
    const layer = createBasemapLayer(basemap).addTo(map);
    basemapRef.current = layer;
    if (layer instanceof L.TileLayer) layer.bringToBack();
  }, [basemap]);

  // Reconcile raster (orthophoto) tile layers. Only 'processed' + visible layers
  // are drawn; opacity/visibility/order changes update in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const rasters = rasterLayers ?? [];
    const ids = new Set(rasters.map((r) => r.id));

    Array.from(rasterRefs.current.entries()).forEach(([id, tl]) => {
      if (!ids.has(id)) { map.removeLayer(tl); rasterRefs.current.delete(id); }
    });

    rasters.forEach((r) => {
      const show = r.visible && r.status === "processed";
      const existing = rasterRefs.current.get(r.id);
      if (!show) {
        if (existing) { map.removeLayer(existing); rasterRefs.current.delete(r.id); }
        return;
      }
      if (!existing) {
        // maxZoom 19 matches the map/basemap ceiling (default would cap rasters at
        // 18 and hide them at z19); TiTiler oversamples beyond native resolution.
        const opts: L.TileLayerOptions = { pane: "rasters", opacity: r.opacity, zIndex: r.zIndex, maxZoom: 19 };
        if (r.bbox) opts.bounds = L.latLngBounds([[r.bbox[1], r.bbox[0]], [r.bbox[3], r.bbox[2]]]);
        const tl = L.tileLayer(r.tileUrl, opts).addTo(map);
        rasterRefs.current.set(r.id, tl);
      } else {
        existing.setOpacity(r.opacity);
        existing.setZIndex(r.zIndex);
      }
    });
  }, [rasterLayers]);

  // Reconcile layers incrementally: only rebuild what actually changed.
  useEffect(() => {
    const map = mapRef.current;
    const labelLayer = labelLayerRef.current;
    if (!map || !labelLayer) return;

    const drop = (ref: LayerRef) => {
      map.removeLayer(ref.geo);
      if (ref.casing) map.removeLayer(ref.casing);
    };
    const ids = new Set(layers.map((l) => l.id));
    Array.from(layerRefs.current.entries()).forEach(([id, ref]) => {
      if (!ids.has(id)) { drop(ref); layerRefs.current.delete(id); }
    });

    labelLayer.clearLayers();
    labelGroupsRef.current = [];

    layers.forEach((layer) => {
      const ref = layerRefs.current.get(layer.id);

      // Hidden → drop any existing rendering.
      if (!layer.visible) {
        if (ref) { drop(ref); layerRefs.current.delete(layer.id); }
        return;
      }

      const symbolizer = buildSymbolizer(layer);
      const symbolOf = (feature?: Feature) => symbolizer.symbolFor((feature?.properties || {}) as FeatureProps);
      const styleSig = JSON.stringify(layer.style);
      const styleFn = (feature?: Feature) => pathOptions(symbolOf(feature));

      // Points are markers, restyled by rebuilding them; paths restyle in place.
      const dataChanged = !ref || ref.geojson !== layer.geojson || (layer.geometry === "Point" && ref.styleSig !== styleSig);
      const buildCasing = () => {
        if (layer.geometry !== "LineString" || !symbolizer.classes.some((c) => hasCasingSymbol(c.symbol))) return null;
        return L.geoJSON(layer.geojson, {
          interactive: false,
          filter: (feature) => hasCasingSymbol(symbolOf(feature)),
          style: (feature) => casingOptions(symbolOf(feature)),
        }).addTo(map);
      };

      if (dataChanged) {
        if (ref) drop(ref);
        const casing = buildCasing();
        const geo = L.geoJSON(layer.geojson, {
          style: styleFn as L.StyleFunction,
          pointToLayer: (feature, latlng) => pointLayer(symbolOf(feature), latlng),
          onEachFeature: (feature, lyr) => {
            lyr.on("click", (e: L.LeafletMouseEvent) => {
              // While measuring or inspecting a point, let the click bubble to the
              // map so it adds a vertex / drops the inspection pin.
              if (cbRef.current.tool === "measure" || cbRef.current.tool === "inspect" || cbRef.current.tool.startsWith("draw-")) return;
              L.DomEvent.stopPropagation(e);
              cbRef.current.onIdentify?.({ layerId: layer.id, layerName: layer.name, feature, latlng: e.latlng });
            });
            lyr.on("mouseover", function (this: L.Path) {
              if (layer.geometry !== "Point") this.setStyle({ stroke: true, weight: symbolOf(feature).strokeWidth + 1.5, color: "#0a0a0a" });
            });
            lyr.on("mouseout", function (this: L.Path) { geo.resetStyle(this); });
          },
        });
        geo.addTo(map);
        layerRefs.current.set(layer.id, { geo, casing, geojson: layer.geojson, styleSig });
      } else if (ref.styleSig !== styleSig) {
        // Style-only change: restyle in place (cheap) instead of rebuilding.
        ref.geo.options.style = styleFn as L.StyleFunction; // keep resetStyle in sync
        ref.geo.setStyle(styleFn as L.StyleFunction);
        if (ref.casing) map.removeLayer(ref.casing);
        ref.casing = buildCasing();
        ref.styleSig = styleSig;
      }

      // Labels (rebuilt each pass; cheap when disabled).
      if (layer.style.labels && layer.style.labelField) {
        const field = layer.style.labelField;
        const ls = resolveLabelStyle(layer.style);
        const css =
          `font-family: var(--font-sans); font-size: ${ls.size}px; font-weight: ${ls.bold ? 600 : 400}; color: ${ls.color}; ` +
          `text-shadow: ${haloShadow(ls.haloColor, ls.haloWidth)}; white-space: nowrap; pointer-events: none;`;
        const group = L.layerGroup();
        layer.geojson.features.forEach((f) => {
          const value = (f.properties || {})[field];
          if (value === null || value === undefined || value === "") return;
          const sym = symbolOf(f);
          if (!sym.labeled) return;
          const at = labelAnchor(f.geometry);
          if (!at) return;
          // Point labels sit to the right of the marker; others are centred.
          const shift = layer.geometry === "Point" ? `translate(${Math.round(sym.size / 2 + 3)}px, -50%)` : "translate(-50%, -50%)";
          group.addLayer(L.marker(at, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: "map-label",
              html: `<div style="${css} transform: ${shift};">${escapeHtml(value)}</div>`,
              iconSize: [0, 0],
            }),
          }));
        });
        labelGroupsRef.current.push({ minZoom: ls.minZoom, group });
      }
    });
    applyLabelZoom(map, labelLayer, labelGroupsRef.current);

    // Enforce stacking order: array is top-first, so push from bottom up.
    [...layers].reverse().forEach((l) => {
      const ref = layerRefs.current.get(l.id);
      ref?.casing?.bringToFront();
      ref?.geo.bringToFront();
    });
    labelLayer.bringToFront();
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

  // Point-inspect tool: a single click reports the clicked coordinate so the
  // editor can resolve which layers cover it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tool !== "inspect") return;
    map.getContainer().style.cursor = "crosshair";
    const onClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      cbRef.current.onPointInspect?.([e.latlng.lat, e.latlng.lng]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      map.getContainer().style.cursor = "";
    };
  }, [tool]);

  // Drop / move / clear the inspection pin to mirror the editor's state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (inspectMarkerRef.current) { map.removeLayer(inspectMarkerRef.current); inspectMarkerRef.current = null; }
    if (!inspectPoint) return;
    const icon = L.divIcon({
      className: "inspect-pin",
      html: `<span class="inspect-pin-dot"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    inspectMarkerRef.current = L.marker(inspectPoint, { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  }, [inspectPoint]);

  // Manual feature capture: click once for a point; click vertices and double
  // click to finish lines/polygons. Geometry is emitted in GeoJSON [lng, lat].
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tool.startsWith("draw-")) return;
    const group = L.layerGroup().addTo(map);
    const points: L.LatLng[] = [];
    let guide: L.Layer | null = null;
    map.getContainer().style.cursor = "crosshair";
    map.doubleClickZoom.disable();

    const redraw = () => {
      if (guide) group.removeLayer(guide);
      if (points.length === 0) return;
      const nextGuide = tool === "draw-polygon"
        ? L.polygon(points, { color: "#0f766e", weight: 2, dashArray: "6 4", fillOpacity: 0.12 })
        : L.polyline(points, { color: "#0f766e", weight: 2, dashArray: "6 4" });
      guide = nextGuide;
      group.addLayer(nextGuide);
    };
    const finish = () => {
      const coordinates = points.map((point) => [point.lng, point.lat] as Position);
      if (tool === "draw-line" && coordinates.length >= 2) cbRef.current.onDrawGeometry?.({ type: "LineString", coordinates });
      if (tool === "draw-polygon" && coordinates.length >= 3) cbRef.current.onDrawGeometry?.({ type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] });
    };
    const click = (event: L.LeafletMouseEvent) => {
      L.DomEvent.stop(event);
      if (tool === "draw-point") {
        cbRef.current.onDrawGeometry?.({ type: "Point", coordinates: [event.latlng.lng, event.latlng.lat] });
        return;
      }
      const previous = points[points.length - 1];
      if (previous && previous.lat === event.latlng.lat && previous.lng === event.latlng.lng) return;
      points.push(event.latlng);
      group.addLayer(L.circleMarker(event.latlng, { radius: 4, color: "#ffffff", weight: 1.5, fillColor: "#0f766e", fillOpacity: 1 }));
      redraw();
    };
    const doubleClick = (event: L.LeafletMouseEvent) => { L.DomEvent.stop(event); finish(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") cbRef.current.onDrawCancel?.(); };
    map.on("click", click);
    map.on("dblclick", doubleClick);
    window.addEventListener("keydown", keydown);
    return () => {
      map.off("click", click); map.off("dblclick", doubleClick);
      window.removeEventListener("keydown", keydown);
      map.removeLayer(group);
      map.getContainer().style.cursor = "";
      map.doubleClickZoom.enable();
    };
  }, [tool]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (previewRef.current) { map.removeLayer(previewRef.current); previewRef.current = null; }
    if (!previewGeometry) return;
    const previewFeature: Feature = { type: "Feature", properties: {}, geometry: previewGeometry };
    previewRef.current = L.geoJSON(previewFeature, {
      style: { color: "#0f766e", weight: 3, dashArray: "7 5", fillColor: "#14b8a6", fillOpacity: 0.2 },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 8, color: "#ffffff", weight: 2, fillColor: "#0f766e", fillOpacity: 1 }),
    }).addTo(map);
  }, [previewGeometry]);

  // Distance-measuring tool: click to add vertices, double-click (or Esc) to finish.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tool !== "measure") return;

    const group = L.layerGroup().addTo(map);
    const pts: L.LatLng[] = [];
    let finished = false;
    map.getContainer().style.cursor = "crosshair";
    map.doubleClickZoom.disable();

    const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
    const total = (arr: L.LatLng[]) => {
      let d = 0;
      for (let i = 1; i < arr.length; i++) d += arr[i - 1].distanceTo(arr[i]);
      return d;
    };

    const redraw = (cursor?: L.LatLng) => {
      group.clearLayers();
      const line = cursor && !finished ? [...pts, cursor] : [...pts];
      if (line.length >= 2) {
        L.polyline(line, { color: "#c0392b", weight: 2.5, dashArray: cursor && !finished ? "5,5" : undefined }).addTo(group);
      }
      pts.forEach((p) =>
        L.circleMarker(p, { radius: 4, color: "#ffffff", weight: 2, fillColor: "#c0392b", fillOpacity: 1 }).addTo(group)
      );
      if (line.length >= 1) {
        const last = line[line.length - 1];
        const html = `<div class="measure-tip">${fmt(total(line))}${finished ? "" : " · doble clic para terminar"}</div>`;
        L.marker(last, {
          interactive: false,
          icon: L.divIcon({ className: "measure-label", html, iconSize: [0, 0] }),
        }).addTo(group);
      }
    };

    // Detect the double-click manually (two clicks within 300 ms): the first
    // click drops the final vertex, the second finishes without adding a point.
    // This is more reliable than Leaflet's `dblclick`, which doesn't fire
    // consistently when the clicks land on top of a feature.
    let lastClickAt = 0;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (finished) return;
      const now = Date.now();
      if (now - lastClickAt < 300) {
        finished = true;
        redraw();
        return;
      }
      lastClickAt = now;
      pts.push(e.latlng);
      redraw();
    };
    const onMove = (e: L.LeafletMouseEvent) => { if (!finished) redraw(e.latlng); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { finished = true; redraw(); }
    };

    map.on("click", onClick);
    map.on("mousemove", onMove);
    window.addEventListener("keydown", onKey);

    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      map.removeLayer(group);
      map.getContainer().style.cursor = "";
      map.doubleClickZoom.enable();
    };
  }, [tool]);

  return <div className="gis-map" ref={containerRef} />;
}
