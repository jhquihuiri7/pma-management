// Builds the load report workbook from the plan, load results and checks.
// Usage: node report.cjs <scratch dir> <out.xlsx>
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const [dir, outPath] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const analysis = read("analysis.json");
const plan = read("staging/plan.json");
const results = read("results.json");
const verify = read("verify.json");
const dbf = read("dbf_check.json");
const BASE_URL = "https://sigtar.gobiernogalapagos.gob.ec/geo/maps";

const verifyById = new Map(verify.filter((v) => v.layerId).map((v) => [v.layerId, v]));
const resultByFolder = new Map(results.map((r) => [r.folder, r]));

// One row per source layer: what happened to it the first time it was loaded
// (base layers are loaded into every map; their counts are identical everywhere).
const loadedBySource = new Map();
for (const res of results) {
  for (const l of res.layers) {
    const key = `${l.sourceFolder}/${l.name}`;
    const prev = loadedBySource.get(key) ?? { maps: 0, ok: 0, featureCount: null, errors: new Set(), verified: true };
    prev.maps++;
    if (l.status === "created" || l.status === "exists") {
      prev.ok++;
      prev.featureCount = l.featureCount;
      const v = verifyById.get(l.layerId);
      if (!v || !v.ok) prev.verified = false;
    } else {
      prev.errors.add(l.error);
    }
    prev.dropped = l.dropped;
    loadedBySource.set(key, prev);
  }
}

const capas = analysis.map((a) => {
  const key = `${a.folder}/${a.base}`;
  const d = loadedBySource.get(key);
  const loaded = d && d.ok > 0 ? d.featureCount : null;
  const diff = loaded === null ? null : loaded - a.indexCount;
  const dropped = d?.dropped ?? [];
  const isBase = a.folder === "00_Capas_base";
  const mapsWithIt = isBase ? `${d?.ok ?? 0} de ${d?.maps ?? 0} mapas` : "";
  const encoding = dbf[key];
  return {
    "Carpeta": a.folder,
    "Capa": a.base,
    "Estado": loaded !== null ? (d.verified ? "Cargada" : "Cargada (verificación con observaciones)") : "Falló",
    "Error": loaded !== null ? "" : [...(d?.errors ?? a.errors)].join(" ; "),
    "Mapas donde está": mapsWithIt,
    "Geometría (índice)": a.indexGeometry,
    "Registros (índice)": a.indexCount,
    "Registros cargados": loaded,
    "Diferencia": diff,
    "Motivo de la diferencia": diff ? `${dropped.length} registro(s) sin geometría en el original (no se pueden dibujar; la API no los admite): ${dropped.map((x) => `fid ${x.fid} ${JSON.stringify(x.properties).slice(0, 80)}`).join(" · ").slice(0, 600)}` : "",
    "SRC (índice)": a.indexCrs,
    "SRC detectado en .prj": a.prjEpsg ?? "",
    "SRC almacenado": loaded !== null ? "EPSG:4326 (reproyectada)" : "",
    "Valores Z": /Z/.test(a.indexGeometry) ? "Descartada (el sistema trabaja en 2D); el .zip original con Z queda guardado" : "",
    ".cpg": a.cpg ?? "",
    "Textos con tildes/ñ": a.accentedValues ?? "",
    "Ejemplo": (a.accentedSamples ?? [])[0] ?? "",
    "Problemas de codificación": a.convertedCount === undefined ? "" : (a.mojibakeValues || encoding?.invalidCount ? `${a.mojibakeValues} valores dañados; ${encoding?.invalidCount ?? 0} bytes UTF-8 inválidos` : "Ninguno"),
    "Isla": a.folder.startsWith("S") ? (plan.maps.find((m) => m.folder === a.folder).layers.find((l) => l.name === a.base)?.island ?? "") : "",
    "Observaciones": (a.warnings ?? []).filter((w) => !/sin geometría|GDAL: Warning 1: NaN/.test(w)).join(" ; "),
  };
});

const mapas = plan.maps.map((m) => {
  const res = resultByFolder.get(m.folder);
  const thematic = m.layers.filter((l) => l.role === "thematic");
  const okThematic = res ? res.layers.filter((l) => l.role === "thematic" && (l.status === "created" || l.status === "exists")).length : 0;
  const okBase = res ? res.layers.filter((l) => l.role === "base" && (l.status === "created" || l.status === "exists")).length : 0;
  return {
    "Carpeta": m.folder,
    "Mapa": m.title,
    "Estado": res?.deferred ? "Pospuesto (no llegó ninguna capa temática)" : res?.mapId ? "Creado" : "No procesado",
    "Enlace": res?.mapId ? `${BASE_URL}/${res.mapId}/gis` : "",
    "Categoría": m.categoryId,
    "Temática": m.thematic,
    "Capas temáticas cargadas": m.folder === "00_Capas_base" ? "" : okThematic,
    "Capas temáticas en el índice": m.folder === "00_Capas_base" ? "" : thematic.length,
    "Capas base cargadas": res?.deferred ? 0 : okBase,
    "Capas que fallaron": thematic.length - okThematic + (res?.deferred ? 0 : 4 - okBase) - (m.folder === "00_Capas_base" ? 0 : 0),
  };
});

const porMapa = [];
for (const m of plan.maps) {
  const res = resultByFolder.get(m.folder);
  for (const l of [...m.layers].sort((a, b) => b.zIndex - a.zIndex)) {
    const r = res?.layers.find((x) => x.name === l.name && x.sourceFolder === l.folder);
    porMapa.push({
      "Mapa": m.title,
      "Orden (0 = fondo)": l.zIndex,
      "Capa": l.name,
      "Tipo": l.role === "base" ? "Base" : "Temática",
      "Geometría": l.geometry ?? l.indexGeometry,
      "Visible al inicio": l.visible ? "Sí" : "No",
      "Estado": res?.deferred && l.role === "base" ? "No creada (mapa pospuesto)" : r ? (r.status === "failed" ? "Falló" : "Cargada") : "—",
      "Error": r?.error ?? "",
      "Isla": l.island ?? "",
    });
  }
}

const wb = XLSX.utils.book_new();
const add = (rows, name, widths) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  XLSX.utils.book_append_sheet(wb, ws, name);
};
add(mapas, "Mapas", [44, 52, 30, 70, 22, 40, 12, 12, 12, 12]);
add(capas, "Capas", [40, 48, 12, 60, 14, 12, 10, 10, 10, 60, 26, 14, 24, 40, 8, 10, 50, 22, 18, 60]);
add(porMapa, "Capas por mapa", [52, 8, 48, 10, 12, 10, 24, 50, 18]);
XLSX.writeFile(wb, outPath);

const failed = capas.filter((c) => c.Estado === "Falló");
console.log(`capas fuente: ${capas.length}; cargadas: ${capas.length - failed.length}; fallidas: ${failed.length}`);
console.log(`diferencias de registros: ${capas.filter((c) => c.Diferencia).map((c) => `${c.Capa} (${c["Registros (índice)"]} → ${c["Registros cargados"]})`).join(", ")}`);
console.log(`con observaciones de verificación: ${capas.filter((c) => /observaciones/.test(c.Estado)).length}`);
for (const m of mapas) console.log(`${m.Carpeta} | ${m.Estado} | temáticas ${m["Capas temáticas cargadas"]}/${m["Capas temáticas en el índice"]} | base ${m["Capas base cargadas"]} | ${m.Enlace}`);
