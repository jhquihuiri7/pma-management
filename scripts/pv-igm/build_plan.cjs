// Builds the load plan for the IGM 2025 Puerto Villamil set (copy of scripts/pa-igm/build_plan.cjs).
//   node build_plan.cjs <work dir> <base.json> <staging dir>
// - adds "<campo>_texto" (domain text) right after every coded field, keeping the code;
// - checks every layer against GDAL's own feature count, the study-area extent and the size limit;
// - writes staging/plan.json plus the enriched GeoJSON and source .zip per layer.
const fs = require("fs");
const path = require("path");

const [work, baseJson, staging] = process.argv.slice(2);
const VECTOR_MAX_FILE_BYTES = 75 * 1024 * 1024;
// Puerto Villamil and the upper part (Santo Tomás), with margin (degrees).
const AREA = [-91.10, -1.00, -90.90, -0.78];
const TAG = "Puerto Villamil";

const SOURCE =
  "Instituto Geográfico Militar (IGM), 2025. Proyecto «Determinación de la capacidad de acogida del territorio " +
  "con fines de desarrollo urbano mediante la generación de geoinformación temática a escala 1:5.000». " +
  "Escala de trabajo 1:5.000; área de estudio 2.023,13 ha en dos sectores (isla Isabela): la parte alta, en torno a " +
  "Santo Tomás (1.883,67 ha), y la ciudad de Puerto Villamil (139,46 ha).";
const CODES = "Los campos codificados conservan su código y llevan el texto del dominio en «<campo>_texto».";
const BASES =
  "Capas base: 1:50.000 (BDG Galápagos: mar, islas, toponimia y centros poblados) y 1:5.000 (límite del área de estudio).";

const PALETTE0 = "#3f7c5f";
const thematic = (colorBy, opacity = 0.78) => ({
  mode: "category", color: PALETTE0, palette: "categorical", ramp: "earth", classification: "quantile",
  classes: 5, colorBy, opacity, strokeWidth: 1, size: 6, labels: false, labelField: null,
});
const single = (color, geometry, extra = {}) => ({
  mode: "single", color, palette: "categorical", ramp: geometry === "Point" ? "blues" : "earth",
  classification: "quantile", classes: 5, colorBy: null, opacity: geometry === "Polygon" ? 0.78 : 1,
  strokeWidth: geometry === "Point" ? 0 : 1, size: 6, labels: false, labelField: null, ...extra,
});

const LIMIT = "limite_area_estudio_pto_villamil";
const MAPS = [
  { title: "Cobertura y uso de la tierra", cat: ["asentamientos-humanos", "Uso y ocupación del suelo"], date: "junio 2025",
    layers: [["COB_USO_PTO_VILLAMIL_A", "uso_texto"]] },
  { title: "Geomorfología", cat: ["fisico-ambiental", "Recursos naturales no renovables"], date: "julio 2025",
    hideBasePolygons: true,
    layers: [["U_GEOM_PTO_VILLAMIL_A", "geof_texto", { opacity: 0.6 }], ["GEOF_L", null]],
    rasters: [{ file: "hill_pto_villamil_ly.tif", visible: true, opacity: 1 }],
    note: "Debajo, el relieve sombreado del IGM recortado al área de estudio (10 m). " +
      "La capa de puntos GEOF_P viene vacía (0 registros) en la entrega del IGM y no se cargó." },
  { title: "Suelos", cat: ["fisico-ambiental", "Recursos naturales renovables"], date: "julio 2025",
    layers: [["SUELO_PTO_VILLAMIL_A", "txs_texto"]] },
  { title: "Capacidad de uso de las tierras", cat: ["fisico-ambiental", "Recursos naturales renovables"], date: "julio 2025",
    layers: [["U_CUT_PTO_VILLAMIL_A", "cag_texto"]] },
  { title: "Aptitud física constructiva", cat: ["asentamientos-humanos", "Uso y ocupación del suelo"], date: "julio 2025",
    layers: [["APFC_PTO_VILLAMIL_A", "apfc_texto"]] },
  { title: "Capacidad de acogida", cat: ["asentamientos-humanos", "Uso y ocupación del suelo"], date: "julio 2025",
    layers: [["CA_PTO_VILLAMIL_A", "ca_texto"]] },
  { title: "Conflictos de uso", cat: ["asentamientos-humanos", "Uso y ocupación del suelo"], date: "julio 2025",
    // Same 50 polygons: zones in expansion (CUEX) start hidden under the consolidated ones (CUC).
    layers: [["CUEX_PTO_VILLAMIL_A", "cuex_texto", { visible: false }], ["CUC_PTO_VILLAMIL_A", "cuc_texto"]],
    note: "CUC: zonas consolidadas (visible). CUEX: zonas en expansión (oculta; mismos polígonos)." },
  { title: "Densidad poblacional", cat: ["sociocultural", "Demografía y población"], date: "noviembre 2025",
    layers: [["DENSIDAD_POB_PTO_VILLAMIL_A", "depo_desc"]] },
  { title: "Nivel de instrucción", cat: ["sociocultural", "Demografía y población"], date: "noviembre 2025",
    layers: [["N_INSTRUCCION_PTO_VILLAMIL_A", "nis_clas_texto"]] },
  { title: "Nivel socioeconómico", cat: ["sociocultural", "Pobreza y desigualdad"], date: "noviembre 2025",
    layers: [["NIV_SOCIOEC_PTO_VILLAMIL_A", "nse_texto"]] },
  { title: "Servicios básicos", cat: ["sociocultural", "Servicios públicos y sociales"], date: "noviembre 2025",
    layers: [["SERV_BASICOS_PTO_VILLAMIL_A", "dis_texto"]] },
  { title: "Ortofoto 2022 y elevación", cat: ["informacion-base", "Cartografía base"], date: "2022 (ortofoto) y 2025",
    hideBasePolygons: true, layers: [],
    rasters: [
      { file: "ort_pto_villamil_30cm_2022_02.tif", visible: true, opacity: 1, compressedCopy: true },
      { file: "hill_pto_villamil.tif", visible: false, opacity: 1 },
      { file: "dtm_pto_villamil_elevacion_gris.tif", visible: false, opacity: 1, derived: true },
      { file: "dtm_pto_villamil_elevacion_color.tif", visible: false, opacity: 0.85, derived: true },
    ],
    note:
      "Ortofoto IGM 2022 a 30 cm (sur de la isla Isabela, de la parte alta de Sierra Negra a Puerto Villamil; visible). " +
      "Se cargó una copia comprimida (WEBP, calidad 90) porque el original del IGM, sin compresión, pesa 27,4 GB y supera " +
      "el límite de 5,5 GB del Geoportal; conserva la resolución, la extensión y la transparencia del original. La entrega " +
      "trae también la misma ortofoto reproyectada a UTM 15S (ort_15s.tif), que no se cargó por ser la misma imagen. " +
      "Relieve sombreado del IGM (10 m). Dos vistas derivadas del modelo digital del terreno dtm_pto_villamil " +
      "(10 m, de −0,9 a 1.084,4 m): elevación en gris (más claro = más alto) y elevación coloreada (azul = nivel del mar " +
      "o menos; verdes = 0–200 m; amarillo = 200–300 m; ocres = 300–500 m; marrones = 500–1.085 m)." },
];

// ── domains ───────────────────────────────────────────────────────────────
function readDomains() {
  const fieldsByLayer = {}, gdbOfLayer = {}, domains = {};
  const dir = path.join(work, "domains");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".fields"))) {
    const gdb = f.replace(".fields", "");
    let layer = null;
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      const m = /^Layer name: (.+)$/.exec(line);
      if (m) { layer = m[1].trim(); fieldsByLayer[layer] = {}; gdbOfLayer[layer] = gdb; continue; }
      const d = /^([A-Za-z_0-9]+): [A-Za-z0-9]+ \([^)]*\).*domain name=([^ ,)]+)/.exec(line);
      if (d && layer) fieldsByLayer[layer][d[1]] = d[2];
    }
    const doms = (domains[gdb] = {});
    let cur = null;
    for (const line of fs.readFileSync(path.join(dir, gdb + ".domains"), "utf8").split("\n")) {
      const h = /^@@DOMAIN (.+)$/.exec(line);
      if (h) { cur = doms[h[1]] = { type: null, values: {} }; continue; }
      if (!cur) continue;
      let m;
      if ((m = /^\s*Type: (\S+)/.exec(line))) cur.type = m[1];
      else if (cur.type === "coded" && (m = /^\s{4}(\S(?:.*?\S)?): (.*)$/.exec(line))) cur.values[m[1]] = m[2].trim();
    }
  }
  return { fieldsByLayer, gdbOfLayer, domains };
}

function enrich(layer, fc, dom) {
  const coded = dom.fieldsByLayer[layer] || {};
  const added = [], skipped = [];
  const plan = [];
  for (const [field, name] of Object.entries(coded)) {
    const d = dom.domains[dom.gdbOfLayer[layer]][name];
    if (!d || d.type !== "coded") { skipped.push(`${field} (dominio ${d ? d.type : "sin definir"})`); continue; }
    const text = (v) => (v === null || v === undefined ? null : d.values[String(v)]);
    const missing = [...new Set(fc.features.map((f) => f.properties[field]).filter((v) => v != null && text(v) === undefined))];
    if (missing.length) throw new Error(`${layer}.${field}: códigos sin texto en el dominio ${name}: ${missing.join(", ")}`);
    if (fc.features.every((f) => f.properties[field] == null || text(f.properties[field]) === String(f.properties[field]))) {
      skipped.push(`${field} (texto = código)`); continue;
    }
    const desc = `${field}_desc`;
    if (!(desc in coded) && fc.features.every((f) => f.properties[field] == null || f.properties[desc] === text(f.properties[field]))) {
      skipped.push(`${field} (ya trae ${desc})`); continue;
    }
    plan.push([field, `${field}_texto`, text]);
  }
  for (const f of fc.features) {
    const next = {};
    for (const [k, v] of Object.entries(f.properties)) {
      next[k] = v;
      for (const [field, out, text] of plan) if (k === field) next[out] = text(v) ?? null;
    }
    f.properties = next;
  }
  added.push(...plan.map(([, out]) => out));
  return { added, skipped };
}

// ── checks ────────────────────────────────────────────────────────────────
function inspect(fc) {
  const types = new Set();
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let nulls = 0, outside = 0;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      bbox[0] = Math.min(bbox[0], c[0]); bbox[1] = Math.min(bbox[1], c[1]);
      bbox[2] = Math.max(bbox[2], c[0]); bbox[3] = Math.max(bbox[3], c[1]);
      if (c[0] < AREA[0] || c[0] > AREA[2] || c[1] < AREA[1] || c[1] > AREA[3]) outside++;
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

const dom = readDomains();
const base = JSON.parse(fs.readFileSync(baseJson, "utf8"));
const byName = (n) => base.find((b) => b.name === n) || (() => { throw new Error(`capa base ${n} no encontrada`); })();
fs.mkdirSync(path.join(staging, "data"), { recursive: true });
fs.mkdirSync(path.join(staging, "source"), { recursive: true });

const prepared = {};
function prepare(layer) {
  if (prepared[layer]) return prepared[layer];
  const fc = JSON.parse(fs.readFileSync(path.join(work, "geojson", `${layer}.geojson`), "utf8"));
  const ogrinfo = fs.readFileSync(path.join(work, "logs", `${layer}.ogrinfo`), "utf8");
  const expected = Number(/Feature Count: (\d+)/.exec(ogrinfo)?.[1]);
  const crs = /ID\["EPSG",(\d+)\]\]\s*$/m.exec(ogrinfo)?.[1] ?? /PROJCRS\["([^"]+)"/.exec(ogrinfo)?.[1];
  const errors = [];
  const { added, skipped } = layer === LIMIT ? { added: [], skipped: [] } : enrich(layer, fc, dom);
  const info = inspect(fc);
  if (fc.features.length !== expected) errors.push(`registros: GDAL ${expected}, convertidos ${fc.features.length}`);
  if (info.nulls) errors.push(`${info.nulls} registro(s) sin geometría`);
  if (info.outside) errors.push(`${info.outside} vértice(s) fuera de Puerto Villamil`);
  if (info.types.length !== 1) errors.push(`geometrías mezcladas: ${info.types.join(", ")}`);
  const text = JSON.stringify(fc);
  if (Buffer.byteLength(text) > VECTOR_MAX_FILE_BYTES) errors.push("el GeoJSON supera 75 MB");
  const dataRel = `data/${layer}.geojson`, sourceRel = `source/${layer}.zip`;
  fs.writeFileSync(path.join(staging, dataRel), text);
  fs.copyFileSync(path.join(work, "source", `${layer}.zip`), path.join(staging, sourceRel));
  return (prepared[layer] = {
    name: layer, geometry: info.types[0], featureCount: fc.features.length, indexCount: expected,
    sourceCrs: crs ? (/^\d+$/.test(crs) ? `EPSG:${crs}` : crs) : null, bbox: info.bbox,
    addedFields: added, skippedFields: skipped, dataRel, sourceRel, sizeBytes: Buffer.byteLength(text),
    fields: Object.keys(fc.features[0]?.properties ?? {}),
    ok: errors.length === 0, errors,
  });
}

const maps = MAPS.map((m) => {
  const layers = [];
  let z = 0;
  const hidePolys = Boolean(m.hideBasePolygons);
  for (const n of ["rejilla_ocea_arch_50m_utm15s_wgs84", "islas_arch_50m_utm15_wgs84"]) {
    const b = byName(n);
    layers.push({ role: "base", scale: "1:50.000", ...b, visible: !hidePolys, zIndex: z++ });
  }
  const themed = m.layers.map(([layer, colorBy, extra = {}]) => {
    const p = prepare(layer);
    if (colorBy && !p.fields.includes(colorBy)) throw new Error(`${layer}: no existe el campo ${colorBy} para colorear`);
    return { ...p, colorBy, extra };
  });
  const order = { Polygon: 0, LineString: 1, Point: 2 };
  themed.sort((a, b) => order[a.geometry] - order[b.geometry]);
  for (const t of themed) {
    const style = t.colorBy
      ? thematic(t.colorBy, t.extra.opacity)
      : single(t.geometry === "Point" ? "#762817" : "#4a4458", t.geometry, t.geometry === "Point" ? { size: 7 } : {});
    layers.push({ role: "thematic", ...t, style, visible: t.extra.visible ?? true, zIndex: z++ });
  }
  const limit = prepare(LIMIT);
  layers.push({ role: "base", scale: "1:5.000", ...limit, style: single("#b3261e", "LineString"), visible: true, zIndex: z++ });
  for (const n of ["toponimia_arch_50m_utm15s_wgs84", "Centros_poblados_100m_utm15s_wgs84"]) {
    layers.push({ role: "base", scale: "1:50.000", ...byName(n), visible: true, zIndex: z++ });
  }
  for (const t of themed) delete t.extra;
  const rasters = (m.rasters || []).map((r, i) => ({
    ...r, name: r.file.replace(/\.tif$/, ""), zIndex: i,
  }));
  const main = themed.filter((t) => t.colorBy).map((t) => `«${t.colorBy}»`).join(" y ");
  const description = [
    SOURCE, `Fecha: ${m.date}.`, m.note, main ? `Color por ${main}.` : null, themed.length ? CODES : null, BASES,
  ].filter(Boolean).join(" ");
  return {
    title: `Puerto Villamil - ${m.title}`, categoryId: m.cat[0], thematic: m.cat[1], description,
    center: [-0.8918, -91.0015], zoom: 12, tags: [TAG, "IGM 2025", "Escala 1:5.000"], layers, rasters,
  };
});

fs.writeFileSync(path.join(staging, "plan.json"), JSON.stringify({ tag: TAG, maps }, null, 1));
const all = Object.values(prepared);
console.log(`mapas: ${maps.length}; capas propias: ${all.length} (con error: ${all.filter((l) => !l.ok).length}); ` +
  `rásteres: ${maps.reduce((s, m) => s + m.rasters.length, 0)}`);
for (const l of all) {
  console.log(`${l.ok ? "OK " : "ERR"} ${l.name}: ${l.featureCount}/${l.indexCount} ${l.geometry} ${l.sourceCrs}` +
    `${l.addedFields.length ? ` +${l.addedFields.length} _texto` : ""}${l.errors.length ? " — " + l.errors.join("; ") : ""}`);
}
