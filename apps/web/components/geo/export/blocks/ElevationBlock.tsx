import { Mountain } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import { BlockFrame, EmptyBlockState, formatNumber } from "./shared";

export interface ElevationPoint {
  distance: number;
  elevation: number;
}

export interface ElevationBlockProps extends CartographicBlockProps {
  points?: readonly ElevationPoint[];
  distanceUnit?: string;
  elevationUnit?: string;
  lineColor?: string;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onHide?: () => void;
}

interface NormalizedElevation {
  polyline: string;
  minimum: number;
  middle: number;
  maximum: number;
  distanceStart: number;
  distanceEnd: number;
}

function normalizeElevation(
  points: readonly ElevationPoint[],
): NormalizedElevation | null {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.distance) && Number.isFinite(point.elevation),
  );
  if (valid.length < 2) return null;

  const elevations = valid.map((point) => point.elevation);
  const distances = valid.map((point) => point.distance);
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const distanceStart = Math.min(...distances);
  const distanceEnd = Math.max(...distances);
  const elevationRange = maximum - minimum || 1;
  const distanceRange = distanceEnd - distanceStart || 1;
  const padding = Math.max(elevationRange * 0.08, 1);
  const chartMinimum = minimum - padding;
  const chartMaximum = maximum + padding;
  const chartRange = chartMaximum - chartMinimum;

  const polyline = valid
    .map((point) => {
      const x = ((point.distance - distanceStart) / distanceRange) * 300;
      const y = 100 - ((point.elevation - chartMinimum) / chartRange) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    polyline,
    minimum,
    middle: minimum + (maximum - minimum) / 2,
    maximum,
    distanceStart,
    distanceEnd,
  };
}

export function ElevationBlock({
  points = [],
  distanceUnit = "m",
  elevationUnit = "m s. n. m.",
  lineColor = "#3f7d20",
  emptyMessage = "No hay información de elevación disponible",
  emptyActionLabel = "Ocultar componente",
  onHide,
  title = "Perfil de elevación",
  ...rootProps
}: ElevationBlockProps) {
  const elevation = normalizeElevation(points);

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 flex-col p-[0.25em]"
    >
      {elevation ? (
        <>
          <div className="flex min-h-0 flex-1 gap-[0.35em] overflow-hidden">
            <div className="flex shrink-0 flex-col items-end justify-between py-[0.05em] text-[0.55em] leading-none text-slate-600">
              <span>{formatNumber(elevation.maximum, 1)}</span>
              <span>{formatNumber(elevation.middle, 1)}</span>
              <span>{formatNumber(elevation.minimum, 1)}</span>
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden border-b border-l border-slate-400 bg-[linear-gradient(to_bottom,transparent_49%,rgba(148,163,184,.24)_50%,transparent_51%)]">
              <svg
                viewBox="0 0 300 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label={`Perfil desde ${formatNumber(elevation.minimum, 1)} hasta ${formatNumber(elevation.maximum, 1)} ${elevationUnit}`}
              >
                <title>Perfil longitudinal de elevación</title>
                <polyline
                  points={elevation.polyline}
                  fill="none"
                  stroke={lineColor}
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>
          <div className="mt-[0.15em] flex shrink-0 items-center justify-between pl-[2.8em] text-[0.52em] leading-none text-slate-600">
            <span>{formatNumber(elevation.distanceStart, 1)}</span>
            <span>
              Distancia ({distanceUnit})
            </span>
            <span>{formatNumber(elevation.distanceEnd, 1)}</span>
          </div>
        </>
      ) : (
        <EmptyBlockState
          icon={Mountain}
          message={emptyMessage}
          actionLabel={emptyActionLabel}
          onAction={onHide}
        />
      )}
    </BlockFrame>
  );
}

export default ElevationBlock;
