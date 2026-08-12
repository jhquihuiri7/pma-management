import type { CartographicBlockProps } from "./shared";
import { BlockFrame, formatNumber } from "./shared";

export interface ScaleNumBlockProps extends CartographicBlockProps {
  scale?: string | number;
  denominator?: number;
  prefix?: string;
}

function scaleLabel(
  scale: string | number | undefined,
  denominator: number | undefined,
  prefix: string,
): string {
  const value = scale ?? denominator ?? 5000;
  if (typeof value === "number") {
    return `${prefix}${formatNumber(Math.max(0, value))}`;
  }

  const trimmed = value.trim();
  if (!trimmed) return `${prefix}—`;
  if (trimmed.includes(":")) return trimmed;
  const numeric = Number(trimmed.replaceAll(".", "").replaceAll(",", ""));
  return Number.isFinite(numeric)
    ? `${prefix}${formatNumber(Math.max(0, numeric))}`
    : trimmed;
}

export function ScaleNumBlock({
  scale,
  denominator,
  prefix = "1:",
  title = "Escala numérica",
  ...rootProps
}: ScaleNumBlockProps) {
  const label = scaleLabel(scale, denominator, prefix);

  return (
    <BlockFrame
      {...rootProps}
      title={title}
      bodyClassName="flex items-center justify-center px-[0.6em] py-[0.25em]"
    >
      <data
        value={typeof denominator === "number" ? denominator : undefined}
        className="text-[1.35em] leading-none tabular-nums tracking-[0.01em] text-slate-900"
        title={`Escala ${label}`}
      >
        {label}
      </data>
    </BlockFrame>
  );
}

export default ScaleNumBlock;
