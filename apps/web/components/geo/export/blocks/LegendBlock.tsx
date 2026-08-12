import { ListTree } from "lucide-react";
import type { CSSProperties } from "react";
import type { CartographicBlockProps } from "./shared";
import { BlockFrame, EmptyBlockState } from "./shared";

export type LegendSymbol = "point" | "line" | "polygon" | "raster";

export interface LegendItem {
  id: string;
  label: string;
  symbol?: LegendSymbol;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  visible?: boolean;
  excluded?: boolean;
  detail?: string;
}

export interface LegendBlockProps extends CartographicBlockProps {
  items?: readonly LegendItem[];
  columns?: 1 | 2;
  emptyMessage?: string;
}

function LegendSwatch({ item }: { item: LegendItem }) {
  const symbol = item.symbol ?? "polygon";
  const color = item.color ?? item.fillColor ?? "#94a3b8";
  const stroke = item.strokeColor ?? item.color ?? "#475569";
  const opacity = item.opacity == null ? 1 : Math.max(0, Math.min(1, item.opacity));
  const common: CSSProperties = { opacity };

  if (symbol === "point") {
    return (
      <span
        aria-hidden="true"
        className="block h-[0.58em] w-[0.58em] shrink-0 rounded-full border"
        style={{ ...common, backgroundColor: color, borderColor: stroke }}
      />
    );
  }

  if (symbol === "line") {
    return (
      <span
        aria-hidden="true"
        className="block w-[1.15em] shrink-0"
        style={{
          ...common,
          borderTopColor: stroke,
          borderTopStyle: "solid",
          borderTopWidth: `${Math.max(1, item.strokeWidth ?? 1.5)}px`,
        }}
      />
    );
  }

  if (symbol === "raster") {
    return (
      <span
        aria-hidden="true"
        className="block h-[0.65em] w-[1.15em] shrink-0 border"
        style={{
          ...common,
          borderColor: stroke,
          backgroundColor: color,
          backgroundImage:
            "linear-gradient(45deg, rgba(255,255,255,.35) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.35) 75%)",
          backgroundSize: "0.4em 0.4em",
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="block h-[0.65em] w-[1.15em] shrink-0 border"
      style={{
        ...common,
        backgroundColor: item.fillColor ?? color,
        borderColor: stroke,
        borderWidth: `${Math.max(0.5, item.strokeWidth ?? 1)}px`,
      }}
    />
  );
}

export function LegendBlock({
  items = [],
  columns = 1,
  emptyMessage = "No hay capas visibles para incluir en la leyenda",
  title = "Leyenda",
  ...rootProps
}: LegendBlockProps) {
  const includedItems = items.filter(
    (item) => item.visible !== false && item.excluded !== true,
  );

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex flex-col"
    >
      {includedItems.length > 0 ? (
        <div
          className="grid min-h-0 flex-1 content-start gap-x-[0.5em] gap-y-[0.2em] overflow-hidden p-[0.42em_0.5em]"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {includedItems.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-[0.45em]"
              title={item.detail ? `${item.label}: ${item.detail}` : item.label}
            >
              <LegendSwatch item={item} />
              <span className="min-w-0 flex-1 truncate text-[0.72em] leading-[1.25] text-slate-800">
                {item.label}
              </span>
              {item.detail && (
                <span className="shrink-0 text-[0.58em] leading-none text-slate-500">
                  {item.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyBlockState
          icon={ListTree}
          message={emptyMessage}
          className="m-[0.3em]"
        />
      )}
    </BlockFrame>
  );
}

export default LegendBlock;
