// Builds the load plan for "Rutas y Predios Criticos Enos 2026 Galapagos" (map
// created empty on 2026-11-23): San Cristóbal layers copied from the map
// "Predios y Vías Rurales Críticas de San Cristóbal" (same stored data and source
// zip) plus the Santa_Cruz_shapefiles.zip delivery. Every layer gets the style of
// its delivery's .sld/.qml (scripts/sc-predios-criticos/styles.json for San
// Cristóbal, translated the same way for Santa Cruz), not later manual edits.
// Santa Cruz "Vias" is identical to San Cristóbal "vias" (OSM of the three
// islands: same 1.713 geometries and attributes), so it is loaded once.
//   node build_plan.cjs <work dir> <layers.json> <staging dir>
const fs = require("fs");
const path = require("path");

const [work, layersJson, staging] = process.argv.slice(2);
const VECTOR_MAX_FILE_BYTES = 75 * 1024 * 1024;
const SANTA_CRUZ = [-90.60, -0.90, -89.95, -0.38]; // coastal microcuencas reach -90.00
const TAG = "ENOS 2026";
const TITLE = "Rutas y Predios Criticos Enos 2026 Galapagos";
const SC = "San Cristóbal", SZ = "Santa Cruz";
const scStyles = JSON.parse(fs.readFileSync(path.join(__dirname, "../sc-predios-criticos/styles.json"), "utf8"));
const { base, sanCristobal } = JSON.parse(fs.readFileSync(layersJson, "utf8"));

// Same merge as sc-predios-criticos/apply_styles.mjs.
function merge(style, patch) {
  const s = { ...style, ...patch };
  for (const k of ["symbol", "categories", "otherSymbol", "labelStyle"]) if (!(k in patch)) delete s[k];
  return s;
}
const DEFAULT = {
  mode: "single", color: "#3f7c5f", palette: "categorical", ramp: "earth", classification: "quantile",
  classes: 5, colorBy: null, opacity: 1, strokeWidth: 1, size: 6, labels: false, labelField: null,
};

// Santa Cruz .qml → Geoportal symbology (same conventions as San Cristóbal).
const cuencaSz = {
  ...scStyles.cuencas_hidrograficas,
  categories: [
    { value: "Cuenca", label: "Cuenca (≥ 10 km²)", color: "#a9f2ff", fillOpacity: 0.031, strokeColor: "#209e67", strokeWidth: 3 },
    { value: "Áreas con cuencas menores a 10 km²", label: "Drenaje costero menor (< 10 km²)", color: "#969696", fillOpacity: 0.18, strokeColor: null },
  ],
  labels: true, labelField: "nombre",
  labelStyle: { color: "#4a1170", haloColor: "#ffffff", haloWidth: 4, size: 11, bold: true },
};
const SZ_STYLES = {
  Cuencas_hidrograficas: cuencaSz,
  Cuenca_04_44_8_km2: cuencaSz,
  Microcuencas: { ...scStyles.microcuencas, labelStyle: { ...scStyles.microcuencas.labelStyle, size: 8 } },
  Predios_rurales_criticos_Santa_Cruz: scStyles.predios_rurales_criticos,
  Curvas_de_nivel_10_m: { ...scStyles.curvas_nivel_10m, opacity: 0.2 },
  Rios_orden_de_Strahler_1_2_3: scStyles.rios_orden_strahler,
  Vias_criticas_Santa_Cruz: {
    ...scStyles.vias_criticas,
    categories: [
      ...scStyles.vias_criticas.categories,
      { value: "Río de tercer orden", label: "Cruce con río de 3.er orden", color: "#7a0c1c", fillOpacity: 1, marker: "triangle", size: 19, strokeColor: "#ffffff", strokeWidth: 2, haloColor: "#ffffff", haloOpacity: 0.67, haloSize: 27 },
    ],
  },
};
const visibleSz = { Microcuencas: false, Curvas_de_nivel_10_m: false };

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

function prepareSz(file, allowNullGeometry = 0) {
  const fc = JSON.parse(fs.readFileSync(path.join(work, "geojson", `${file}.geojson`), "utf8"));
  const ogrinfo = fs.readFileSync(path.join(work, "logs", `${file}.ogrinfo`), "utf8");
  const expected = Number(/Feature Count: (\d+)/.exec(ogrinfo)?.[1]);
  const epsg = /ID\["EPSG",(\d+)\]\]\s*$/m.exec(ogrinfo)?.[1];
  const style = merge(DEFAULT, SZ_STYLES[file]);
  const errors = [];
  const info = inspect(fc, SANTA_CRUZ);
  if (fc.features.length !== expected) errors.push(`registros: GDAL ${expected}, convertidos ${fc.features.length}`);
  if (info.nulls !== allowNullGeometry) errors.push(`${info.nulls} registro(s) sin geometría`);
  if (info.outside) errors.push(`${info.outside} vértice(s) fuera de Santa Cruz`);
  if (info.types.length !== 1) errors.push(`geometrías mezcladas: ${info.types.join(", ")}`);
  const text = JSON.stringify(fc);
  if (Buffer.byteLength(text) > VECTOR_MAX_FILE_BYTES) errors.push("el GeoJSON supera 75 MB");
  const fields = Object.keys(fc.features[0]?.properties ?? {});
  for (const f of [style.colorBy, style.labelField]) if (f && !fields.includes(f)) errors.push(`no existe el campo ${f}`);
  const present = new Set(fc.features.map((f) => String(f.properties[style.colorBy])));
  if (style.categories && !style.categories.some((c) => present.has(String(c.value)))) errors.push("ninguna categoría coincide con los datos");
  const name = `${SZ} · ${file}`;
  const dataRel = `data/sz_${file}.geojson`, sourceRel = `source/sz_${file}.zip`;
  fs.writeFileSync(path.join(staging, dataRel), text);
  fs.copyFileSync(path.join(work, "source", `${file}.zip`), path.join(staging, sourceRel));
  return {
    role: "thematic", name, geometry: info.types[0], featureCount: fc.features.length, indexCount: expected,
    sourceCrs: epsg ? `EPSG:${epsg}` : null, bbox: info.bbox, nullGeometries: info.nulls,
    dataRel, sourceRel, sizeBytes: Buffer.byteLength(text), style, visible: visibleSz[file] ?? true,
    ok: errors.length === 0, errors,
  };
}

const find = (list, n) => list.find((b) => b.name === n) || (() => { throw new Error(`capa ${n} no encontrada`); })();
const copySc = (n, visible, label = `${SC} · ${n}`) => {
  const l = find(sanCristobal, n);
  return { role: "copy", name: label, baseMapId: l.baseMapId, baseLayerId: l.baseLayerId, geometry: l.geometry,
    featureCount: l.featureCount, bbox: l.bbox, style: merge(l.style, scStyles[n]), visible, ok: true, errors: [] };
};
const baseL = (n) => ({ role: "base", scale: "1:50.000", ...find(base, n), visible: true, ok: true, errors: [] });

fs.mkdirSync(path.join(staging, "data"), { recursive: true });
fs.mkdirSync(path.join(staging, "source"), { recursive: true });

// Bottom to top: base sea and islands, polygons, lines, points, base labels.
const ordered = [
  baseL("rejilla_ocea_arch_50m_utm15s_wgs84"),
  baseL("islas_arch_50m_utm15_wgs84"),
  copySc("cuencas_hidrograficas", true),
  prepareSz("Cuencas_hidrograficas"),
  prepareSz("Cuenca_04_44_8_km2"),
  copySc("microcuencas", false),
  prepareSz("Microcuencas"),
  copySc("predios_rurales_criticos", true),
  prepareSz("Predios_rurales_criticos_Santa_Cruz"),
  copySc("curvas_nivel_10m", false),
  prepareSz("Curvas_de_nivel_10_m"),
  copySc("rios_orden_strahler", true),
  prepareSz("Rios_orden_de_Strahler_1_2_3", 1),
  copySc("vias", true, "Vías (San Cristóbal, Santa Cruz e Isabela)"),
  copySc("vias_criticas", true),
  prepareSz("Vias_criticas_Santa_Cruz"),
  baseL("toponimia_arch_50m_utm15s_wgs84"),
  baseL("Centros_poblados_100m_utm15s_wgs84"),
].map((l, zIndex) => ({ ...l, zIndex }));

const DESCRIPTION = [
  "Rutas y predios rurales críticos ante el evento El Niño (ENOS) 2026 en San Cristóbal y Santa Cruz, por su relación con la red de drenaje.",
  "Predios rurales críticos (111 en San Cristóbal, 217 en Santa Cruz): atraviesan un cauce; LONG_RIO_M es el largo de río dentro del predio. Color por «RECLASS».",
  "Vías críticas (49 en San Cristóbal, 127 en Santa Cruz): cruces de la red vial con ríos, por orden del río (RIO_CLASE).",
  "Hidrología de cada isla: cuencas, microcuencas (ocultas), ríos por orden de Strahler y curvas de nivel cada 10 m (ocultas). En Santa Cruz, además, la cuenca 04 (44,8 km²).",
  "Red vial de OpenStreetMap al 31-oct-2026 de San Cristóbal, Santa Cruz e Isabela (una sola capa: viene igual en las dos entregas).",
  "Cada capa guarda como fuente el shapefile original con sus estilos. Capas base 1:50.000 de la BDG Galápagos.",
].join(" ");

const map = { title: TITLE, tags: [TAG, "Galápagos", "Predios rurales"], layers: ordered, rasters: [], description: DESCRIPTION };
fs.writeFileSync(path.join(staging, "plan.json"), JSON.stringify({ tag: TAG, maps: [map] }, null, 1));
for (const l of ordered) console.log(`${l.ok ? "OK " : "ERR"} ${l.zIndex} ${l.role} ${l.name}: ${l.featureCount} ${l.geometry}${l.visible ? "" : " (oculta)"}${l.errors.length ? " — " + l.errors.join("; ") : ""}`);
