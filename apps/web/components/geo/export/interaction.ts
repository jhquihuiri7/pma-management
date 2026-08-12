import { MM_TO_PX } from "./layout";
import type { BlockId, Mode, Rect } from "./types";

export const MIN_BLOCK_SIZE = { w: 24, h: 12 } as const;
export const SNAP_THRESHOLD_MM = 2.2;
export const OVERLAP_TOLERANCE_MM = 0.4;
export const OVERLAP_SEPARATION_MM = 1.5;
export const MAX_OVERLAP_ITERATIONS = 12;

export const RESIZE_HANDLES = [
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
  "nw",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];
export type GestureKind = "move" | ResizeHandle;

export interface Point {
  x: number;
  y: number;
}

/** Serializable gesture state; browser PointerEvents stay in the UI layer. */
export interface BlockGesture {
  blockId: BlockId;
  kind: GestureKind;
  pointerId: number;
  startClient: Point;
  startRect: Rect;
  /** Current sheet transform (`fitScale * zoom`). */
  sheetScale: number;
}

export interface SnapGuide {
  /** `x` draws a vertical guide; `y` draws a horizontal guide. */
  axis: "x" | "y";
  /** Guide coordinate in sheet millimetres. */
  position: number;
}

/** Compatibility name used by the canvas state. */
export type Guide = SnapGuide;

export interface SnapOptions {
  bounds: Rect;
  others: readonly Rect[];
  kind?: GestureKind;
  threshold?: number;
  minimumSize?: Readonly<Pick<Rect, "w" | "h">>;
}

export interface SnapResult {
  rect: Rect;
  guides: SnapGuide[];
}

export interface ResolveOverlapOptions {
  maxIterations?: number;
  separation?: number;
  tolerance?: number;
}

export interface ResolveOverlapResult {
  rect: Rect;
  resolved: boolean;
  reverted: boolean;
  iterations: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function limit(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function minimumSize(
  value: Readonly<Pick<Rect, "w" | "h">> = MIN_BLOCK_SIZE,
): Pick<Rect, "w" | "h"> {
  return {
    w: Math.max(0, finiteOr(value.w, MIN_BLOCK_SIZE.w)),
    h: Math.max(0, finiteOr(value.h, MIN_BLOCK_SIZE.h)),
  };
}

export function isResizeHandle(value: string): value is ResizeHandle {
  return (RESIZE_HANDLES as readonly string[]).includes(value);
}

export function canTransformBlock(blockId: BlockId, mode: Mode): boolean {
  return mode === "custom" && blockId !== "map";
}

/** Converts a screen-space pointer delta to physical sheet millimetres. */
export function pixelsToMillimetres(
  deltaPx: number,
  sheetScale: number,
): number {
  const divisor = MM_TO_PX * sheetScale;
  return divisor > 0 && Number.isFinite(divisor) ? deltaPx / divisor : 0;
}

export function pointerDeltaMm(
  start: Point,
  current: Point,
  sheetScale: number,
): Point {
  return {
    x: pixelsToMillimetres(current.x - start.x, sheetScale),
    y: pixelsToMillimetres(current.y - start.y, sheetScale),
  };
}

/** Keeps a rectangle, including its size, wholly inside the printable bounds. */
export function clampRect(
  rect: Rect,
  bounds: Rect,
  requestedMinimum: Readonly<Pick<Rect, "w" | "h">> | number = MIN_BLOCK_SIZE,
  requestedMinimumHeight = MIN_BLOCK_SIZE.h,
): Rect {
  const min = minimumSize(
    typeof requestedMinimum === "number"
      ? { w: requestedMinimum, h: requestedMinimumHeight }
      : requestedMinimum,
  );
  const boundsWidth = Math.max(0, finiteOr(bounds.w, 0));
  const boundsHeight = Math.max(0, finiteOr(bounds.h, 0));
  const width = limit(
    finiteOr(rect.w, min.w),
    Math.min(min.w, boundsWidth),
    boundsWidth,
  );
  const height = limit(
    finiteOr(rect.h, min.h),
    Math.min(min.h, boundsHeight),
    boundsHeight,
  );
  const left = finiteOr(bounds.x, 0);
  const top = finiteOr(bounds.y, 0);

  return {
    x: limit(finiteOr(rect.x, left), left, left + boundsWidth - width),
    y: limit(finiteOr(rect.y, top), top, top + boundsHeight - height),
    w: width,
    h: height,
  };
}

export const clampToBounds = clampRect;

/** Applies an unsnapped move or one of the eight resize handles in millimetres. */
export function gestureRect(
  start: Rect,
  kind: GestureKind,
  delta: Point,
  requestedMinimum: Readonly<Pick<Rect, "w" | "h">> = MIN_BLOCK_SIZE,
): Rect {
  if (kind === "move") {
    return {
      ...start,
      x: start.x + delta.x,
      y: start.y + delta.y,
    };
  }

  const min = minimumSize(requestedMinimum);
  const originalRight = start.x + start.w;
  const originalBottom = start.y + start.h;
  let left = start.x;
  let right = originalRight;
  let top = start.y;
  let bottom = originalBottom;

  if (kind.includes("w")) {
    left = Math.min(originalRight - min.w, start.x + delta.x);
  }
  if (kind.includes("e")) {
    right = Math.max(start.x + min.w, originalRight + delta.x);
  }
  if (kind.includes("n")) {
    top = Math.min(originalBottom - min.h, start.y + delta.y);
  }
  if (kind.includes("s")) {
    bottom = Math.max(start.y + min.h, originalBottom + delta.y);
  }

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

interface SnapCandidate {
  delta: number;
  target: number;
}

function axisTargets(rects: readonly Rect[], bounds: Rect, axis: "x" | "y"): number[] {
  const targets: number[] = [];
  const startKey = axis;
  const sizeKey = axis === "x" ? "w" : "h";

  for (const rect of [...rects, bounds]) {
    const start = rect[startKey];
    const size = rect[sizeKey];
    targets.push(start, start + size / 2, start + size);
  }

  return targets;
}

function nearestSnap(
  values: readonly number[],
  targets: readonly number[],
  threshold: number,
): SnapCandidate | null {
  let nearest: SnapCandidate | null = null;

  for (const value of values) {
    for (const target of targets) {
      const delta = target - value;
      if (
        Math.abs(delta) <= threshold &&
        (!nearest || Math.abs(delta) < Math.abs(nearest.delta))
      ) {
        nearest = { delta, target };
      }
    }
  }

  return nearest;
}

/**
 * Snaps moving edges/centres or active resize edges against other blocks and
 * the safe-area edges/centres. The returned guide coordinates remain in mm.
 */
export function snapRect(rect: Rect, options: SnapOptions): SnapResult;
export function snapRect(
  rect: Rect,
  others: readonly Rect[],
  bounds: Rect,
  kind?: GestureKind,
): SnapResult;
export function snapRect(
  rect: Rect,
  optionsOrOthers: SnapOptions | readonly Rect[],
  legacyBounds?: Rect,
  legacyKind: GestureKind = "move",
): SnapResult {
  const options: SnapOptions = Array.isArray(optionsOrOthers)
    ? {
        others: optionsOrOthers,
        bounds: legacyBounds ?? rect,
        kind: legacyKind,
      }
    : (optionsOrOthers as SnapOptions);
  const kind = options.kind ?? "move";
  const threshold = Math.max(
    0,
    finiteOr(options.threshold ?? SNAP_THRESHOLD_MM, SNAP_THRESHOLD_MM),
  );
  const min = minimumSize(options.minimumSize);
  const xTargets = axisTargets(options.others, options.bounds, "x");
  const yTargets = axisTargets(options.others, options.bounds, "y");
  const snapped = { ...rect };
  const guides: SnapGuide[] = [];

  if (kind === "move") {
    const xSnap = nearestSnap(
      [snapped.x, snapped.x + snapped.w / 2, snapped.x + snapped.w],
      xTargets,
      threshold,
    );
    if (xSnap) {
      snapped.x += xSnap.delta;
      guides.push({ axis: "x", position: xSnap.target });
    }

    const ySnap = nearestSnap(
      [snapped.y, snapped.y + snapped.h / 2, snapped.y + snapped.h],
      yTargets,
      threshold,
    );
    if (ySnap) {
      snapped.y += ySnap.delta;
      guides.push({ axis: "y", position: ySnap.target });
    }
  } else {
    if (kind.includes("e")) {
      const edge = snapped.x + snapped.w;
      const match = nearestSnap([edge], xTargets, threshold);
      if (match && snapped.w + match.delta >= min.w) {
        snapped.w += match.delta;
        guides.push({ axis: "x", position: match.target });
      }
    }
    if (kind.includes("w")) {
      const fixedRight = snapped.x + snapped.w;
      const match = nearestSnap([snapped.x], xTargets, threshold);
      if (match && fixedRight - match.target >= min.w) {
        snapped.x = match.target;
        snapped.w = fixedRight - match.target;
        guides.push({ axis: "x", position: match.target });
      }
    }
    if (kind.includes("s")) {
      const edge = snapped.y + snapped.h;
      const match = nearestSnap([edge], yTargets, threshold);
      if (match && snapped.h + match.delta >= min.h) {
        snapped.h += match.delta;
        guides.push({ axis: "y", position: match.target });
      }
    }
    if (kind.includes("n")) {
      const fixedBottom = snapped.y + snapped.h;
      const match = nearestSnap([snapped.y], yTargets, threshold);
      if (match && fixedBottom - match.target >= min.h) {
        snapped.y = match.target;
        snapped.h = fixedBottom - match.target;
        guides.push({ axis: "y", position: match.target });
      }
    }
  }

  return {
    rect: clampRect(snapped, options.bounds, min),
    guides,
  };
}

export const snap = snapRect;

/** True only when the rectangles share positive area beyond the tolerance. */
export function overlaps(
  first: Rect,
  second: Rect,
  tolerance = OVERLAP_TOLERANCE_MM,
): boolean {
  const epsilon = Math.max(0, finiteOr(tolerance, 0));
  return (
    first.x < second.x + second.w - epsilon &&
    second.x < first.x + first.w - epsilon &&
    first.y < second.y + second.h - epsilon &&
    second.y < first.y + first.h - epsilon
  );
}

export const rectsOverlap = overlaps;

export function overlappingRects(
  rect: Rect,
  others: readonly Rect[],
  tolerance = OVERLAP_TOLERANCE_MM,
): Rect[] {
  return others.filter((other) => overlaps(rect, other, tolerance));
}

interface TranslationCandidate {
  rect: Rect;
  distance: number;
}

function separatingTranslations(
  rect: Rect,
  obstacle: Rect,
  bounds: Rect,
  separation: number,
  tolerance: number,
): TranslationCandidate[] {
  const candidates = [
    { ...rect, x: obstacle.x - separation - rect.w },
    { ...rect, x: obstacle.x + obstacle.w + separation },
    { ...rect, y: obstacle.y - separation - rect.h },
    { ...rect, y: obstacle.y + obstacle.h + separation },
  ];

  return candidates
    .map((candidate) => clampRect(candidate, bounds, { w: rect.w, h: rect.h }))
    .filter((candidate) => !overlaps(candidate, obstacle, tolerance))
    .map((candidate) => ({
      rect: candidate,
      distance: Math.abs(candidate.x - rect.x) + Math.abs(candidate.y - rect.y),
    }));
}

/**
 * Pushes a dropped block along the shortest separating axis. If twelve passes
 * cannot produce a collision-free result, the exact gesture-start rect wins.
 */
function resolveOverlapsResult(
  candidate: Rect,
  others: readonly Rect[],
  bounds: Rect,
  initialRect: Rect,
  options: ResolveOverlapOptions = {},
): ResolveOverlapResult {
  const maxIterations = Math.max(
    0,
    Math.floor(options.maxIterations ?? MAX_OVERLAP_ITERATIONS),
  );
  const separation = Math.max(
    0,
    finiteOr(options.separation ?? OVERLAP_SEPARATION_MM, OVERLAP_SEPARATION_MM),
  );
  const tolerance = Math.max(
    0,
    finiteOr(options.tolerance ?? OVERLAP_TOLERANCE_MM, OVERLAP_TOLERANCE_MM),
  );
  let current = clampRect(candidate, bounds, {
    w: Math.min(candidate.w, bounds.w),
    h: Math.min(candidate.h, bounds.h),
  });
  let iterations = 0;

  while (iterations < maxIterations) {
    const collisions = overlappingRects(current, others, tolerance);
    if (collisions.length === 0) {
      return { rect: current, resolved: true, reverted: false, iterations };
    }

    const moves = collisions.flatMap((obstacle) =>
      separatingTranslations(
        current,
        obstacle,
        bounds,
        separation,
        tolerance,
      ),
    );
    moves.sort((first, second) => first.distance - second.distance);
    const best = moves[0];
    if (!best || best.distance === 0) break;
    current = best.rect;
    iterations += 1;
  }

  if (overlappingRects(current, others, tolerance).length === 0) {
    return { rect: current, resolved: true, reverted: false, iterations };
  }

  return {
    rect: { ...initialRect },
    resolved: false,
    reverted: true,
    iterations,
  };
}

export function resolveOverlaps(
  candidate: Rect,
  others: readonly Rect[],
  bounds: Rect,
  initialRect: Rect,
  options?: ResolveOverlapOptions,
): ResolveOverlapResult;
export function resolveOverlaps(
  candidate: Rect,
  others: readonly Rect[],
  bounds: Rect,
  maxIterations?: number,
  separation?: number,
): Rect | null;
export function resolveOverlaps(
  candidate: Rect,
  others: readonly Rect[],
  bounds: Rect,
  initialOrIterations: Rect | number = MAX_OVERLAP_ITERATIONS,
  optionsOrSeparation: ResolveOverlapOptions | number = OVERLAP_SEPARATION_MM,
): ResolveOverlapResult | Rect | null {
  if (typeof initialOrIterations === "number") {
    const result = resolveOverlapsResult(candidate, others, bounds, candidate, {
      maxIterations: initialOrIterations,
      separation:
        typeof optionsOrSeparation === "number"
          ? optionsOrSeparation
          : optionsOrSeparation.separation,
      tolerance:
        typeof optionsOrSeparation === "number"
          ? undefined
          : optionsOrSeparation.tolerance,
    });
    return result.resolved ? result.rect : null;
  }

  return resolveOverlapsResult(
    candidate,
    others,
    bounds,
    initialOrIterations,
    typeof optionsOrSeparation === "number" ? {} : optionsOrSeparation,
  );
}

export const resolveOverlap = resolveOverlaps;
