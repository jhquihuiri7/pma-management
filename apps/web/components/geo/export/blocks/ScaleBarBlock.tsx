import type { CartographicBlockProps } from "./shared";
import { BlockFrame, formatNumber } from "./shared";

export type ScaleBarVariant =
  | "bars"
  | "line"
  | "block"
  | "barras"
  | "linea"
  | "bloque";

export interface ScaleBarBlockProps extends CartographicBlockProps {
  maxDistance?: number;
  unit?: string;
  segments?: number;
  scaleStyle?: ScaleBarVariant;
  labels?: readonly (string | number)[];
  labelFormatter?: (value: number, index: number) => string;
}

function normalizedVariant(variant: ScaleBarVariant): "bars" | "line" | "block" {
  if (variant === "linea") return "line";
  if (variant === "bloque") return "block";
  if (variant === "barras") return "bars";
  return variant;
}

export function ScaleBarBlock({
  maxDistance = 250,
  unit = "m",
  segments = 5,
  scaleStyle = "bars",
  labels,
  labelFormatter,
  title = "Escala gráfica",
  ...rootProps
}: ScaleBarBlockProps) {
  const segmentCount = Math.max(1, Math.min(12, Math.round(segments)));
  const variant = normalizedVariant(scaleStyle);
  const safeMaximum = Number.isFinite(maxDistance) ? Math.max(0, maxDistance) : 0;
  const computedLabels = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const supplied = labels?.[index];
    if (supplied != null) return String(supplied);
    const value = (safeMaximum * index) / segmentCount;
    return labelFormatter?.(value, index) ?? formatNumber(value, 1);
  });

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 flex-col justify-center px-[0.65em] py-[0.25em]"
    >
      <div className="flex w-full items-end justify-between">
        {computedLabels.map((label, index) => (
          <span
            key={`${index}-${label}`}
            className="text-[0.55em] leading-none tabular-nums text-slate-700"
          >
            {label}
            {index === computedLabels.length - 1 ? ` ${unit}` : ""}
          </span>
        ))}
      </div>

      <div
        className="mt-[0.2em] flex h-[0.66em] w-full"
        role="img"
        aria-label={`Escala gráfica de 0 a ${formatNumber(safeMaximum, 1)} ${unit}`}
      >
        {Array.from({ length: segmentCount }, (_, index) => {
          if (variant === "line") {
            return (
              <span
                key={index}
                className="relative h-full flex-1 border-b border-l border-slate-900 last:border-r"
              >
                <span className="absolute -bottom-[0.16em] left-0 h-[0.32em] border-l border-slate-900" />
              </span>
            );
          }

          return (
            <span
              key={index}
              className="h-full flex-1 border-y border-l border-slate-900 last:border-r"
              style={{
                backgroundColor:
                  variant === "block" || index % 2 === 0 ? "#0f172a" : "#ffffff",
              }}
            />
          );
        })}
      </div>
    </BlockFrame>
  );
}

export default ScaleBarBlock;
