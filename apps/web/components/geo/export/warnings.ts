import { rects, safeBounds } from "./layout";
import { overlaps } from "./interaction";
import {
  BLOCK_NAMES,
  type BlockId,
  type BuilderState,
  type Rect,
} from "./types";

export interface WarningContext {
  /** IDs of the layers that can currently appear in the legend. */
  legendLayerIds?: readonly string[];
  /** Alternative for callers that only know a count. */
  legendLayerCount?: number;
  /** Overrides state.options when elevation availability is resolved lazily. */
  elevationHasData?: boolean;
}

function isOutside(rect: Rect, bounds: Rect): boolean {
  const epsilon = 0.01;
  return (
    rect.x < bounds.x - epsilon ||
    rect.y < bounds.y - epsilon ||
    rect.x + rect.w > bounds.x + bounds.w + epsilon ||
    rect.y + rect.h > bounds.y + bounds.h + epsilon
  );
}

function activeEntries(state: BuilderState): Array<[BlockId, Rect]> {
  return Object.entries(rects(state)).filter(
    (entry): entry is [BlockId, Rect] => {
      const [block, rect] = entry as [BlockId, Rect | undefined];
      return Boolean(rect) && (block === "map" || state.visible[block]);
    },
  );
}

function legendIsEmpty(
  state: BuilderState,
  context: WarningContext,
): boolean {
  if (context.legendLayerIds) {
    const excluded = new Set(state.options.legendExcludedLayerIds);
    return !context.legendLayerIds.some((id) => !excluded.has(id));
  }

  if (typeof context.legendLayerCount === "number") {
    return (
      Math.max(0, Math.floor(context.legendLayerCount)) <=
      state.options.legendExcludedLayerIds.length
    );
  }

  return false;
}

/** Non-blocking validation messages shown in the editor status bar. */
export function getExportWarnings(
  state: BuilderState,
  context: WarningContext = {},
): string[] {
  const messages = new Set<string>();
  const bounds = safeBounds(state.format, state.orientation);
  const entries = activeEntries(state);

  for (const [block, rect] of entries) {
    if (isOutside(rect, bounds)) {
      messages.add(`${BLOCK_NAMES[block]} sale del área imprimible`);
    }
    if (block !== "map" && (rect.w < 26 || rect.h < 11)) {
      messages.add(`${BLOCK_NAMES[block]} es demasiado pequeño para leerse`);
    }
  }

  for (let first = 0; first < entries.length; first += 1) {
    for (let second = first + 1; second < entries.length; second += 1) {
      const [firstBlock, firstRect] = entries[first];
      const [secondBlock, secondRect] = entries[second];
      if (overlaps(firstRect, secondRect, 0)) {
        messages.add(
          `${BLOCK_NAMES[firstBlock]} se superpone con ${BLOCK_NAMES[secondBlock]}`,
        );
      }
    }
  }

  const elevationHasData =
    context.elevationHasData ?? state.options.elevationHasData;
  if (state.visible.elevation && !elevationHasData) {
    messages.add("Perfil de elevación sin datos disponibles");
  }

  if (
    state.visible.docs &&
    state.visible.doc_notas &&
    !(state.texts.notas ?? "").trim()
  ) {
    messages.add("El campo Notas está vacío");
  }

  if (state.visible.legend && legendIsEmpty(state, context)) {
    messages.add("La leyenda no incluye ninguna capa");
  }

  return Array.from(messages);
}

export const warnings = getExportWarnings;
export const validateExport = getExportWarnings;
