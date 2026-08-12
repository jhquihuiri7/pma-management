import type {
  BlockId,
  BuilderState,
  Format,
  LayoutRects,
  Orientation,
  Rect,
  ToggleId,
} from "./types";

/** CSS pixels in one physical millimetre at the standard 96 dpi. */
export const MM_TO_PX = 3.7795275591;
export const MM = MM_TO_PX;

export const PAPER_SIZES_MM: Readonly<
  Record<Format, readonly [width: number, height: number]>
> = {
  A4: [210, 297],
  A3: [297, 420],
};

export const BASE_SAFE_MARGIN_MM = 8;
export const BASE_GAP_MM = 3;
export const A3_LAYOUT_SCALE = 1.3;

const RIGHT_COLUMN_ORDER = [
  "legend",
  "locator",
  "indicators",
  "elevation",
  "landcover",
] as const satisfies readonly BlockId[];

const RIGHT_COLUMN_WEIGHTS: Readonly<
  Record<(typeof RIGHT_COLUMN_ORDER)[number], number>
> = {
  legend: 1.15,
  locator: 1,
  indicators: 0.6,
  elevation: 0.85,
  landcover: 0.62,
};

const INFO_ORDER = ["scalebar", "scalenum", "refsys"] as const;
const INFO_WEIGHTS: Readonly<Record<(typeof INFO_ORDER)[number], number>> = {
  scalebar: 1.45,
  scalenum: 0.8,
  refsys: 1.3,
};

export interface PaperSize {
  w: number;
  h: number;
}

export type AutoLayoutInput = Pick<
  BuilderState,
  "format" | "orientation" | "visible"
>;

export type RectsInput = AutoLayoutInput &
  Pick<BuilderState, "mode" | "overrides">;

function enabled(visible: Record<ToggleId, boolean>, block: BlockId): boolean {
  return block === "map" || visible[block];
}

export function formatScale(format: Format): number {
  return format === "A3" ? A3_LAYOUT_SCALE : 1;
}

export function paperSize(
  format: Format,
  orientation: Orientation,
): PaperSize {
  const [portraitWidth, portraitHeight] = PAPER_SIZES_MM[format];
  return orientation === "h"
    ? { w: portraitHeight, h: portraitWidth }
    : { w: portraitWidth, h: portraitHeight };
}

export const getPaperSize = paperSize;

export function safeMargin(format: Format): number {
  return BASE_SAFE_MARGIN_MM * formatScale(format);
}

export function layoutGap(format: Format): number {
  return BASE_GAP_MM * formatScale(format);
}

export function safeBounds(
  format: Format,
  orientation: Orientation,
): Rect {
  const paper = paperSize(format, orientation);
  const margin = safeMargin(format);
  return {
    x: margin,
    y: margin,
    w: paper.w - margin * 2,
    h: paper.h - margin * 2,
  };
}

export const getSafeBounds = safeBounds;

export function fitScale(
  canvasWidthPx: number,
  canvasHeightPx: number,
  format: Format,
  orientation: Orientation,
): number {
  const paper = paperSize(format, orientation);
  const widthScale = (canvasWidthPx - 56) / (paper.w * MM_TO_PX);
  const heightScale = (canvasHeightPx - 56) / (paper.h * MM_TO_PX);
  return Math.max(0, Math.min(widthScale, heightScale));
}

export function paperFontSizePx(
  format: Format,
  orientation: Orientation,
): number {
  const paperWidthPx = paperSize(format, orientation).w * MM_TO_PX;
  return (
    10 *
    (paperWidthPx / 1122) *
    (format === "A3" ? 1.28 : 1)
  );
}

function weightedRow(
  ids: readonly (typeof INFO_ORDER)[number][],
  x: number,
  y: number,
  width: number,
  height: number,
  gap: number,
): Partial<Record<(typeof INFO_ORDER)[number], Rect>> {
  if (ids.length === 0) return {};

  const totalWeight = ids.reduce((sum, id) => sum + INFO_WEIGHTS[id], 0);
  const availableWidth = Math.max(0, width - gap * (ids.length - 1));
  let cursorX = x;
  const result: Partial<Record<(typeof INFO_ORDER)[number], Rect>> = {};

  ids.forEach((id, index) => {
    const isLast = index === ids.length - 1;
    const calculatedWidth = availableWidth * (INFO_WEIGHTS[id] / totalWeight);
    const blockWidth = isLast ? x + width - cursorX : calculatedWidth;
    result[id] = { x: cursorX, y, w: blockWidth, h: height };
    cursorX += blockWidth + gap;
  });

  return result;
}

interface MainBand {
  top: number;
  bottom: number;
  infoY: number | null;
  docsY: number | null;
}

function calculateBands(
  state: AutoLayoutInput,
  bounds: Rect,
  headerHeight: number,
  infoHeight: number,
  docsHeight: number,
  gap: number,
  hasInfoRow: boolean,
): MainBand {
  let top = bounds.y;
  let bottom = bounds.y + bounds.h;
  let docsY: number | null = null;
  let infoY: number | null = null;

  if (enabled(state.visible, "header")) {
    top += headerHeight + gap;
  }

  if (enabled(state.visible, "docs")) {
    docsY = bottom - docsHeight;
    bottom = docsY - gap;
  }

  if (hasInfoRow) {
    infoY = bottom - infoHeight;
    bottom = infoY - gap;
  }

  return { top, bottom, infoY, docsY };
}

function horizontalLayout(
  state: AutoLayoutInput,
  bounds: Rect,
  gap: number,
  scale: number,
): LayoutRects {
  const result = {} as LayoutRects;
  const headerHeight = 20 * scale;
  const infoHeight = 18 * scale;
  const docsHeight = 19 * scale;
  const infoIds = INFO_ORDER.filter((id) => enabled(state.visible, id));
  const hasTechInfo = enabled(state.visible, "techinfo");
  const hasInfoRow = infoIds.length > 0 || hasTechInfo;
  const sideIds = RIGHT_COLUMN_ORDER.filter((id) => enabled(state.visible, id));
  const hasRightColumn = sideIds.length > 0 || hasTechInfo;
  const bands = calculateBands(
    state,
    bounds,
    headerHeight,
    infoHeight,
    docsHeight,
    gap,
    hasInfoRow,
  );

  if (enabled(state.visible, "header")) {
    result.header = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: headerHeight,
    };
  }

  if (bands.docsY !== null) {
    result.docs = {
      x: bounds.x,
      y: bands.docsY,
      w: bounds.w,
      h: docsHeight,
    };
  }

  let rightWidth = 0;
  if (hasRightColumn) {
    const preferred = Math.min(
      Math.max(bounds.w * 0.27, 62 * scale),
      80 * scale,
    );
    const maxKeepingMapDominant = Math.max(
      0,
      bounds.w - gap - bounds.w * 0.55,
    );
    rightWidth = Math.min(preferred, maxKeepingMapDominant);
  }

  const mapWidth = bounds.w - (hasRightColumn ? rightWidth + gap : 0);
  const mainHeight = Math.max(0, bands.bottom - bands.top);
  const rightX = bounds.x + mapWidth + gap;

  result.map = {
    x: bounds.x,
    y: bands.top,
    w: mapWidth,
    h: mainHeight,
  };

  if (sideIds.length > 0) {
    const totalWeight = sideIds.reduce(
      (sum, id) => sum + RIGHT_COLUMN_WEIGHTS[id],
      0,
    );
    const availableHeight = Math.max(0, mainHeight - gap * (sideIds.length - 1));
    let cursorY = bands.top;

    sideIds.forEach((id, index) => {
      const isLast = index === sideIds.length - 1;
      const calculatedHeight =
        availableHeight * (RIGHT_COLUMN_WEIGHTS[id] / totalWeight);
      const blockHeight = isLast
        ? bands.bottom - cursorY
        : calculatedHeight;
      result[id] = {
        x: rightX,
        y: cursorY,
        w: rightWidth,
        h: blockHeight,
      };
      cursorY += blockHeight + gap;
    });
  }

  if (bands.infoY !== null) {
    Object.assign(
      result,
      weightedRow(
        infoIds,
        bounds.x,
        bands.infoY,
        hasTechInfo ? mapWidth : bounds.w,
        infoHeight,
        gap,
      ),
    );

    if (hasTechInfo) {
      result.techinfo = {
        x: rightX,
        y: bands.infoY,
        w: rightWidth,
        h: infoHeight,
      };
    }
  }

  return result;
}

function verticalLayout(
  state: AutoLayoutInput,
  bounds: Rect,
  gap: number,
  scale: number,
): LayoutRects {
  const result = {} as LayoutRects;
  const headerHeight = 24 * scale;
  const infoHeight = 19 * scale;
  const docsHeight = 22 * scale;
  const infoIds = INFO_ORDER.filter((id) => enabled(state.visible, id));
  const hasInfoRow = infoIds.length > 0;
  const moduleIds: BlockId[] = [
    ...RIGHT_COLUMN_ORDER.filter((id) => enabled(state.visible, id)),
    ...(enabled(state.visible, "techinfo") ? (["techinfo"] as const) : []),
  ];
  const bands = calculateBands(
    state,
    bounds,
    headerHeight,
    infoHeight,
    docsHeight,
    gap,
    hasInfoRow,
  );

  if (enabled(state.visible, "header")) {
    result.header = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: headerHeight,
    };
  }

  if (bands.docsY !== null) {
    result.docs = {
      x: bounds.x,
      y: bands.docsY,
      w: bounds.w,
      h: docsHeight,
    };
  }

  const bandHeight = Math.max(0, bands.bottom - bands.top);
  const rowCount = Math.ceil(moduleIds.length / 2);
  const gridHeight =
    rowCount === 0
      ? 0
      : Math.min(bandHeight * 0.52, bandHeight * 0.155 * rowCount);
  const mapHeight = Math.max(
    0,
    bandHeight - (gridHeight > 0 ? gridHeight + gap : 0),
  );

  result.map = {
    x: bounds.x,
    y: bands.top,
    w: bounds.w,
    h: mapHeight,
  };

  if (rowCount > 0) {
    const availableGridHeight = Math.max(0, gridHeight - gap * (rowCount - 1));
    const rowHeight = availableGridHeight / rowCount;
    const columnWidth = (bounds.w - gap) / 2;
    const gridY = bands.top + mapHeight + gap;

    moduleIds.forEach((id, index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const isLastOdd =
        index === moduleIds.length - 1 && moduleIds.length % 2 === 1;
      result[id] = {
        x: bounds.x + (isLastOdd ? 0 : column * (columnWidth + gap)),
        y: gridY + row * (rowHeight + gap),
        w: isLastOdd ? bounds.w : columnWidth,
        h: rowHeight,
      };
    });
  }

  if (bands.infoY !== null) {
    Object.assign(
      result,
      weightedRow(
        infoIds,
        bounds.x,
        bands.infoY,
        bounds.w,
        infoHeight,
        gap,
      ),
    );
  }

  return result;
}

/**
 * Computes a fresh cartographic composition in physical millimetres.
 * Zoom and editor pixel dimensions intentionally have no effect here.
 */
export function autoLayout(state: AutoLayoutInput): LayoutRects {
  const bounds = safeBounds(state.format, state.orientation);
  const gap = layoutGap(state.format);
  const scale = formatScale(state.format);

  return state.orientation === "h"
    ? horizontalLayout(state, bounds, gap, scale)
    : verticalLayout(state, bounds, gap, scale);
}

/** Auto geometry plus user overrides. The principal map is always recomputed. */
export function rects(state: RectsInput): LayoutRects {
  const automatic = autoLayout(state);
  if (state.mode !== "custom") return automatic;

  const composed: LayoutRects = {
    ...automatic,
    map: { ...automatic.map },
  };

  for (const [block, override] of Object.entries(state.overrides) as Array<
    [BlockId, Rect | undefined]
  >) {
    if (block !== "map" && override && automatic[block]) {
      composed[block] = { ...override };
    }
  }

  return composed;
}
