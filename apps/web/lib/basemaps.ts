/**
 * Shared basemap sources.
 *
 * These used to be `basemaps.cartocdn.com` URLs written inline in each map
 * component, from when that CDN served tiles to anyone. It no longer does: it
 * still answers `200` with a well-formed PNG, but stamps "API KEY REQUIRED"
 * diagonally across every tile. No code can detect that — the fetch succeeds,
 * Leaflet is happy, and only a human looking at the screen can tell. And
 * because the URL was duplicated across the Previene viewer and the Geoportal,
 * the watermark had to be hunted down twice.
 *
 * OpenFreeMap replaces it: no key, no account, no per-domain registration, so
 * there is no credential to publish in a bundle, leak or let expire. The
 * trade-off is that its tiles are vector, which is why the map components
 * render them through MapLibre (`L.maplibreGL`) instead of `L.tileLayer`.
 *
 * Keep every basemap URL in this file. A provider changing its terms is the
 * failure mode to expect, and having one place to edit is the whole point.
 *
 * ── Do not upgrade maplibre-gl past v5 ──────────────────────────────────────
 *
 * `maplibre-gl` is pinned to ^5 by an `overrides` entry in the ROOT
 * package.json, which also forces the version the Leaflet plugin resolves —
 * npm would otherwise install a second, newer copy for its peer dependency and
 * the plugin would use that one.
 *
 * v6 derives its web worker's URL from `import.meta.url` at runtime. Webpack
 * freezes that at build time to the path inside the build container, so the
 * browser evaluates:
 *
 *     let t = "file:///app/node_modules/maplibre-gl/dist/maplibre-gl.mjs";
 *     if (!/^https?:/.test(t)) return "";   // file:// → no worker URL
 *
 * With no worker, MapLibre parses no tiles and the map renders blank. There is
 * no thrown error and no failed request — only a `console.warn` — so it looks
 * exactly like a styling bug. v5 inlines the worker and starts it from a
 * `Blob`, so no path survives from build to runtime. That is the whole reason
 * for the pin: it is not conservatism about a major version.
 */

/** MapLibre style documents. Vector — consumed via `L.maplibreGL({ style })`. */
export const OPENFREEMAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/**
 * OpenStreetMap for the data, OpenMapTiles for the schema, OpenFreeMap for the
 * hosting. All three ask to be credited and the ODbL requires the first, so
 * this string is not decoration.
 */
export const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &middot; ' +
  '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> &middot; ' +
  '<a href="https://openfreemap.org/">OpenFreeMap</a>';
