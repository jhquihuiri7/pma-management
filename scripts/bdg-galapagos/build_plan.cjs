// Builds the Geoportal import plan from the index + validated GDAL output.
// Usage: node build_plan.cjs <analysis.json> <out dir> <originals dir> <staging dir>
// Writes <staging>/plan.json, <staging>/data/** (sanitized GeoJSON) and
// <staging>/source/** (byte copies of the original zips; originals untouched).
const fs = require("fs");
const path = require("path");

const [analysisPath, outDir, originalsDir, stagingDir] = process.argv.slice(2);
const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));

const BASE_FOLDER = "00_Capas_base";
const SEA = "rejilla_ocea_arch_50m_utm15s_wgs84";
const ISLANDS = "islas_arch_50m_utm15_wgs84";
const TOPONYMS = "toponimia_arch_50m_utm15s_wgs84";
const SETTLEMENTS = "Centros_poblados_100m_utm15s_wgs84";
const VECTOR_MAX_FILE_BYTES = 75 * 1024 * 1024;

// Geoportal category + thematic for each folder (taxonomy in apps/web/lib/geo-mock-data.ts).
const CATEGORY = {
  "00_Capas_base": ["informacion-base", "Cartografía base"],
  "01_Ubicacion_y_division_politico_administrativa": ["informacion-base", "Límites administrativos"],
  "02_Areas_protegidas_y_gestion_del_territorio": ["fisico-ambiental", "Zonas de protección, regeneración y recuperación ambiental"],
  "03_Relieve_terrestre_y_submarino": ["informacion-base", "Modelo digital de elevación"],
  "04_Pendientes": ["informacion-base", "Modelo digital de elevación"],
  "05_Geologia_y_geomorfologia": ["fisico-ambiental", "Recursos naturales no renovables"],
  "06_Suelos_morfopedologia": ["fisico-ambiental", "Recursos naturales renovables"],
  "07_Clima_y_zonas_de_vida": ["fisico-ambiental", "Clima"],
  "08_Hidrografia_cuencas_drenaje_y_cuerpos_de_agua": ["informacion-base", "Red hídrica"],
  "09_Hidrogeologia_Santa_Cruz_y_San_Cristobal": ["fisico-ambiental", "Recursos naturales renovables"],
  "10_Ecosistemas_terrestres": ["fisico-ambiental", "Ecosistemas"],
  "11_Ecosistemas_marino_costeros": ["fisico-ambiental", "Ecosistemas"],
  "12_Vegetacion_y_cobertura": ["fisico-ambiental", "Ecosistemas"],
  "13_Fauna": ["fisico-ambiental", "Ecosistemas"],
  "14_Poblacion_y_asentamientos": ["asentamientos-humanos", "Distribución demográfica"],
  "15_Cambio_de_uso_del_suelo_1987_2006": ["asentamientos-humanos", "Uso y ocupación del suelo"],
  "16_Equipamientos_y_actividades_productivas": ["economico-productivo", "Infraestructura productiva"],
  "17_Agua_potable_saneamiento_y_residuos": ["asentamientos-humanos", "Movilidad, conectividad e infraestructura"],
  "18_Energia_y_telecomunicaciones": ["asentamientos-humanos", "Movilidad, conectividad e infraestructura"],
  "19_Transporte_terrestre_aereo_y_maritimo": ["asentamientos-humanos", "Movilidad, conectividad e infraestructura"],
  "20_Turismo_y_uso_publico": ["economico-productivo", "Actividades económicas y productivas"],
  "21_Amenazas_y_areas_sensibles": ["fisico-ambiental", "Amenazas naturales"],
  "22_Riesgo_por_combustibles_y_sustancias_peligrosas": ["fisico-ambiental", "Contaminación"],
  "23_Respuesta_a_emergencias": ["politico-institucional", "Gobernanza del riesgo"],
  "24_Problematica_ambiental": ["fisico-ambiental", "Conflictos ambientales"],
  "S1_Uso_del_suelo_por_isla": ["asentamientos-humanos", "Uso y ocupación del suelo"],
  "S2_Pendientes_por_isla": ["informacion-base", "Modelo digital de elevación"],
  "S3_Amenazas_por_isla": ["fisico-ambiental", "Amenazas naturales"],
  "S4_Vias_e_infraestructura_por_isla": ["asentamientos-humanos", "Movilidad, conectividad e infraestructura"],
};

// Layers that start hidden (reference layers / alternative versions of a theme).
const HIDDEN = {
  "01_Ubicacion_y_division_politico_administrativa": [
    "islas_arch_100m_utm15s_wgs84", "cartas_igm1_arch_100m_utm15s_wgs84",
    "cartas_igm2_arch_100m_utm15s_wgs84", "cartas_igm3_arch_100m_utm15s_wgs84",
  ],
  "03_Relieve_terrestre_y_submarino": [
    "altimetria_arch_20m_utm15s_wgs84", "altimetria_arch_100m_utm15s_wgs84",
    "alt_bat_arch_utm15s_wgs84", "alt_bat_arch_100m_utm15s_wgs84",
    "alt_bat_ioa_arch_100m_utm15s_wgs84", "alt_bat_mod_arch_100m_utm15s_wgs84",
  ],
  "08_Hidrografia_cuencas_drenaje_y_cuerpos_de_agua": ["hidrografia_arch_50m_utm15s_wgs84", "mhid_arch_utm15s_wgs84"],
  "12_Vegetacion_y_cobertura": ["form_veg_arch_100m_utm15s_wgs84"],
  "19_Transporte_terrestre_aereo_y_maritimo": ["vias_arch_50m_utm15s_wgs84"],
};

function islandOf(name) {
  const n = name.toLowerCase();
  if (n.includes("btra")) return "Baltra (Santa Cruz)";
  if (n.includes("santacruz") || n.includes("sta_cruz")) return "Santa Cruz";
  if (n.includes("san_cristobal") || n.includes("sancristobal")) return "San Cristóbal";
  if (n.includes("isabela")) return "Isabela";
  if (n.includes("floreana")) return "Floreana";
  return null;
}

// Same palette and shape as defaultStyleFor() in GisEditor.tsx.
const PALETTE = ["#3f7c5f", "#c46d27", "#2c5481", "#9d4636", "#6e5a2c", "#4a4458"];
function style(geometry, color, overrides = {}) {
  return {
    mode: "single", color, palette: "categorical",
    ramp: geometry === "Point" ? "blues" : "earth",
    classification: "quantile", classes: 5, colorBy: null,
    opacity: geometry === "LineString" ? 1 : 0.78,
    strokeWidth: geometry === "Point" ? 0 : 1,
    size: 6, labels: false, labelField: null,
    ...overrides,
  };
}
const BASE_STYLE = {
  [SEA]: style("Polygon", "#8fbcd4", { opacity: 0.7, strokeWidth: 0 }),
  [ISLANDS]: style("Polygon", "#e6dcc3", { opacity: 0.85, strokeWidth: 1 }),
  [TOPONYMS]: style("Point", "#3a3a3a", { size: 4 }),
  [SETTLEMENTS]: style("Point", "#b3261e", { size: 8, opacity: 0.9 }),
};

const GEOMETRY = { "Polígono": "Polygon", "Línea": "LineString", "Punto": "Point", "Point Z": "Point" };

/** Mirrors parseFeatureCollection() in apps/api/src/routes/geo/index.ts. */
function sanitize(r) {
  const fc = JSON.parse(fs.readFileSync(path.join(outDir, "geojson", r.folder, `${r.base}.geojson`), "utf8"));
  const geometry = GEOMETRY[r.indexGeometry];
  const allowed = new Set([geometry, `Multi${geometry}`]);
  const dropped = [];
  const features = [];
  fc.features.forEach((f, fid) => {
    if (!f.geometry) { dropped.push({ fid, properties: f.properties }); return; }
    if (!allowed.has(f.geometry.type)) throw new Error(`fid ${fid}: ${f.geometry.type} no coincide con ${geometry}`);
    features.push({ type: "Feature", properties: f.properties, geometry: f.geometry });
  });
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let coords = 0;
  const visit = (v, depth) => {
    if (depth > 16 || !Array.isArray(v)) throw new Error("Coordenadas GeoJSON inválidas");
    if (v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new Error("Coordenadas no finitas");
      bbox[0] = Math.min(bbox[0], v[0]); bbox[1] = Math.min(bbox[1], v[1]);
      bbox[2] = Math.max(bbox[2], v[0]); bbox[3] = Math.max(bbox[3], v[1]);
      coords++;
      return;
    }
    if (v.length === 0) throw new Error("Coordenadas vacías");
    v.forEach((c) => visit(c, depth + 1));
  };
  features.forEach((f) => visit(f.geometry.coordinates, 0));
  if (!features.length || !coords) throw new Error("El GeoJSON no contiene geometrías");
  const text = JSON.stringify({ type: "FeatureCollection", features });
  if (Buffer.byteLength(text) > VECTOR_MAX_FILE_BYTES) throw new Error("El GeoJSON normalizado supera 75 MB");
  // Coverage used to stack polygons: largest at the bottom.
  const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
  return { text, geometry, featureCount: features.length, bbox, dropped, area };
}

const rows = new Map(analysis.map((r) => [`${r.folder}/${r.base}`, r]));
const staged = new Map();
function stage(r) {
  const key = `${r.folder}/${r.base}`;
  if (staged.has(key)) return staged.get(key);
  let entry;
  if (r.errors.length) {
    entry = { ok: false, error: r.errors.join(" ; ") };
  } else {
    try {
      const s = sanitize(r);
      const dataRel = `data/${r.folder}/${r.base}.geojson`;
      const sourceRel = `source/${r.folder}/${r.base}.zip`;
      fs.mkdirSync(path.join(stagingDir, "data", r.folder), { recursive: true });
      fs.mkdirSync(path.join(stagingDir, "source", r.folder), { recursive: true });
      fs.writeFileSync(path.join(stagingDir, dataRel), s.text);
      fs.copyFileSync(path.join(originalsDir, r.folder, r.zip), path.join(stagingDir, sourceRel));
      entry = {
        ok: true, dataRel, sourceRel, geometry: s.geometry, featureCount: s.featureCount,
        bbox: s.bbox, area: s.area, dropped: s.dropped, sizeBytes: Buffer.byteLength(s.text),
      };
    } catch (err) {
      entry = { ok: false, error: err.message };
    }
  }
  staged.set(key, entry);
  return entry;
}

const baseRows = [SEA, ISLANDS, TOPONYMS, SETTLEMENTS].map((b) => rows.get(`${BASE_FOLDER}/${b}`));
const folders = [...new Set(analysis.map((r) => r.folder))];
const maps = folders.map((folder) => {
  const folderRows = analysis.filter((r) => r.folder === folder);
  const thematic = folder === BASE_FOLDER ? [] : folderRows;
  const layers = [];
  const push = (r, role, extra) => {
    const s = stage(r);
    layers.push({
      name: r.base, folder: r.folder, role, island: folder.startsWith("S") ? islandOf(r.base) : null,
      indexCount: r.indexCount, indexGeometry: r.indexGeometry, prjEpsg: r.prjEpsg, ...s, ...extra,
    });
  };

  // Thematic stacking: polygons (largest coverage lowest), then lines, then points.
  const rank = { Polygon: 0, LineString: 1, Point: 2 };
  const ordered = thematic
    .map((r, i) => ({ r, i, s: stage(r) }))
    .sort((a, b) => {
      const ga = rank[GEOMETRY[a.r.indexGeometry]], gb = rank[GEOMETRY[b.r.indexGeometry]];
      if (ga !== gb) return ga - gb;
      // Unavailable layers have no extent; keep the comparator consistent.
      if (a.s.ok !== b.s.ok) return a.s.ok ? -1 : 1;
      if (ga === 0 && a.s.ok) {
        // Same coverage within ~10 %: the more detailed layer (more features) goes on top.
        const la = Math.round(Math.log10(a.s.area) * 25), lb = Math.round(Math.log10(b.s.area) * 25);
        if (la !== lb) return lb - la;
        if (a.s.featureCount !== b.s.featureCount) return a.s.featureCount - b.s.featureCount;
      }
      return a.i - b.i;
    });

  push(baseRows[0], "base", { style: BASE_STYLE[SEA], visible: true });
  push(baseRows[1], "base", { style: BASE_STYLE[ISLANDS], visible: true });
  ordered.forEach(({ r }, i) => {
    const geometry = GEOMETRY[r.indexGeometry];
    push(r, "thematic", {
      style: style(geometry, PALETTE[i % PALETTE.length]),
      visible: !(HIDDEN[folder] || []).includes(r.base),
    });
  });
  push(baseRows[2], "base", { style: BASE_STYLE[TOPONYMS], visible: true });
  push(baseRows[3], "base", { style: BASE_STYLE[SETTLEMENTS], visible: true });
  layers.forEach((l, z) => { l.zIndex = z; });

  const [categoryId, thematicName] = CATEGORY[folder];
  const islands = folder.startsWith("S") ? ["Santa Cruz", "San Cristóbal", "Isabela", "Floreana"] : [];
  const nThematic = thematic.length;
  const description = folder === BASE_FOLDER
    ? "Base de datos geográfica de Galápagos (BDG). Capas base que acompañan a todos los mapas de la BDG: polígono del mar, islas, toponimia y centros poblados."
    : `Base de datos geográfica de Galápagos (BDG), carpeta ${folder}: ${nThematic} capa${nThematic === 1 ? "" : "s"} temática${nThematic === 1 ? "" : "s"} más las 4 capas base (mar, islas, toponimia y centros poblados).`
      + (islands.length ? " Capas por isla habitada: Santa Cruz (con Baltra), San Cristóbal, Isabela y Floreana." : "");
  // A thematic map whose own layers are all unavailable would publish as an
  // empty map; it is created on a later run once its files arrive.
  const deferred = folder !== BASE_FOLDER && !layers.some((l) => l.role === "thematic" && l.ok);
  return {
    folder, title: folderRows[0].mapa, categoryId, thematic: thematicName, description, deferred,
    tags: ["BDG Galápagos", ...islands],
    center: [-0.65, -90.55], zoom: 8,
    layers,
  };
});

fs.writeFileSync(path.join(stagingDir, "plan.json"), JSON.stringify({ maps }, null, 1));
const all = maps.flatMap((m) => m.layers);
console.log(`mapas: ${maps.length}, capas a crear: ${all.length}, listas: ${all.filter((l) => l.ok).length}, con error: ${all.filter((l) => !l.ok).length}`);
for (const m of maps) {
  console.log(`\n${m.folder} → "${m.title}" [${m.categoryId} / ${m.thematic}]${m.deferred ? " — POSPUESTO: ninguna capa temática disponible" : ""}`);
  for (const l of [...m.layers].reverse()) {
    console.log(`  z${String(l.zIndex).padStart(2)} ${l.visible ? "👁" : "  "} ${l.ok ? "  " : "✗ "}${l.name} (${l.geometry || l.indexGeometry}${l.island ? `, ${l.island}` : ""})${l.ok ? "" : ` — ${l.error.slice(0, 80)}`}`);
  }
}
