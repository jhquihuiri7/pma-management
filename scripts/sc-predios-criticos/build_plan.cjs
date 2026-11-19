// Builds the load plan for "Predios y Vías Rurales Críticas de San Cristóbal"
// (delivery Hidrología_San_Cristobal.zip, 2026-11-19): one map with the 7
// shapefiles plus the BDG 1:50.000 base layers.
//   node build_plan.cjs <work dir> <base.json> <staging dir>
// <work dir> is the output of container_prepare.sh. Checks every layer against
// GDAL's feature count, San Cristóbal's extent and the size limit, and writes
// staging/plan.json plus the GeoJSON and source .zip per layer.
const fs = require("fs");
const path = require("path");

const [work, baseJson, staging] = process.argv.slice(2);
const VECTOR_MAX_FILE_BYTES = 75 * 1024 * 1024;
// San Cristóbal with margin (degrees). `vias` is the OSM road network of the
// three inhabited islands, so it is checked against the archipelago instead.
const SAN_CRISTOBAL = [-89.70, -1.00, -89.20, -0.60];
const ARCHIPELAGO = [-92.10, -1.50, -89.20, 0.70];
const TAG = "San Cristóbal";
const TITLE = "Predios y Vías Rurales Críticas de San Cristóbal";

const style = (s) => ({
  mode: "single", color: "#3f7c5f", palette: "categorical", ramp: "earth", classification: "quantile",
  classes: 5, colorBy: null, opacity: 1, strokeWidth: 1, size: 6, labels: false, labelField: null, ...s,
});

// Bottom to top. Colors follow the .sld of each layer as far as the Geoportal
// symbology allows (one fill color or a palette by field; polygon outlines are
// always dark gray).
const LAYERS = [
  { name: "cuencas_hidrograficas", area: SAN_CRISTOBAL, visible: true,
    style: style({ color: "#209e67", opacity: 0.3, strokeWidth: 2 }) },
  { name: "microcuencas", area: SAN_CRISTOBAL, visible: false,
    style: style({ color: "#e06601", opacity: 0.35, strokeWidth: 1 }) },
  { name: "predios_rurales_criticos", area: SAN_CRISTOBAL, visible: true,
    style: style({ mode: "category", colorBy: "RECLASS", opacity: 0.75, strokeWidth: 1 }) },
  { name: "curvas_nivel_10m", area: SAN_CRISTOBAL, visible: false,
    style: style({ color: "#be7d46", opacity: 0.8, strokeWidth: 0 }) },
  { name: "rios_orden_strahler", area: SAN_CRISTOBAL, visible: true, allowNullGeometry: 1,
    style: style({ color: "#008cd2", opacity: 1, strokeWidth: 1 }) },
  { name: "vias", area: ARCHIPELAGO, visible: true,
    style: style({ mode: "category", colorBy: "jerarquia", palette: "viridis", opacity: 0.9, strokeWidth: 0 }) },
  { name: "vias_criticas", area: SAN_CRISTOBAL, visible: true,
    style: style({ color: "#c8102e", opacity: 1, strokeWidth: 0, size: 7 }) },
];

const DESCRIPTION = [
  "Predios rurales y puntos de vías rurales críticos de la isla San Cristóbal por su relación con la red de drenaje, " +
    "con la hidrología de la isla como contexto.",
  "Predios rurales críticos (111, parroquia El Progreso): todos atraviesan un cauce; LONG_RIO_M es el largo de río " +
    "dentro del predio. Color por «RECLASS» (agrícola, pecuario, habitacional).",
  "Vías críticas (49 puntos, en rojo): cruces de la red vial con ríos de primer y segundo orden (RIO_CLASE).",
  "Hidrología: cuencas hidrográficas (56), microcuencas (141, oculta), ríos por orden de Strahler (270) y curvas de " +
    "nivel cada 10 m (1.898, oculta); ríos y curvas derivados de un modelo digital del terreno de 10 m.",
  "Red vial de OpenStreetMap al 31-oct-2026 para San Cristóbal, Santa Cruz e Isabela (color por «jerarquia»).",
  "Un tramo de río de primer orden (24 m) viene sin geometría en el original y queda solo en la tabla.",
  "Cada capa guarda como fuente el shapefile original con sus estilos .qml y .sld y su copia KML.",
  "Capas base: 1:50.000 (BDG Galápagos: mar, islas, toponimia y centros poblados).",
].join(" ");

function inspect(fc, area) {
  const types = new Set();
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let nulls = 0, outside = 0;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      bbox[0] = Math.min(bbox[0], c[0]); bbox[1] = Math.min(bbox[1], c[1]);
      bbox[2] = Math.max(bbox[2], c[0]); bbox[3] = Math.max(bbox[3], c[1]);
      if (c[0] < area[0] || c[0] > area[2] || c[1] < area[1] || c[1] > area[3]) outside++;
      return;
    }
    c.forEach(visit);
  };
  for (const f of fc.features) {
    if (!f.geometry) { nulls++; continue; }
    types.add(f.geometry.type.replace(/^Multi/, ""));
    visit(f.geometry.coordinates);
  }
  return { types: [...types], bbox, nulls, outside };
}

function prepare(l) {
  const fc = JSON.parse(fs.readFileSync(path.join(work, "geojson", `${l.name}.geojson`), "utf8"));
  const ogrinfo = fs.readFileSync(path.join(work, "logs", `${l.name}.ogrinfo`), "utf8");
  const expected = Number(/Feature Count: (\d+)/.exec(ogrinfo)?.[1]);
  const epsg = /ID\["EPSG",(\d+)\]\]\s*$/m.exec(ogrinfo)?.[1];
  const errors = [];
  const info = inspect(fc, l.area);
  if (fc.features.length !== expected) errors.push(`registros: GDAL ${expected}, convertidos ${fc.features.length}`);
  if (info.nulls !== (l.allowNullGeometry ?? 0)) errors.push(`${info.nulls} registro(s) sin geometría`);
  if (info.outside) errors.push(`${info.outside} vértice(s) fuera del área esperada`);
  if (info.types.length !== 1) errors.push(`geometrías mezcladas: ${info.types.join(", ")}`);
  const text = JSON.stringify(fc);
  if (Buffer.byteLength(text) > VECTOR_MAX_FILE_BYTES) errors.push("el GeoJSON supera 75 MB");
  const fields = Object.keys(fc.features[0]?.properties ?? {});
  if (l.style.colorBy && !fields.includes(l.style.colorBy)) errors.push(`no existe el campo ${l.style.colorBy}`);
  const dataRel = `data/${l.name}.geojson`, sourceRel = `source/${l.name}.zip`;
  fs.writeFileSync(path.join(staging, dataRel), text);
  fs.copyFileSync(path.join(work, "source", `${l.name}.zip`), path.join(staging, sourceRel));
  const categories = l.style.colorBy
    ? [...new Set(fc.features.map((f) => f.properties[l.style.colorBy]))] : [];
  return {
    role: "thematic", name: l.name, geometry: info.types[0], featureCount: fc.features.length, indexCount: expected,
    sourceCrs: epsg ? `EPSG:${epsg}` : null, bbox: info.bbox, nullGeometries: info.nulls,
    dataRel, sourceRel, sizeBytes: Buffer.byteLength(text), fields, categories,
    style: l.style, visible: l.visible, ok: errors.length === 0, errors,
  };
}

const base = JSON.parse(fs.readFileSync(baseJson, "utf8"));
const byName = (n) => base.find((b) => b.name === n) || (() => { throw new Error(`capa base ${n} no encontrada`); })();
fs.mkdirSync(path.join(staging, "data"), { recursive: true });
fs.mkdirSync(path.join(staging, "source"), { recursive: true });

const own = LAYERS.map(prepare);
const ordered = [
  ...["rejilla_ocea_arch_50m_utm15s_wgs84", "islas_arch_50m_utm15_wgs84"].map((n) => ({ role: "base", scale: "1:50.000", ...byName(n), visible: true })),
  ...own,
  ...["toponimia_arch_50m_utm15s_wgs84", "Centros_poblados_100m_utm15s_wgs84"].map((n) => ({ role: "base", scale: "1:50.000", ...byName(n), visible: true })),
].map((l, zIndex) => ({ ...l, zIndex }));

const map = {
  title: TITLE, categoryId: "fisico-ambiental", thematic: "Amenazas naturales", description: DESCRIPTION,
  center: [-0.905, -89.51], zoom: 12, tags: [TAG, "Hidrología", "Predios rurales"], layers: ordered, rasters: [],
};
fs.writeFileSync(path.join(staging, "plan.json"), JSON.stringify({ tag: TAG, maps: [map] }, null, 1));

console.log(`capas: ${ordered.length} (propias ${own.length}, con error ${own.filter((l) => !l.ok).length})`);
for (const l of own) {
  console.log(`${l.ok ? "OK " : "ERR"} ${l.name}: ${l.featureCount}/${l.indexCount} ${l.geometry} ${l.sourceCrs} ` +
    `${(l.sizeBytes / 1048576).toFixed(1)} MB${l.categories.length ? ` | ${l.style.colorBy}: ${l.categories.join(", ")}` : ""}` +
    `${l.errors.length ? " — " + l.errors.join("; ") : ""}`);
}
