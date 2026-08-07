/**
 * Grid clustering for the reports map.
 *
 * Kept as a pure function, away from Leaflet, for one reason: the viewer's
 * headline number ("N de M reportes visibles") is only honest if every visible
 * report is drawn exactly once — either as its own marker or inside exactly one
 * cluster badge. That is an invariant worth testing, and it cannot be tested
 * through a map instance.
 *
 * Deliberately not leaflet.markercluster: its internal bookkeeping
 * (`__parent`, `_childClusters`, `_featureGroup`) desynchronises from the data
 * when the layer is rebuilt on every filter change, which is exactly this
 * viewer's usage pattern.
 */

export interface ProjectedPoint {
  x: number;
  y: number;
}

/**
 * Group items into square cells of `cellPx` pixels in projected space.
 * Returns one array per occupied cell; single-item arrays become plain markers.
 */
export function bucketByGrid<T>(
  items: readonly T[],
  project: (item: T) => ProjectedPoint,
  cellPx: number
): T[][] {
  if (cellPx <= 0) throw new Error("cellPx must be positive");
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    const point = project(item);
    // Non-finite coordinates would collapse every such item into one cell
    // labelled "NaN|NaN"; they are excluded upstream, but guard anyway so a bad
    // row can never silently merge unrelated reports.
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const key = `${Math.floor(point.x / cellPx)}|${Math.floor(point.y / cellPx)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return Array.from(buckets.values());
}

/** Total reports represented on screen — must equal the visible count. */
export function countRepresented<T>(buckets: readonly T[][]): number {
  return buckets.reduce((total, bucket) => total + bucket.length, 0);
}

function centroid(points: readonly ProjectedPoint[]): ProjectedPoint {
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x, y };
}

/**
 * Merge buckets whose centres end up closer than a marker is wide.
 *
 * A fixed grid splits neighbours that happen to fall either side of a cell
 * boundary, and two markers 2px apart read as one smudge. Measured on the real
 * dataset this affected 2–3 pairs at zoom 11–13; this pass removes them while
 * keeping the result a partition, so the totals stay exact.
 */
export function mergeNearby<T>(
  buckets: readonly T[][],
  project: (item: T) => ProjectedPoint,
  minSeparationPx: number
): T[][] {
  if (minSeparationPx <= 0 || buckets.length < 2) return buckets.map((bucket) => [...bucket]);

  let current = buckets.map((bucket) => [...bucket]);
  // Merging moves centroids, which can bring a third bucket into range. A few
  // passes converge; the bound stops any pathological oscillation.
  for (let pass = 0; pass < 4; pass += 1) {
    const centres = current.map((bucket) => centroid(bucket.map(project)));
    const merged: T[][] = [];
    const consumed = new Set<number>();
    let didMerge = false;

    for (let i = 0; i < current.length; i += 1) {
      if (consumed.has(i)) continue;
      const group = [...current[i]];
      for (let j = i + 1; j < current.length; j += 1) {
        if (consumed.has(j)) continue;
        const dx = centres[i].x - centres[j].x;
        const dy = centres[i].y - centres[j].y;
        if (Math.hypot(dx, dy) < minSeparationPx) {
          group.push(...current[j]);
          consumed.add(j);
          didMerge = true;
        }
      }
      merged.push(group);
    }

    current = merged;
    if (!didMerge) break;
  }

  return current;
}
