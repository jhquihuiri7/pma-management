// Validates every converted layer against indice_capas.xlsx and writes
// analysis.json. Usage: node analyze.cjs <index.json> <out dir> <analysis.json>
const fs = require("fs");
const path = require("path");

const [indexPath, outDir, analysisPath] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

// Galápagos envelope (generous): any reprojected layer must fall inside it.
const GALAPAGOS = [-93.5, -2.5, -88.0, 2.5];
// Some layers (maritime routes, ecoregions, territorial sea) legitimately reach
// mainland Ecuador; only coordinates beyond this are a reprojection error.
const ECUADOR = [-96.5, -6.0, -74.0, 7.0];
const MOJIBAKE = /Ã[\u0080-¿]|Â[\u0080-¿]|�|Ã±|Ã©|Ã¡|Ã³|Ãº|Ã­/;
const ACCENTED = /[áéíóúÁÉÍÓÚñÑüÜ]/;

function readOr(p, fallback = "") {
  try { return fs.readFileSync(p, "utf8"); } catch { return fallback; }
}

function bboxOf(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  let dims = new Set();
  const visit = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") {
      dims.add(c.length);
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
      return;
    }
    c.forEach(visit);
  };
  for (const f of features) if (f.geometry) visit(f.geometry.coordinates);
  return { bbox: b[0] === Infinity ? null : b, dims: [...dims] };
}

const GEOM_FROM_INDEX = { "Polígono": "Polygon", "Línea": "LineString", "Punto": "Point", "Point Z": "Point" };

const results = [];
for (const row of index) {
  const folder = row["Carpeta"];
  const base = row["Archivo .zip"].replace(/\.zip$/i, "");
  const info = path.join(outDir, "info", folder, base);
  const geojsonPath = path.join(outDir, "geojson", folder, `${base}.geojson`);
  const r = {
    folder, mapa: row["Mapa"], base, zip: row["Archivo .zip"],
    indexGeometry: row["Geometría"], indexCount: row["Registros"], indexCrs: row["Sistema de coordenadas"],
    indexNotes: row["Notas"], renamed: row["Campos renombrados"],
    prjEpsg: readOr(`${info}.epsg`).trim() || null,
    cpg: readOr(`${info}.cpg`).trim() || null,
    ogrGeometry: (/^Geometry: (.+)$/m.exec(readOr(`${info}.ogrinfo`)) || [])[1] || null,
    ogrCount: Number((/^Feature Count: (\d+)$/m.exec(readOr(`${info}.ogrinfo`)) || [])[1] ?? NaN),
    errors: [], warnings: [],
  };
  const convLog = readOr(`${info}.ogr2ogr.log`).trim();
  if (!fs.existsSync(`${info}.entries`)) {
    r.errors.push("El .zip no está en el servidor: la subida de la carpeta no lo incluyó");
    results.push(r);
    continue;
  }
  if (!fs.existsSync(geojsonPath) || /FAILURE|ERROR/.test(convLog)) {
    r.errors.push(`No se pudo leer el shapefile: ${convLog.split("\n").slice(0, 2).join(" ") || "sin salida"}`);
    results.push(r);
    continue;
  }
  if (convLog) r.warnings.push(`GDAL: ${[...new Set(convLog.split("\n"))].join(" | ")}`);

  const fc = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const features = fc.features || [];
  r.sizeBytes = fs.statSync(geojsonPath).size;
  r.convertedCount = features.length;
  r.nullGeometries = features.filter((f) => !f.geometry).length;
  r.geometryTypes = [...new Set(features.filter((f) => f.geometry).map((f) => f.geometry.type))];
  const { bbox, dims } = bboxOf(features);
  r.bbox = bbox;
  r.coordDims = dims;
  r.fields = Object.keys(features[0]?.properties || {});
  r.longFields = r.fields.filter((k) => k.length > 10);

  const expected = GEOM_FROM_INDEX[r.indexGeometry];
  const allowed = new Set([expected, `Multi${expected}`]);
  const bad = r.geometryTypes.filter((t) => !allowed.has(t));
  if (!expected) r.errors.push(`Geometría del índice no reconocida: ${r.indexGeometry}`);
  if (bad.length) r.errors.push(`Geometrías ${bad.join(", ")} no coinciden con ${r.indexGeometry}`);
  if (r.nullGeometries) r.warnings.push(`${r.nullGeometries} registro(s) sin geometría`);
  const outside = (env) => bbox && (bbox[0] < env[0] || bbox[1] < env[1] || bbox[2] > env[2] || bbox[3] > env[3]);
  if (outside(ECUADOR)) {
    r.errors.push(`Extensión fuera de Ecuador tras reproyectar: ${bbox.map((v) => v.toFixed(4)).join(", ")}`);
  } else if (outside(GALAPAGOS)) {
    r.warnings.push(`Se extiende fuera del archipiélago (hasta el continente): ${bbox.map((v) => v.toFixed(2)).join(", ")}`);
  }
  const expectedEpsg = (/EPSG:(\d+)/.exec(r.indexCrs) || [])[0];
  if (r.prjEpsg !== expectedEpsg) r.warnings.push(`EPSG del .prj (${r.prjEpsg}) distinto al índice (${expectedEpsg})`);
  if (!/^utf-?8$/i.test(r.cpg || "")) r.warnings.push(`.cpg = ${JSON.stringify(r.cpg)}`);

  // Encoding: count accented strings, flag mojibake/replacement chars.
  let accented = 0, mojibake = 0;
  const samples = new Set(), badSamples = new Set();
  for (const f of features) {
    for (const [k, v] of Object.entries(f.properties || {})) {
      if (typeof v !== "string") continue;
      if (MOJIBAKE.test(v)) { mojibake++; if (badSamples.size < 3) badSamples.add(`${k}=${v.slice(0, 60)}`); }
      else if (ACCENTED.test(v)) { accented++; if (samples.size < 3) samples.add(`${k}=${v.slice(0, 60)}`); }
    }
    for (const k of Object.keys(f.properties || {})) if (MOJIBAKE.test(k)) badSamples.add(`campo ${k}`);
  }
  r.accentedValues = accented;
  r.accentedSamples = [...samples];
  r.mojibakeValues = mojibake;
  r.mojibakeSamples = [...badSamples];
  r.accentedFieldNames = r.fields.filter((k) => ACCENTED.test(k));
  if (mojibake || badSamples.size) r.errors.push(`Texto mal codificado: ${[...badSamples].join(" · ")}`);
  results.push(r);
}

fs.writeFileSync(analysisPath, JSON.stringify(results, null, 1));
const failed = results.filter((r) => r.errors.length);
const countDiff = results.filter((r) => r.convertedCount !== undefined && r.convertedCount !== r.indexCount);
console.log(`capas: ${results.length}, con error: ${failed.length}, diferencia de registros: ${countDiff.length}`);
for (const r of failed) console.log(`ERR ${r.folder}/${r.base}: ${r.errors.join(" ; ").slice(0, 160)}`);
for (const r of countDiff) console.log(`CNT ${r.folder}/${r.base}: índice ${r.indexCount} vs ${r.convertedCount}`);
for (const r of results.filter((x) => x.warnings.length)) console.log(`WRN ${r.folder}/${r.base}: ${r.warnings.join(" ; ").slice(0, 200)}`);
const big = [...results].filter((r) => r.sizeBytes).sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 8);
for (const r of big) console.log(`SIZE ${(r.sizeBytes / 1e6).toFixed(1)} MB ${r.folder}/${r.base}`);
const enc = results.filter((r) => r.accentedValues || r.accentedFieldNames?.length);
console.log(`capas con tildes/ñ en valores: ${enc.length}; campos con tilde: ${results.flatMap((r) => r.accentedFieldNames || []).join(", ") || "ninguno"}`);
console.log(`dims: ${[...new Set(results.flatMap((r) => r.coordDims || []))]}`);
