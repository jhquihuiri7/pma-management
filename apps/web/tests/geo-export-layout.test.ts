import assert from "node:assert/strict";
import test from "node:test";

import { overlaps } from "../components/geo/export/interaction";
import {
  autoLayout,
  formatScale,
  paperSize,
  rects,
  safeBounds,
} from "../components/geo/export/layout";
import { templateVisibility } from "../components/geo/export/templates";
import {
  createDefaultBuilderOptions,
  type BlockId,
  type BuilderState,
  type Format,
  type LayoutRects,
  type Orientation,
  type Rect,
} from "../components/geo/export/types";

function builderState(
  format: Format,
  orientation: Orientation,
): BuilderState {
  return {
    format,
    orientation,
    mode: "auto",
    zoom: 1,
    selected: null,
    template: "tecnica",
    showMargins: true,
    visible: templateVisibility("tecnica"),
    overrides: {},
    texts: { notas: "Carta de prueba" },
    options: createDefaultBuilderOptions(),
    extent: "actual",
  };
}

function entries(layout: LayoutRects): Array<[BlockId, Rect]> {
  return Object.entries(layout).filter(
    (entry): entry is [BlockId, Rect] => Boolean(entry[1]),
  );
}

function assertInside(rect: Rect, bounds: Rect, label: string): void {
  const epsilon = 1e-8;
  assert.ok(rect.w > 0, `${label}: ancho positivo`);
  assert.ok(rect.h > 0, `${label}: alto positivo`);
  assert.ok(rect.x >= bounds.x - epsilon, `${label}: borde izquierdo`);
  assert.ok(rect.y >= bounds.y - epsilon, `${label}: borde superior`);
  assert.ok(
    rect.x + rect.w <= bounds.x + bounds.w + epsilon,
    `${label}: borde derecho`,
  );
  assert.ok(
    rect.y + rect.h <= bounds.y + bounds.h + epsilon,
    `${label}: borde inferior`,
  );
}

function assertNoOverlaps(layout: LayoutRects): void {
  const blocks = entries(layout);
  for (let first = 0; first < blocks.length; first += 1) {
    for (let second = first + 1; second < blocks.length; second += 1) {
      assert.equal(
        overlaps(blocks[first][1], blocks[second][1], 0),
        false,
        `${blocks[first][0]} no debe solaparse con ${blocks[second][0]}`,
      );
    }
  }
}

const combinations: ReadonlyArray<{
  format: Format;
  orientation: Orientation;
  paper: readonly [number, number];
}> = [
  { format: "A4", orientation: "h", paper: [297, 210] },
  { format: "A4", orientation: "v", paper: [210, 297] },
  { format: "A3", orientation: "h", paper: [420, 297] },
  { format: "A3", orientation: "v", paper: [297, 420] },
];

for (const { format, orientation, paper } of combinations) {
  test(`auto-layout técnico ${format} ${orientation} usa mm, permanece dentro de márgenes y no se solapa`, () => {
    const state = builderState(format, orientation);
    const layout = autoLayout(state);
    const bounds = safeBounds(format, orientation);

    assert.deepEqual(paperSize(format, orientation), {
      w: paper[0],
      h: paper[1],
    });
    assert.ok(layout.map, "el mapa siempre existe");
    assert.equal(
      layout.header?.h,
      (orientation === "h" ? 20 : 24) * formatScale(format),
    );

    for (const [block, rect] of entries(layout)) {
      assertInside(rect, bounds, block);
    }
    assertNoOverlaps(layout);

    const otherAreas = entries(layout)
      .filter(([block]) => block !== "map")
      .map(([, rect]) => rect.w * rect.h);
    assert.ok(
      otherAreas.every((area) => layout.map.w * layout.map.h > area),
      "el mapa debe ser el bloque de mayor superficie",
    );

    if (orientation === "h") {
      assert.ok(
        layout.map.w >= bounds.w * 0.55 - 1e-8,
        "el mapa conserva al menos 55 % del ancho útil",
      );
    }
  });
}

test("techinfo horizontal reserva una columna válida incluso sin módulos laterales", () => {
  const state = builderState("A4", "h");
  for (const toggle of Object.keys(state.visible) as Array<keyof typeof state.visible>) {
    state.visible[toggle] = false;
  }
  state.visible.techinfo = true;
  state.visible.map = false;

  const layout = autoLayout(state);
  const bounds = safeBounds(state.format, state.orientation);
  const techinfo = layout.techinfo;

  assert.ok(techinfo, "Información técnica debe estar maquetada");
  assertInside(layout.map, bounds, "map");
  assertInside(techinfo, bounds, "techinfo");
  assert.equal(techinfo.x + techinfo.w, bounds.x + bounds.w);
  assert.ok(layout.map.w >= bounds.w * 0.55);
  assertNoOverlaps(layout);
});

test("el modo custom aplica overrides salvo al mapa bloqueado", () => {
  const state = builderState("A3", "v");
  const automatic = autoLayout(state);
  const legendOverride = { x: 24, y: 190, w: 64, h: 30 };
  state.mode = "custom";
  state.overrides = {
    legend: legendOverride,
    map: { x: 0, y: 0, w: 1, h: 1 },
  };

  const custom = rects(state);
  assert.deepEqual(custom.legend, legendOverride);
  assert.deepEqual(custom.map, automatic.map);
});
