import { Sprout } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import {
  BlockFrame,
  EmptyBlockState,
  clampPercentage,
  formatNumber,
} from "./shared";

export interface LandCoverItem {
  id: string;
  label: string;
  percentage: number;
  color?: string;
  visible?: boolean;
  areaLabel?: string;
}

export interface LandCoverBlockProps extends CartographicBlockProps {
  items?: readonly LandCoverItem[];
  showValues?: boolean;
  emptyMessage?: string;
  emptyActionLabel?: string;
  onHide?: () => void;
}

const COVER_COLORS = [
  "#5b8f3a",
  "#8ca86b",
  "#b4b4b4",
  "#d4a72c",
  "#5b91bd",
  "#936c4d",
] as const;

export function LandCoverBlock({
  items = [],
  showValues = true,
  emptyMessage = "No hay análisis de cobertura del suelo disponible",
  emptyActionLabel = "Ocultar componente",
  onHide,
  title = "Cobertura del suelo",
  ...rootProps
}: LandCoverBlockProps) {
  const visibleItems = items.filter(
    (item) => item.visible !== false && Number.isFinite(item.percentage),
  );

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 flex-col justify-center p-[0.35em_0.45em]"
    >
      {visibleItems.length > 0 ? (
        <div className="flex min-h-0 flex-col justify-center gap-[0.3em] overflow-hidden">
          {visibleItems.map((item, index) => {
            const percentage = clampPercentage(item.percentage);
            const color = item.color ?? COVER_COLORS[index % COVER_COLORS.length];
            const detail = item.areaLabel
              ? `${formatNumber(percentage, 1)} % · ${item.areaLabel}`
              : `${formatNumber(percentage, 1)} %`;

            return (
              <div
                key={item.id}
                className="flex min-w-0 items-center gap-[0.4em]"
                title={`${item.label}: ${detail}`}
              >
                <span className="w-[5em] shrink-0 truncate text-right text-[0.62em] leading-none text-slate-800">
                  {item.label}
                </span>
                <span className="relative h-[0.58em] min-w-0 flex-1 overflow-hidden bg-[#eef2f6]">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${percentage}%`, backgroundColor: color }}
                  />
                </span>
                {showValues && (
                  <span className="w-[3.25em] shrink-0 text-right text-[0.58em] leading-none tabular-nums text-slate-600">
                    {formatNumber(percentage, 1)} %
                  </span>
                )}
              </div>
            );
          })}
          <div
            aria-hidden="true"
            className="flex justify-between pl-[5.4em] text-[0.52em] leading-none text-slate-500"
          >
            <span>0 %</span>
            <span>50 %</span>
            <span>100 %</span>
          </div>
        </div>
      ) : (
        <EmptyBlockState
          icon={Sprout}
          message={emptyMessage}
          actionLabel={emptyActionLabel}
          onAction={onHide}
          compact
        />
      )}
    </BlockFrame>
  );
}

export default LandCoverBlock;
