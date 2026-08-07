import assert from "node:assert/strict";
import test from "node:test";
import { bucketByGrid, countRepresented, mergeNearby } from "../lib/previene-cluster";

/**
 * The viewer promises "N de M reportes visibles". These tests hold the map to
 * that promise: whatever the zoom, the markers on screen must account for every
 * visible report exactly once — no report swallowed by a cluster it is not
 * counted in, no report drawn twice.
 */

interface Point {
  id: string;
  x: number;
  y: number;
}

const project = (p: Point) => ({ x: p.x, y: p.y });

/** Deterministic pseudo-random spread, so a failure is reproducible. */
function scatter(count: number, seed = 7): Point[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    x: next() * 1200,
    y: next() * 800,
  }));
}

test("every report is represented exactly once, at any cell size", () => {
  const points = scatter(240);
  for (const cell of [12, 46, 120, 400]) {
    const buckets = bucketByGrid(points, project, cell);
    assert.equal(
      countRepresented(buckets),
      points.length,
      `cell ${cell}px must represent all ${points.length} reports`,
    );

    const seen = new Set<string>();
    for (const bucket of buckets) {
      for (const point of bucket) {
        assert.ok(!seen.has(point.id), `${point.id} appears in more than one bucket`);
        seen.add(point.id);
      }
    }
    assert.equal(seen.size, points.length);
  }
});

test("an empty set produces no markers rather than an empty cluster", () => {
  const buckets = bucketByGrid([], project, 46);
  assert.equal(buckets.length, 0);
  assert.equal(countRepresented(buckets), 0);
});

test("reports far apart are never merged", () => {
  const points: Point[] = [
    { id: "santa-cruz", x: 100, y: 100 },
    { id: "san-cristobal", x: 900, y: 300 },
    { id: "isabela", x: 200, y: 700 },
  ];
  const buckets = bucketByGrid(points, project, 46);
  assert.equal(buckets.length, 3);
  assert.ok(buckets.every((bucket) => bucket.length === 1));
});

test("reports within one cell collapse into a single badge", () => {
  // Three reports from the same street corner — the repeat-report case, where
  // one person sends several updates from the same spot.
  const points: Point[] = [
    { id: "a", x: 470, y: 470 },
    { id: "b", x: 475, y: 472 },
    { id: "c", x: 480, y: 468 },
  ];
  const buckets = bucketByGrid(points, project, 46);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].length, 3);
});

test("the merge pass repairs neighbours split by a cell boundary", () => {
  // A fixed grid splits neighbours that fall either side of a boundary, and two
  // markers 2px apart read as one smudge. bucketByGrid alone leaves them
  // separate; the merge pass is what makes the map legible.
  const points: Point[] = [
    { id: "left", x: 45, y: 10 },
    { id: "right", x: 47, y: 10 },
  ];
  const gridOnly = bucketByGrid(points, project, 46);
  assert.equal(gridOnly.length, 2, "the grid alone splits them");

  const merged = mergeNearby(gridOnly, project, 22);
  assert.equal(merged.length, 1, "markers closer than one marker width become one badge");
  assert.equal(countRepresented(merged), 2, "merging must not change the total");
});

test("merging never loses, duplicates or invents a report", () => {
  const points = scatter(180, 21);
  for (const zoomLikeSpread of [1, 4, 16, 64]) {
    const scaled = points.map((p) => ({ ...p, x: p.x / zoomLikeSpread, y: p.y / zoomLikeSpread }));
    const merged = mergeNearby(bucketByGrid(scaled, project, 46), project, 22);

    assert.equal(countRepresented(merged), scaled.length);
    const seen = new Set(merged.flat().map((p) => p.id));
    assert.equal(seen.size, scaled.length, "every report appears exactly once");
  }
});

test("merging leaves no two markers closer than one marker width", () => {
  const points = scatter(150, 99);
  const merged = mergeNearby(bucketByGrid(points, project, 46), project, 22);
  const centres = merged.map((bucket) => ({
    x: bucket.reduce((a, p) => a + p.x, 0) / bucket.length,
    y: bucket.reduce((a, p) => a + p.y, 0) / bucket.length,
  }));
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = i + 1; j < centres.length; j += 1) {
      const distance = Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y);
      assert.ok(distance >= 22, `markers ${i} and ${j} are ${distance.toFixed(1)}px apart`);
    }
  }
});

test("a large cell still accounts for everything it swallows", () => {
  const points = scatter(60);
  const buckets = bucketByGrid(points, project, 10_000);
  assert.equal(buckets.length, 1, "one cell covers the whole viewport");
  assert.equal(buckets[0].length, points.length);
});

test("non-finite coordinates are dropped instead of merging unrelated reports", () => {
  const points: Point[] = [
    { id: "ok", x: 10, y: 10 },
    { id: "broken-x", x: Number.NaN, y: 10 },
    { id: "broken-y", x: 10, y: Number.POSITIVE_INFINITY },
  ];
  const buckets = bucketByGrid(points, project, 46);
  assert.equal(countRepresented(buckets), 1);
  assert.equal(buckets[0][0].id, "ok");
});

test("a non-positive cell size is rejected rather than dividing by zero", () => {
  assert.throws(() => bucketByGrid(scatter(3), project, 0));
});
