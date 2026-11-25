// Adds the Isabela_shapefiles.zip delivery (2026-11-24) to "Rutas y Predios
// Criticos Enos 2026 Galapagos". The delivery has no .sld/.qml, so each Isabela
// layer takes the style its Santa Cruz counterpart has now in the map, plus a
// 4th-order class for rivers and critical crossings (Isabela reaches order 4).
// Isabela "Vias" is the same OSM shapefile of the three islands already in the
// map (only the .dbf header date differs), so it is not loaded again.
// Every Isabela layer goes right above its Santa Cruz counterpart; existing
// layers keep visibility and style and are only renumbered. Existing layers are
// written with baseLayerId = themselves so verify.mjs checks them unchanged.
//   node isabela_plan.cjs <work dir> <current_layers.json> <staging dir> <map id>
const fs = require("fs");
const path = require("path");

const [work, layersJson, staging, mapId] = process.argv.slice(2);
const VECTOR_MAX_FILE_BYTES = 75 * 1024 * 1024;
const ISABELA = [-91.70, -1.10, -90.70, 0.25];
const TAG = "ENOS 2026";
const TITLE = "Rutas y Predios Criticos Enos 2026 Galapagos";
const IS = "Isabela";
const current = JSON.parse(fs.readFileSync(layersJson, "utf8"));
const byName = new Map(current.map((l) => [l.name, l]));
const sz = (n) => {
  const l = byName.get(`Santa Cruz · ${n}`);
  if (!l) throw new Error(`no está la capa Santa Cruz · ${n}`);
  return l;
};

const withCategory = (style, extra) => ({ ...style, categories: [...style.categories, extra] });
const rios = sz("Rios_orden_de_Strahler_1_2_3");
const cruces = sz("Vias_criticas_Santa_Cruz");
const FROM = {
  Cuencas_hidrograficas: sz("Cuencas_hidrograficas"),
  Microcuencas: sz("Microcuencas"),
  Predios_rurales_criticos_Isabela: sz("Predios_rurales_criticos_Santa_Cruz"),
  Curvas_de_nivel_10_m: sz("Curvas_de_nivel_10_m"),
  Rios_orden_de_Strahler_1_a_5: {
    ...rios,
    style: withCategory(rios.style, { value: "4", label: "Río de cuarto orden", color: "#008cd2", strokeWidth: 4 }),
  },
  Vias_criticas_Isabela: {
    ...cruces,
    style: withCategory(cruces.style, {
      value: "Río de cuarto orden", label: "Cruce con río de 4.º orden", color: "#4a0610", fillOpacity: 1,
      marker: "triangle", size: 22, strokeColor: "#ffffff", strokeWidth: 2, haloColor: "#ffffff", haloOpacity: 0.67, haloSize: 30,
    }),
  },
};

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

function prepare(file) {
  const fc = JSON.parse(fs.readFileSync(path.join(work, "geojson", `${file}.geojson`), "utf8"));
  const ogrinfo = fs.readFileSync(path.join(work, "logs", `${file}.ogrinfo`), "utf8");
  const expected = Number(/Feature Count: (\d+)/.exec(ogrinfo)?.[1]);
  const epsg = /ID\["EPSG",(\d+)\]\]\s*$/m.exec(ogrinfo)?.[1];
  const from = FROM[file];
  const style = from.style;
  const errors = [];
  const info = inspect(fc, ISABELA);
  if (fc.features.length !== expected) errors.push(`registros: GDAL ${expected}, convertidos ${fc.features.length}`);
  if (info.nulls) errors.push(`${info.nulls} registro(s) sin geometría`);
  if (info.outside) errors.push(`${info.outside} vértice(s) fuera de Isabela`);
  if (info.types.length !== 1) errors.push(`geometrías mezcladas: ${info.types.join(", ")}`);
  const text = JSON.stringify(fc);
  if (Buffer.byteLength(text) > VECTOR_MAX_FILE_BYTES) errors.push("el GeoJSON supera 75 MB");
  const fields = Object.keys(fc.features[0]?.properties ?? {});
  for (const f of [style.colorBy, style.labelField]) if (f && !fields.includes(f)) errors.push(`no existe el campo ${f}`);
  if (style.categories) {
    const known = new Set(style.categories.map((c) => String(c.value)));
    const missing = [...new Set(fc.features.map((f) => String(f.properties[style.colorBy])))].filter((v) => !known.has(v));
    if (missing.length) errors.push(`valores sin categoría: ${missing.join(", ")}`);
  }
  const dataRel = `data/is_${file}.geojson`, sourceRel = `source/is_${file}.zip`;
  fs.writeFileSync(path.join(staging, dataRel), text);
  fs.copyFileSync(path.join(work, "source", `${file}.zip`), path.join(staging, sourceRel));
  return {
    role: "thematic", name: `${IS} · ${file}`, geometry: info.types[0], featureCount: fc.features.length, indexCount: expected,
    sourceCrs: epsg ? `EPSG:${epsg}` : null, bbox: info.bbox, nullGeometries: info.nulls,
    dataRel, sourceRel, sizeBytes: Buffer.byteLength(text), style, visible: from.visible,
    ok: errors.length === 0, errors,
  };
}

const existing = (name) => {
  const l = byName.get(name);
  if (!l) throw new Error(`no está la capa ${name}`);
  return { role: "exists", name, baseMapId: mapId, baseLayerId: l.id, featureCount: l.featureCount, visible: l.visible, ok: true, errors: [] };
};

fs.mkdirSync(path.join(staging, "data"), { recursive: true });
fs.mkdirSync(path.join(staging, "source"), { recursive: true });

const AFTER = {
  "Santa Cruz · Cuenca_04_44_8_km2": "Cuencas_hidrograficas",
  "Santa Cruz · Microcuencas": "Microcuencas",
  "Santa Cruz · Predios_rurales_criticos_Santa_Cruz": "Predios_rurales_criticos_Isabela",
  "Santa Cruz · Curvas_de_nivel_10_m": "Curvas_de_nivel_10_m",
  "Santa Cruz · Rios_orden_de_Strahler_1_2_3": "Rios_orden_de_Strahler_1_a_5",
  "Santa Cruz · Vias_criticas_Santa_Cruz": "Vias_criticas_Isabela",
};
const ordered = [];
for (const l of [...current].sort((a, b) => a.zIndex - b.zIndex)) {
  ordered.push(existing(l.name));
  if (AFTER[l.name]) ordered.push(prepare(AFTER[l.name]));
}
if (ordered.filter((l) => l.role === "thematic").length !== Object.keys(FROM).length) throw new Error("faltan capas de Isabela en el orden");
ordered.forEach((l, zIndex) => { l.zIndex = zIndex; });

const DESCRIPTION = [
  "Rutas y predios rurales críticos ante el evento El Niño (ENOS) 2026 en San Cristóbal, Santa Cruz e Isabela, por su relación con la red de drenaje.",
  "Predios rurales críticos (111 en San Cristóbal, 217 en Santa Cruz, 81 en Isabela): atraviesan un cauce; LONG_RIO_M es el largo de río dentro del predio. Color por «RECLASS».",
  "Vías críticas (49 en San Cristóbal, 127 en Santa Cruz, 52 en Isabela): cruces de la red vial con ríos, por orden del río (RIO_CLASE).",
  "Hidrología de cada isla: cuencas, microcuencas (ocultas), ríos por orden de Strahler (hasta el 4.º orden en Isabela) y curvas de nivel cada 10 m. En Santa Cruz, además, la cuenca 04 (44,8 km²).",
  "Red vial de OpenStreetMap al 31-oct-2026 de San Cristóbal, Santa Cruz e Isabela (una sola capa: viene igual en las tres entregas).",
  "Cada capa guarda como fuente el shapefile original (con sus estilos .sld/.qml en San Cristóbal y Santa Cruz; la entrega de Isabela no los trae y usa los de Santa Cruz). Capas base 1:50.000 de la BDG Galápagos.",
].join(" ");

const map = { title: TITLE, tags: [TAG, "Galápagos", "Predios rurales"], layers: ordered, rasters: [], description: DESCRIPTION };
fs.writeFileSync(path.join(staging, "plan.json"), JSON.stringify({ tag: TAG, maps: [map] }, null, 1));
for (const l of ordered) console.log(`${l.ok ? "OK " : "ERR"} ${l.zIndex} ${l.role} ${l.name}: ${l.featureCount}${l.geometry ? " " + l.geometry : ""}${l.visible ? "" : " (oculta)"}${l.sourceCrs ? " " + l.sourceCrs : ""}${l.errors.length ? " — " + l.errors.join("; ") : ""}`);
