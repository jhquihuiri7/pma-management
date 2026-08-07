"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, forwardRef, useCallback } from "react";
import type * as LeafletNS from "leaflet";
import "leaflet/dist/leaflet.css";
import "./previene.css";
import { visualFor, isIncident, typeLabel, formatShort, type PrevieneReport } from "@/lib/previene";
import { bucketByGrid, mergeNearby } from "@/lib/previene-cluster";

export interface PrevieneMapHandle {
  fitAll: () => void;
  focus: (reportId: string) => void;
  /** Call after the map's container is resized (view mode switch). */
  invalidate: () => void;
}

interface Props {
  reports: PrevieneReport[];
  selectedId: string | null;
  onSelect: (reportId: string) => void;
  cluster: boolean;
  showAccuracy: boolean;
  onViewportChange?: (info: { lat: number; lng: number; zoom: number }) => void;
}

const CENTER: [number, number] = [-0.62, -90.5];
const INITIAL_ZOOM = 8;
/** The archipelago sits in open ocean; without bounds a stray drag loses it. */
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-1.5, -92.1],
  [0.8, -89.2],
];
const CLUSTER_CELL_PX = 46;
/** Below this radius the halo would overstate precision rather than describe it. */
const MIN_HALO_PX = 7;
/** One marker width: closer than this two markers read as a single smudge. */
const MIN_MARKER_SEPARATION_PX = 22;

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(107,114,128,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Marker markup. Colour = event type, shape = report class, plus a glyph so the
 * two encodings never rely on hue alone. The 2px surface-coloured ring keeps
 * overlapping markers separable and holds contrast over any basemap tone.
 */
function markerHtml(report: PrevieneReport, selected: boolean, haloPx: number): string {
  const visual = visualFor(report);
  const incident = isIncident(report);
  const size = incident ? 20 : 22;
  const ring = selected
    ? "box-shadow:0 0 0 2px #ffffff,0 0 0 5px #0f9d70;"
    : "box-shadow:0 0 0 2px #ffffff;";
  const glyph = `<svg width="12" height="12" viewBox="0 0 12 12">${visual.glyph}</svg>`;

  const shape = incident
    ? `<div style="width:${size}px;height:${size}px;background:${visual.color};border-radius:4px;transform:rotate(45deg);${ring}display:flex;align-items:center;justify-content:center">` +
      `<div style="transform:rotate(-45deg);display:flex">${glyph}</div></div>`
    : `<div style="width:${size}px;height:${size}px;background:${visual.color};border-radius:50%;${ring}display:flex;align-items:center;justify-content:center">${glyph}</div>`;

  let halo = "";
  if (haloPx > 0) {
    const diameter = Math.round(haloPx * 2);
    halo =
      `<div style="position:absolute;left:50%;top:50%;width:${diameter}px;height:${diameter}px;` +
      `margin-left:-${Math.round(haloPx)}px;margin-top:-${Math.round(haloPx)}px;border-radius:50%;` +
      `border:1px dashed ${hexToRgba(visual.color, 0.55)};background:${hexToRgba(visual.color, 0.12)};pointer-events:none"></div>`;
  }

  return `<div style="position:relative;width:22px;height:22px;display:flex;align-items:center;justify-content:center">${halo}${shape}</div>`;
}

function clusterHtml(count: number): string {
  const size = count < 10 ? 34 : count < 40 ? 42 : 50;
  return (
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;border:2px solid #0f9d70;` +
    `box-shadow:0 2px 10px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;` +
    `font-family:ui-monospace,monospace;font-size:13px;font-weight:500;color:#16211e">${count}</div>`
  );
}

const PrevieneMap = forwardRef<PrevieneMapHandle, Props>(function PrevieneMap(
  { reports, selectedId, onSelect, cluster, showAccuracy, onViewportChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const groupRef = useRef<LeafletNS.LayerGroup | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest props, read by the imperative repaint without re-running the effect
  // that owns the map instance.
  const stateRef = useRef({ reports, selectedId, cluster, showAccuracy, onSelect });
  stateRef.current = { reports, selectedId, cluster, showAccuracy, onSelect };

  /** Accuracy in metres → pixels at the current zoom, latitude corrected. */
  const haloPx = useCallback((report: PrevieneReport, zoom: number): number => {
    if (!stateRef.current.showAccuracy || !report.locationAccuracy || report.latitude == null) return 0;
    const metresPerPixel =
      (40075016.686 * Math.cos((report.latitude * Math.PI) / 180)) / (256 * 2 ** zoom);
    const radius = report.locationAccuracy / metresPerPixel;
    return radius >= MIN_HALO_PX ? Math.min(260, radius) : 0;
  }, []);

  const paint = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = groupRef.current;
    if (!L || !map || !group) return;

    const { reports: list, selectedId: selected, cluster: clusterOn } = stateRef.current;
    const zoom = map.getZoom();
    group.clearLayers();

    const placed = list.filter((r) => r.latitude != null && r.longitude != null);

    const singleMarker = (report: PrevieneReport) => {
      const isSelected = report.id === selected;
      const marker = L.marker(L.latLng(report.latitude as number, report.longitude as number), {
        icon: L.divIcon({
          html: markerHtml(report, isSelected, haloPx(report, zoom)),
          className: "previene-marker",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: isSelected ? 1000 : 0,
        keyboard: true,
        title: `${typeLabel(report)} · ${formatShort(report.submittedAt)}`,
      });
      marker.on("click", () => stateRef.current.onSelect(report.id));
      return marker;
    };

    if (!clusterOn) {
      placed.forEach((report) => group.addLayer(singleMarker(report)));
      return;
    }

    // Grid clustering on projected pixels; see lib/previene-cluster.ts for why
    // this is a pure function and not leaflet.markercluster.
    const project = (report: PrevieneReport) =>
      map.project(L.latLng(report.latitude as number, report.longitude as number), zoom);
    const buckets = mergeNearby(
      bucketByGrid(placed, project, CLUSTER_CELL_PX),
      project,
      MIN_MARKER_SEPARATION_PX
    );

    buckets.forEach((bucket) => {
      if (bucket.length === 1) {
        group.addLayer(singleMarker(bucket[0]));
        return;
      }
      const hasSelected = bucket.some((r) => r.id === selected);
      const centreLat = bucket.reduce((acc, r) => acc + (r.latitude as number), 0) / bucket.length;
      const centreLon = bucket.reduce((acc, r) => acc + (r.longitude as number), 0) / bucket.length;
      const badge = L.marker(L.latLng(centreLat, centreLon), {
        icon: L.divIcon({
          html: clusterHtml(bucket.length),
          className: "previene-marker",
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        }),
        zIndexOffset: hasSelected ? 900 : 0,
        keyboard: true,
        title: `${bucket.length} reportes en esta zona`,
      });
      badge.on("click", () => {
        const bounds = L.latLngBounds([]);
        bucket.forEach((r) => bounds.extend(L.latLng(r.latitude as number, r.longitude as number)));
        if (!bounds.isValid()) return;
        const target = Math.min(16, Math.max(zoom + 2, map.getBoundsZoom(bounds, false, L.point(40, 40))));
        // animate:false — a repaint mid-animation cancels the movement and the
        // map appears frozen.
        map.setView(bounds.getCenter(), target, { animate: false });
      });
      group.addLayer(badge);
    });
  }, [haloPx]);

  /** Coalesce repaints: zoom+move can fire several times per gesture. */
  const schedulePaint = useCallback(() => {
    if (repaintTimer.current) clearTimeout(repaintTimer.current);
    repaintTimer.current = setTimeout(() => {
      repaintTimer.current = null;
      try {
        paint();
      } catch (error) {
        console.warn("[previene] repaint skipped", error);
      }
    }, 0);
  }, [paint]);

  const fitAll = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const placed = stateRef.current.reports.filter((r) => r.latitude != null && r.longitude != null);
    if (placed.length === 0) {
      map.setView(CENTER, INITIAL_ZOOM, { animate: false });
      return;
    }
    const bounds = L.latLngBounds([]);
    placed.forEach((r) => bounds.extend(L.latLng(r.latitude as number, r.longitude as number)));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [58, 58], maxZoom: 11, animate: false });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fitAll,
      invalidate: () => {
        const map = mapRef.current;
        if (!map) return;
        map.invalidateSize();
        schedulePaint();
      },
      focus: (reportId: string) => {
        const L = leafletRef.current;
        const map = mapRef.current;
        if (!L || !map) return;
        const report = stateRef.current.reports.find((r) => r.id === reportId);
        if (!report || report.latitude == null || report.longitude == null) return;
        map.setView(L.latLng(report.latitude, report.longitude), Math.max(map.getZoom(), 13), {
          animate: false,
        });
      },
    }),
    [fitAll, schedulePaint]
  );

  // Map lifecycle. Leaflet is imported here rather than at module scope so it
  // never runs during server rendering, and the reference is captured once.
  useEffect(() => {
    let disposed = false;
    let map: LeafletNS.Map | null = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !containerRef.current) return;
      leafletRef.current = L;

      map = L.map(containerRef.current, {
        center: CENTER,
        zoom: INITIAL_ZOOM,
        minZoom: 7,
        maxZoom: 17,
        maxBounds: L.latLngBounds(MAX_BOUNDS),
        maxBoundsViscosity: 0.85,
        zoomControl: false,
        attributionControl: true,
      });
      mapRef.current = map;
      L.control.zoom({ position: "topleft" }).addTo(map);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 17,
        subdomains: "abcd",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      groupRef.current = L.layerGroup().addTo(map);

      // The map CENTRE, emitted when the gesture settles — never on mousemove.
      // The parent stores this in state, so a per-pixel emit reconciled the
      // whole report table on every mouse movement: unnoticeable on today's
      // cache, linear in the number of reports from here on.
      const emitViewport = () => {
        const centre = map!.getCenter();
        onViewportChange?.({ lat: centre.lat, lng: centre.lng, zoom: map!.getZoom() });
      };

      const onIdle = () => {
        emitViewport();
        // Repainting during the zoom animation cancels it; Leaflet flags the
        // in-flight animation on the map instance.
        if ((map as unknown as { _animatingZoom?: boolean })._animatingZoom) return;
        schedulePaint();
      };
      map.on("zoomend", onIdle);
      map.on("moveend", onIdle);

      map.whenReady(() => {
        map?.invalidateSize();
        schedulePaint();
        fitAll();
        emitViewport();
      });
    })();

    return () => {
      disposed = true;
      if (repaintTimer.current) clearTimeout(repaintTimer.current);
      map?.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
    // Mount-only: the map instance must outlive prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data/selection changes repaint the existing layer group instead of
  // rebuilding the map.
  useEffect(() => {
    schedulePaint();
  }, [reports, selectedId, cluster, showAccuracy, schedulePaint]);

  // Refit when the filtered SET changes — the encoding "you are looking at
  // everything that matches" only holds if the viewport follows the data.
  //
  // Compared by identity, not by size: two filters that happen to return the
  // same number of reports (swapping FIRE for RAIN, say) would otherwise leave
  // the map framed on the previous islands, potentially empty while the counter
  // insists N are visible.
  const signature = useMemo(() => reports.map((r) => r.id).join("|"), [reports]);
  const previousSignature = useRef<string | null>(null);
  useEffect(() => {
    if (previousSignature.current !== null && previousSignature.current !== signature) fitAll();
    previousSignature.current = signature;
  }, [signature, fitAll]);

  return <div ref={containerRef} className="previene-map absolute inset-0" />;
});

export default PrevieneMap;
