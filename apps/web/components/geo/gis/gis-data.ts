import type { Basemap } from "./types";

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
