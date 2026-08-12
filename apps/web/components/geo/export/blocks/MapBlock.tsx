import type { ReactNode } from "react";
import { LockKeyhole, Map as MapIcon } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import { clampPercentage, cx } from "./shared";

export interface CoordinateTick {
  value: string | number;
  /** Posición relativa sobre el eje, de 0 a 100. */
  position: number;
}

export interface MapCoordinateGrid {
  eastings?: CoordinateTick[];
  northings?: CoordinateTick[];
}

export type GridDensity = "baja" | "media" | "alta" | number;

export interface MapBlockProps extends CartographicBlockProps {
  preview?: ReactNode;
  children?: ReactNode;
  coordinateOverlay?: ReactNode;
  coordinates?: MapCoordinateGrid;
  showCoordinates?: boolean;
  showGrid?: boolean;
  gridDensity?: GridDensity;
  coordinateInsetMm?: number;
  selected?: boolean;
  emptyLabel?: string;
}

function densityLines(density: GridDensity): number {
  if (typeof density === "number") {
    return Math.max(2, Math.min(12, Math.round(density)));
  }
  if (density === "alta") return 7;
  if (density === "baja") return 3;
  return 5;
}

export function MapBlock({
  preview,
  children,
  coordinateOverlay,
  coordinates,
  showCoordinates = true,
  showGrid = false,
  gridDensity = "media",
  coordinateInsetMm = 4.2,
  selected = false,
  emptyLabel = "La vista del mapa aparecerá aquí",
  title = "Mapa principal",
  className,
  ...rootProps
}: MapBlockProps) {
  const mapPreview = preview ?? children;
  const lines = densityLines(gridDensity);
  const previewInset = showCoordinates ? `${coordinateInsetMm}mm` : "0";

  return (
    <section
      {...rootProps}
      title={title}
      aria-label={title}
      className={cx(
        "relative h-full w-full min-h-0 overflow-hidden border-[1.5px] border-[#1f3a5f] bg-[#e8edf1]",
        className,
      )}
    >
      <div
        data-map-preview
        className="absolute overflow-hidden border-slate-900 bg-slate-200"
        style={{
          inset: previewInset,
          borderWidth: showCoordinates ? "1px" : "0",
        }}
      >
        {mapPreview ? (
          <div className="h-full w-full overflow-hidden">{mapPreview}</div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-[0.35em] bg-slate-100 text-slate-500">
            <MapIcon
              aria-hidden="true"
              className="h-[2.5em] w-[2.5em]"
              strokeWidth={1.4}
            />
            <p className="m-0 text-[0.68em] font-medium leading-[1.2]">
              {emptyLabel}
            </p>
          </div>
        )}

        {showGrid && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(31,58,95,.24) 1px, transparent 1px), linear-gradient(to bottom, rgba(31,58,95,.24) 1px, transparent 1px)",
              backgroundSize: `${100 / lines}% ${100 / lines}%`,
            }}
          />
        )}
      </div>

      {showCoordinates && (
        <div
          aria-label="Marco de coordenadas"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          {(coordinates?.eastings ?? []).map((tick, index) => {
            const position = clampPercentage(tick.position);
            return (
              <span
                key={`e-${index}-${tick.value}`}
                className="absolute text-[0.56em] leading-none text-slate-900"
                style={{ left: `${position}%`, top: "0.35em", transform: "translateX(-50%)" }}
              >
                {tick.value}
              </span>
            );
          })}
          {(coordinates?.eastings ?? []).map((tick, index) => {
            const position = clampPercentage(tick.position);
            return (
              <span
                key={`e-bottom-${index}-${tick.value}`}
                className="absolute text-[0.56em] leading-none text-slate-900"
                style={{
                  bottom: "0.35em",
                  left: `${position}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {tick.value}
              </span>
            );
          })}
          {(coordinates?.northings ?? []).map((tick, index) => {
            const position = clampPercentage(tick.position);
            return (
              <span
                key={`n-${index}-${tick.value}`}
                className="absolute text-[0.56em] leading-none text-slate-900"
                style={{
                  left: "0.35em",
                  top: `${position}%`,
                  transform: "translate(-36%, -50%) rotate(-90deg)",
                }}
              >
                {tick.value}
              </span>
            );
          })}
          {(coordinates?.northings ?? []).map((tick, index) => {
            const position = clampPercentage(tick.position);
            return (
              <span
                key={`n-right-${index}-${tick.value}`}
                className="absolute text-[0.56em] leading-none text-slate-900"
                style={{
                  right: "0.35em",
                  top: `${position}%`,
                  transform: "translate(36%, -50%) rotate(90deg)",
                }}
              >
                {tick.value}
              </span>
            );
          })}
          {coordinateOverlay}
        </div>
      )}

      {selected && (
        <div
          data-editor-chrome
          className="pointer-events-none absolute left-[0.55em] top-[0.55em] flex items-center gap-[0.35em] rounded-md bg-slate-900/85 px-[0.55em] py-[0.3em] text-white"
          role="status"
        >
          <LockKeyhole aria-hidden="true" className="h-[0.95em] w-[0.95em]" />
          <span className="text-[0.72em] font-semibold leading-none tracking-[0.02em]">
            Mapa principal · Bloqueado
          </span>
        </div>
      )}
    </section>
  );
}

export default MapBlock;
