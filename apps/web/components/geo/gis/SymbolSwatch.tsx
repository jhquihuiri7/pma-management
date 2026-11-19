import type { ResolvedSymbol } from "./symbology";
import { markerSvg } from "./symbology";

/**
 * A legend swatch that draws the symbol as the map does: polygon fill and
 * outline, line with its casing and dashes, point marker with its backdrop.
 * Widths are capped so a thick road still fits the swatch.
 */
export default function SymbolSwatch({ symbol, width = 16, height = 14, className, style }: {
  symbol: ResolvedSymbol;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const W = 32, H = 24;
  const common = { width, height, viewBox: `0 0 ${W} ${H}`, className, style: { display: "block", flexShrink: 0, ...style }, "aria-hidden": true } as const;

  if (symbol.geometry === "Point") {
    const { svg, box } = markerSvg(symbol);
    // Scale the marker into the swatch, keeping its proportions.
    const scale = Math.min(1, (H - 2) / box);
    const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    return (
      <svg {...common}>
        <g transform={`translate(${(W - box * scale) / 2} ${(H - box * scale) / 2}) scale(${scale})`} dangerouslySetInnerHTML={{ __html: inner }} />
      </svg>
    );
  }

  if (symbol.geometry === "LineString") {
    const scale = (w: number) => Math.max(1, Math.min(w * 1.4, 12));
    return (
      <svg {...common}>
        {symbol.casingColor && symbol.casingWidth > 0 && (
          <line x1={3} y1={H / 2} x2={W - 3} y2={H / 2} stroke={symbol.casingColor} strokeOpacity={symbol.strokeOpacity}
            strokeWidth={scale(symbol.casingWidth)} strokeLinecap="round" />
        )}
        <line x1={3} y1={H / 2} x2={W - 3} y2={H / 2} stroke={symbol.color} strokeOpacity={symbol.strokeOpacity}
          strokeWidth={scale(symbol.strokeWidth)} strokeDasharray={symbol.dash ?? undefined} strokeLinecap={symbol.dash ? "butt" : "round"} />
      </svg>
    );
  }

  const outline = symbol.strokeColor && symbol.strokeWidth > 0;
  const sw = outline ? Math.max(1, Math.min(symbol.strokeWidth * 1.4, 5)) : 0;
  return (
    <svg {...common}>
      <rect x={2 + sw / 2} y={2 + sw / 2} width={W - 4 - sw} height={H - 4 - sw} rx={2}
        fill={symbol.color} fillOpacity={symbol.fillOpacity}
        stroke={outline ? symbol.strokeColor! : "none"} strokeOpacity={symbol.strokeOpacity}
        strokeWidth={sw} strokeDasharray={symbol.dash ?? undefined} />
    </svg>
  );
}
