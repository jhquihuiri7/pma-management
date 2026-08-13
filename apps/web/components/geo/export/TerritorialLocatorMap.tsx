"use client";

import { LoaderCircle, MapPinned, TriangleAlert } from "lucide-react";

import type { GeoBounds } from "@/lib/geo-export-data";

import {
  createTerritoryProjection,
  territoryPath,
  type TerritoryFeature,
  type TerritoryPoint,
} from "./territorial-geometry";

interface TerritorialLocatorMapProps {
  features: readonly TerritoryFeature[];
  selected?: TerritoryFeature | null;
  point: TerritoryPoint;
  viewportBounds?: GeoBounds | null;
  showViewport?: boolean;
  loading?: boolean;
  error?: string | null;
  source?: string;
  label: string;
}

const WIDTH = 240;
const HEIGHT = 130;

function StateMessage({
  kind,
  message,
}: {
  kind: "loading" | "error" | "empty";
  message: string;
}) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? TriangleAlert : MapPinned;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[0.18em] bg-slate-50 px-[0.35em] text-center text-slate-500">
      <Icon
        aria-hidden="true"
        className={`h-[1.2em] w-[1.2em] ${kind === "loading" ? "animate-spin" : ""}`}
        strokeWidth={1.7}
      />
      <span className="text-[0.52em] font-medium leading-[1.2]">{message}</span>
    </div>
  );
}

export default function TerritorialLocatorMap({
  features,
  selected,
  point,
  viewportBounds,
  showViewport = false,
  loading = false,
  error = null,
  source,
  label,
}: TerritorialLocatorMapProps) {
  if (loading && !features.length) {
    return <StateMessage kind="loading" message="Cargando límites…" />;
  }
  if (error && !features.length) {
    return <StateMessage kind="error" message="Límites no disponibles" />;
  }
  if (!features.length) {
    return <StateMessage kind="empty" message="Territorio no identificado" />;
  }

  const projection = createTerritoryProjection(features, WIDTH, HEIGHT);
  if (!projection) {
    return <StateMessage kind="empty" message="Geometría no disponible" />;
  }

  const ordered = [...features].sort((first, second) =>
    first.code === selected?.code ? 1 : second.code === selected?.code ? -1 : 0,
  );
  const [markerX, markerY] = projection.project([point.longitude, point.latitude]);
  const intersectsViewport = Boolean(
    viewportBounds &&
      viewportBounds.east >= projection.bounds.west &&
      viewportBounds.west <= projection.bounds.east &&
      viewportBounds.north >= projection.bounds.south &&
      viewportBounds.south <= projection.bounds.north,
  );
  const viewport = viewportBounds && intersectsViewport
    ? (() => {
        const west = Math.max(viewportBounds.west, projection.bounds.west);
        const east = Math.min(viewportBounds.east, projection.bounds.east);
        const north = Math.min(viewportBounds.north, projection.bounds.north);
        const south = Math.max(viewportBounds.south, projection.bounds.south);
        const [left, top] = projection.project([west, north]);
        const [right, bottom] = projection.project([east, south]);
        return {
          x: Math.min(left, right),
          y: Math.min(top, bottom),
          width: Math.max(3, Math.abs(right - left)),
          height: Math.max(3, Math.abs(bottom - top)),
        };
      })()
    : null;

  return (
    <svg
      data-territorial-locator
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full bg-[#f8fafc]"
      role="img"
      aria-label={`${label}${selected ? `: ${selected.name}` : ""}`}
    >
      <title>{`${label}${selected ? ` · ${selected.name}` : ""}${source ? ` · Fuente: ${source}` : ""}`}</title>
      <rect width={WIDTH} height={HEIGHT} fill="#f8fafc" />
      {ordered.map((feature) => {
        const isSelected = feature.code === selected?.code;
        return (
          <path
            key={feature.code}
            d={territoryPath(feature, projection.project)}
            fill={isSelected ? "#5eead4" : "#e2e8f0"}
            fillRule="evenodd"
            stroke={isSelected ? "#0f766e" : "#64748b"}
            strokeWidth={isSelected ? 1.55 : 0.7}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {showViewport && viewport && (
        <rect
          x={viewport.x}
          y={viewport.y}
          width={viewport.width}
          height={viewport.height}
          fill="rgba(220,38,38,.08)"
          stroke="#dc2626"
          strokeWidth={1.5}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {showViewport && Number.isFinite(markerX) && Number.isFinite(markerY) && (
        <g transform={`translate(${markerX.toFixed(2)} ${markerY.toFixed(2)})`}>
          <circle r="3.7" fill="white" stroke="#b91c1c" strokeWidth="1.2" />
          <circle r="1.7" fill="#dc2626" />
        </g>
      )}
    </svg>
  );
}
