import type { FeatureCollection, Feature } from "geojson";
import type { Basemap, SampleDataset } from "./types";

// ────────────────────────────────────────────────────────────
// Provincias del Ecuador (polygons) — simplified outlines
// ────────────────────────────────────────────────────────────
const PROVINCIAS_FEATURES: Feature[] = [
  { type: "Feature", properties: { nombre: "Pichincha", region: "Sierra", poblacion: 3228233, area_km2: 9494, pib_per_capita: 8420, indice_calidad_aire: 62, categoria_climatica: "Templado", cobertura_bosque_pct: 24.5, fecha_levantamiento: "2024-03-12" }, geometry: { type: "Polygon", coordinates: [[[-78.85,0.35],[-78.20,0.45],[-77.95,0.20],[-77.90,-0.05],[-78.10,-0.35],[-78.55,-0.55],[-78.95,-0.40],[-79.05,-0.10],[-78.95,0.15],[-78.85,0.35]]] } },
  { type: "Feature", properties: { nombre: "Guayas", region: "Costa", poblacion: 4387434, area_km2: 15430, pib_per_capita: 7180, indice_calidad_aire: 54, categoria_climatica: "Tropical", cobertura_bosque_pct: 11.2, fecha_levantamiento: "2024-04-02" }, geometry: { type: "Polygon", coordinates: [[[-80.45,-1.55],[-79.85,-1.45],[-79.55,-1.85],[-79.40,-2.45],[-79.65,-3.05],[-80.10,-3.10],[-80.45,-2.65],[-80.55,-2.05],[-80.45,-1.55]]] } },
  { type: "Feature", properties: { nombre: "Manabí", region: "Costa", poblacion: 1562079, area_km2: 18940, pib_per_capita: 5240, indice_calidad_aire: 71, categoria_climatica: "Tropical", cobertura_bosque_pct: 18.7, fecha_levantamiento: "2024-02-18" }, geometry: { type: "Polygon", coordinates: [[[-80.90,0.05],[-80.20,-0.05],[-79.85,-0.55],[-79.95,-1.15],[-80.25,-1.55],[-80.85,-1.45],[-80.95,-0.85],[-80.90,0.05]]] } },
  { type: "Feature", properties: { nombre: "Azuay", region: "Sierra", poblacion: 881394, area_km2: 8125, pib_per_capita: 6890, indice_calidad_aire: 78, categoria_climatica: "Templado", cobertura_bosque_pct: 32.1, fecha_levantamiento: "2024-05-08" }, geometry: { type: "Polygon", coordinates: [[[-79.50,-2.45],[-78.85,-2.40],[-78.60,-2.85],[-78.70,-3.35],[-79.15,-3.50],[-79.55,-3.15],[-79.60,-2.75],[-79.50,-2.45]]] } },
  { type: "Feature", properties: { nombre: "Loja", region: "Sierra", poblacion: 521154, area_km2: 11066, pib_per_capita: 4520, indice_calidad_aire: 82, categoria_climatica: "Templado", cobertura_bosque_pct: 28.4, fecha_levantamiento: "2024-01-22" }, geometry: { type: "Polygon", coordinates: [[[-80.05,-3.45],[-79.40,-3.50],[-79.05,-4.05],[-79.15,-4.55],[-79.60,-4.75],[-80.10,-4.45],[-80.15,-3.85],[-80.05,-3.45]]] } },
  { type: "Feature", properties: { nombre: "Esmeraldas", region: "Costa", poblacion: 643654, area_km2: 15952, pib_per_capita: 4980, indice_calidad_aire: 84, categoria_climatica: "Tropical", cobertura_bosque_pct: 52.6, fecha_levantamiento: "2024-03-30" }, geometry: { type: "Polygon", coordinates: [[[-80.05,1.45],[-79.10,1.35],[-78.85,0.95],[-78.95,0.45],[-79.45,0.15],[-80.00,0.45],[-80.15,0.95],[-80.05,1.45]]] } },
  { type: "Feature", properties: { nombre: "Napo", region: "Amazonía", poblacion: 133705, area_km2: 12476, pib_per_capita: 5150, indice_calidad_aire: 91, categoria_climatica: "Lluvioso", cobertura_bosque_pct: 78.3, fecha_levantamiento: "2024-04-15" }, geometry: { type: "Polygon", coordinates: [[[-78.10,0.05],[-77.10,0.15],[-76.55,-0.35],[-76.65,-0.95],[-77.25,-1.15],[-77.85,-0.95],[-78.15,-0.45],[-78.10,0.05]]] } },
  { type: "Feature", properties: { nombre: "Pastaza", region: "Amazonía", poblacion: 114202, area_km2: 29520, pib_per_capita: 4720, indice_calidad_aire: 93, categoria_climatica: "Lluvioso", cobertura_bosque_pct: 82.7, fecha_levantamiento: "2024-02-26" }, geometry: { type: "Polygon", coordinates: [[[-78.05,-1.15],[-76.85,-1.05],[-76.15,-1.55],[-76.05,-2.45],[-76.85,-2.65],[-77.55,-2.45],[-78.05,-1.85],[-78.05,-1.15]]] } },
  { type: "Feature", properties: { nombre: "El Oro", region: "Costa", poblacion: 715751, area_km2: 5879, pib_per_capita: 6620, indice_calidad_aire: 65, categoria_climatica: "Tropical", cobertura_bosque_pct: 14.8, fecha_levantamiento: "2024-05-20" }, geometry: { type: "Polygon", coordinates: [[[-80.45,-3.05],[-79.80,-3.10],[-79.55,-3.45],[-79.65,-3.85],[-80.05,-3.95],[-80.50,-3.65],[-80.55,-3.25],[-80.45,-3.05]]] } },
  { type: "Feature", properties: { nombre: "Tungurahua", region: "Sierra", poblacion: 590600, area_km2: 3334, pib_per_capita: 6320, indice_calidad_aire: 68, categoria_climatica: "Templado", cobertura_bosque_pct: 21.5, fecha_levantamiento: "2024-06-04" }, geometry: { type: "Polygon", coordinates: [[[-78.85,-1.05],[-78.35,-1.05],[-78.20,-1.35],[-78.30,-1.65],[-78.65,-1.75],[-78.95,-1.55],[-79.00,-1.25],[-78.85,-1.05]]] } },
  { type: "Feature", properties: { nombre: "Chimborazo", region: "Sierra", poblacion: 524004, area_km2: 6500, pib_per_capita: 5780, indice_calidad_aire: 74, categoria_climatica: "Templado", cobertura_bosque_pct: 19.8, fecha_levantamiento: "2024-03-19" }, geometry: { type: "Polygon", coordinates: [[[-79.15,-1.55],[-78.55,-1.65],[-78.35,-2.05],[-78.50,-2.45],[-78.95,-2.55],[-79.30,-2.25],[-79.35,-1.85],[-79.15,-1.55]]] } },
  { type: "Feature", properties: { nombre: "Imbabura", region: "Sierra", poblacion: 476257, area_km2: 4986, pib_per_capita: 5840, indice_calidad_aire: 76, categoria_climatica: "Templado", cobertura_bosque_pct: 26.3, fecha_levantamiento: "2024-04-28" }, geometry: { type: "Polygon", coordinates: [[[-78.85,0.85],[-78.25,0.95],[-78.00,0.65],[-78.05,0.30],[-78.45,0.20],[-78.85,0.35],[-78.95,0.65],[-78.85,0.85]]] } },
];

// ────────────────────────────────────────────────────────────
// Estaciones de Monitoreo Ambiental (points)
// ────────────────────────────────────────────────────────────
const ESTACIONES_FEATURES: [string,string,string,number,number,number,number,string,string,number][] = [
  ["EM-001","Quito Centro","Aire",-78.512,-0.220,28.4,7.1,"Activa","2019-03-15",2850],
  ["EM-002","Quito Sur","Aire",-78.545,-0.295,42.1,6.8,"Activa","2020-06-22",2780],
  ["EM-003","Guayaquil Norte","Aire",-79.910,-2.105,38.7,7.0,"Activa","2018-11-08",12],
  ["EM-004","Guayaquil Sur","Agua",-79.895,-2.255,15.2,7.4,"Activa","2021-02-14",8],
  ["EM-005","Cuenca Tomebamba","Agua",-79.005,-2.905,12.8,7.6,"Activa","2017-09-30",2520],
  ["EM-006","Loja Río Zamora","Agua",-79.205,-3.985,18.5,7.2,"Mantenimiento","2019-05-11",2080],
  ["EM-007","Esmeraldas Puerto","Aire",-79.655,0.965,22.3,6.9,"Activa","2020-08-18",6],
  ["EM-008","Manta Costa","Aire",-80.715,-0.960,19.7,7.0,"Activa","2018-04-25",10],
  ["EM-009","Ambato Centro","Aire",-78.620,-1.245,35.6,6.7,"Activa","2019-12-03",2540],
  ["EM-010","Riobamba Norte","Aire",-78.665,-1.665,29.8,6.9,"Activa","2020-10-19",2750],
  ["EM-011","Machala Puerto","Agua",-79.965,-3.265,21.4,7.3,"Activa","2021-07-08",4],
  ["EM-012","Ibarra Yahuarcocha","Agua",-78.105,0.375,14.6,7.5,"Activa","2022-01-25",2200],
  ["EM-013","Tena Río Napo","Agua",-77.815,-0.985,9.3,7.7,"Activa","2021-04-17",520],
  ["EM-014","Puyo Río Pastaza","Agua",-77.985,-1.485,11.2,7.6,"Activa","2020-09-13",950],
  ["EM-015","Lago Agrio","Suelo",-76.885,0.085,45.8,5.9,"Alerta","2018-07-20",295],
  ["EM-016","Coca Río Napo","Agua",-76.985,-0.465,16.7,7.1,"Activa","2019-11-29",260],
  ["EM-017","Latacunga Cotopaxi","Aire",-78.615,-0.935,31.5,6.8,"Activa","2020-03-08",2780],
  ["EM-018","Macas Río Upano","Agua",-78.105,-2.305,13.9,7.4,"Activa","2021-10-12",1050],
  ["EM-019","Zamora Río Bombuscaro","Agua",-78.955,-4.075,10.5,7.5,"Activa","2022-05-30",980],
  ["EM-020","Galápagos Pto Ayora","Agua",-90.315,-0.745,8.1,7.8,"Activa","2017-02-15",6],
  ["EM-021","Otavalo San Pablo","Agua",-78.225,0.205,17.8,7.3,"Inactiva","2018-08-04",2660],
  ["EM-022","Salinas Costa","Aire",-80.975,-2.215,16.3,7.0,"Activa","2019-06-26",5],
  ["EM-023","Mejía Volcán","Suelo",-78.520,-0.515,52.7,6.2,"Alerta","2020-11-15",2900],
  ["EM-024","Quevedo Río","Agua",-79.475,-1.025,23.6,6.8,"Activa","2021-08-22",75],
];

const ESTACIONES: FeatureCollection = {
  type: "FeatureCollection",
  features: ESTACIONES_FEATURES.map(([id,nombre,tipo,lon,lat,pm25,ph,estado,fecha,elev]) => ({
    type: "Feature",
    properties: { id, nombre, tipo, pm25, ph, estado, fecha_instalacion: fecha, elevacion_m: elev },
    geometry: { type: "Point", coordinates: [lon, lat] },
  })),
};

// ────────────────────────────────────────────────────────────
// Cuencas Hidrográficas (polygons)
// ────────────────────────────────────────────────────────────
const CUENCAS_FEATURES = [
  { properties: { nombre: "Cuenca del Guayas", caudal_m3s: 920, longitud_km: 389, categoria: "Mayor", calidad_agua: "Regular", area_km2: 34500 }, coords: [[-80.0,-1.0],[-78.8,-1.0],[-78.6,-2.2],[-79.5,-3.0],[-80.1,-2.5],[-80.0,-1.0]] },
  { properties: { nombre: "Cuenca del Napo", caudal_m3s: 6300, longitud_km: 1075, categoria: "Mayor", calidad_agua: "Buena", area_km2: 60800 }, coords: [[-78.0,-0.4],[-76.0,-0.4],[-75.7,-1.7],[-77.5,-1.5],[-78.0,-0.4]] },
  { properties: { nombre: "Cuenca del Pastaza", caudal_m3s: 2810, longitud_km: 643, categoria: "Mayor", calidad_agua: "Buena", area_km2: 32100 }, coords: [[-78.5,-1.2],[-76.5,-1.2],[-76.2,-2.6],[-78.2,-2.4],[-78.5,-1.2]] },
  { properties: { nombre: "Cuenca del Esmeraldas", caudal_m3s: 690, longitud_km: 320, categoria: "Mediana", calidad_agua: "Regular", area_km2: 21400 }, coords: [[-80.1,1.4],[-78.7,1.0],[-78.5,0.1],[-79.7,0.0],[-80.1,1.4]] },
  { properties: { nombre: "Cuenca del Mira", caudal_m3s: 250, longitud_km: 88, categoria: "Menor", calidad_agua: "Buena", area_km2: 6700 }, coords: [[-78.8,1.4],[-77.9,1.4],[-77.7,0.7],[-78.6,0.6],[-78.8,1.4]] },
  { properties: { nombre: "Cuenca del Jubones", caudal_m3s: 195, longitud_km: 156, categoria: "Menor", calidad_agua: "Regular", area_km2: 4350 }, coords: [[-80.2,-3.1],[-79.1,-3.0],[-79.3,-3.6],[-80.3,-3.5],[-80.2,-3.1]] },
];

const CUENCAS: FeatureCollection = {
  type: "FeatureCollection",
  features: CUENCAS_FEATURES.map((f) => ({
    type: "Feature", properties: f.properties,
    geometry: { type: "Polygon", coordinates: [f.coords] },
  })),
};

// ────────────────────────────────────────────────────────────
// Red Vial Principal (lines)
// ────────────────────────────────────────────────────────────
const VIAS_FEATURES = [
  { props: { nombre: "Panamericana Norte", tipo: "Primaria", longitud_km: 235, estado: "Buena", peajes: 4 }, line: [[-78.51,-0.22],[-78.45,0.12],[-78.10,0.35],[-77.72,0.81],[-77.71,1.21]] },
  { props: { nombre: "Panamericana Sur", tipo: "Primaria", longitud_km: 685, estado: "Buena", peajes: 8 }, line: [[-78.51,-0.22],[-78.62,-0.93],[-78.62,-1.66],[-78.85,-2.40],[-79.20,-3.99],[-79.55,-4.75]] },
  { props: { nombre: "Vía Costa E15", tipo: "Primaria", longitud_km: 580, estado: "Regular", peajes: 5 }, line: [[-80.95,1.05],[-80.72,0.10],[-80.75,-0.95],[-80.05,-2.20],[-79.85,-3.27]] },
  { props: { nombre: "Quito-Manta E20", tipo: "Secundaria", longitud_km: 420, estado: "Regular", peajes: 3 }, line: [[-78.51,-0.22],[-79.20,-0.30],[-79.85,-0.55],[-80.72,-0.95]] },
  { props: { nombre: "Cuenca-Loja E35", tipo: "Secundaria", longitud_km: 215, estado: "Buena", peajes: 2 }, line: [[-78.99,-2.90],[-79.10,-3.40],[-79.20,-3.99]] },
  { props: { nombre: "Vía a Lago Agrio", tipo: "Secundaria", longitud_km: 295, estado: "Mala", peajes: 1 }, line: [[-78.51,-0.22],[-78.10,-0.05],[-77.55,0.05],[-76.88,0.08]] },
  { props: { nombre: "Vía Puyo-Macas", tipo: "Terciaria", longitud_km: 180, estado: "Mala", peajes: 0 }, line: [[-77.99,-1.48],[-78.05,-1.90],[-78.10,-2.30]] },
  { props: { nombre: "Vía Esmeraldas-Mataje", tipo: "Terciaria", longitud_km: 175, estado: "Regular", peajes: 0 }, line: [[-79.65,0.96],[-79.10,1.10],[-78.85,1.30]] },
];

const VIAS: FeatureCollection = {
  type: "FeatureCollection",
  features: VIAS_FEATURES.map((f) => ({
    type: "Feature", properties: f.props,
    geometry: { type: "LineString", coordinates: f.line },
  })),
};

const PROVINCIAS: FeatureCollection = { type: "FeatureCollection", features: PROVINCIAS_FEATURES };

export const SAMPLE_DATASETS: SampleDataset[] = [
  { id: "ds_provincias", name: "Provincias del Ecuador", filename: "provincias_ecuador.shp", geometry: "Polygon", feature_count: PROVINCIAS.features.length, size: "284 KB", crs: "EPSG:4326", geojson: PROVINCIAS, icon: "polygon" },
  { id: "ds_estaciones", name: "Estaciones de Monitoreo Ambiental", filename: "estaciones_monitoreo.shp", geometry: "Point", feature_count: ESTACIONES.features.length, size: "47 KB", crs: "EPSG:4326", geojson: ESTACIONES, icon: "point" },
  { id: "ds_cuencas", name: "Cuencas Hidrográficas", filename: "cuencas_hidrograficas.shp", geometry: "Polygon", feature_count: CUENCAS.features.length, size: "126 KB", crs: "EPSG:4326", geojson: CUENCAS, icon: "polygon" },
  { id: "ds_vias", name: "Red Vial Principal", filename: "red_vial_principal.shp", geometry: "LineString", feature_count: VIAS.features.length, size: "98 KB", crs: "EPSG:4326", geojson: VIAS, icon: "line" },
];

export const COLOR_RAMPS: Record<string, string[]> = {
  greens:  ["#e7f0ea","#c7dccf","#9bbfa9","#6c9e83","#3f7c5f","#1f5a3f","#0d3a26"],
  blues:   ["#e8eef6","#c6d4e8","#9eb6d4","#7395ba","#4d749f","#2c5481","#11355f"],
  oranges: ["#fbeadd","#f5d0a8","#eeb074","#dd8e47","#c46d27","#9e4f12","#6e3409"],
  reds:    ["#f4e3df","#e7bcb4","#d49386","#bc6a5b","#9d4636","#762817","#481208"],
  viridis: ["#440154","#414487","#2a788e","#22a884","#7ad151","#fde725"],
  earth:   ["#f0ecdf","#dfd0a8","#c4ad6f","#9c8347","#6e5a2c","#473918","#2a210b"],
  grayscale:["#f4f4f4","#d4d4d4","#a3a3a3","#737373","#525252","#262626","#0a0a0a"],
  categorical: ["#3f7c5f","#c46d27","#2c5481","#9d4636","#6e5a2c","#4a4458","#1f5a3f","#762817","#473918","#22a884"],
};

export const BASEMAPS: Record<string, Basemap> = {
  light: { name: "Claro", url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", attribution: "© OpenStreetMap, © CARTO" },
  dark: { name: "Oscuro", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", attribution: "© OpenStreetMap, © CARTO" },
  satellite: { name: "Satelital", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "© Esri" },
  topo: { name: "Topográfico", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: "© OpenTopoMap" },
  osm: { name: "OpenStreetMap", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap" },
};

export const BASEMAP_PREVIEWS: Record<string, string> = {
  light: "linear-gradient(135deg, #f3efe9 0%, #e7e5e1 100%)",
  dark: "linear-gradient(135deg, #1f1f1f 0%, #3a3a3a 100%)",
  satellite: "linear-gradient(135deg, #3a4f2c 0%, #6a4a2c 60%, #4a5a3c 100%)",
  topo: "linear-gradient(135deg, #e8dec0 0%, #b2c285 50%, #6d8c5a 100%)",
  osm: "linear-gradient(135deg, #f1e9d2 0%, #d8e5d0 100%)",
};
