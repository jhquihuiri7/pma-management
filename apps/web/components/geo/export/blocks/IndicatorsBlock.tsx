import { ChartNoAxesCombined } from "lucide-react";
import type { CartographicBlockProps } from "./shared";
import { BlockFrame, EmptyBlockState } from "./shared";

export interface IndicatorItem {
  id: string;
  label: string;
  value: string | number;
  visible?: boolean;
  title?: string;
}

export interface IndicatorsBlockProps extends CartographicBlockProps {
  indicators?: readonly IndicatorItem[];
  emptyMessage?: string;
}

export function IndicatorsBlock({
  indicators = [],
  emptyMessage = "No hay indicadores seleccionados",
  title = "Indicadores territoriales",
  ...rootProps
}: IndicatorsBlockProps) {
  const visibleIndicators = indicators.filter(
    (indicator) => indicator.visible !== false,
  );

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex min-h-0 p-[0.3em]"
    >
      {visibleIndicators.length > 0 ? (
        <div className="flex min-h-0 flex-1 gap-[0.35em] overflow-hidden">
          {visibleIndicators.map((indicator) => (
            <div
              key={indicator.id}
              title={indicator.title ?? `${indicator.label}: ${indicator.value}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-[0.15em] overflow-hidden border border-slate-300 bg-white px-[0.25em] py-[0.2em] text-center"
            >
              <span className="max-w-full truncate text-[0.58em] uppercase leading-[1.15] tracking-[0.04em] text-slate-600">
                {indicator.label}
              </span>
              <strong className="max-w-full truncate text-[0.95em] font-bold leading-[1.1] text-slate-900">
                {indicator.value}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <EmptyBlockState
          icon={ChartNoAxesCombined}
          message={emptyMessage}
          compact
        />
      )}
    </BlockFrame>
  );
}

export default IndicatorsBlock;
