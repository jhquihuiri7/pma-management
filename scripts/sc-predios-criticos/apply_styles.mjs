// Runs INSIDE pma-api: applies styles.json (the delivery's .sld translated to
// the Geoportal's symbology) to the layers of the map, merged over each layer's
// current style. Needs the web with symbology.ts deployed to show the extras.
//   node apply_styles.mjs <styles.json> <map id> <actor user id>
import { readFile } from "node:fs/promises";
import { listLayers, updateLayer } from "/app/dist/apps/api/src/modules/geo/layersModule.js";
import { closeDb } from "/app/dist/apps/api/src/db/client.js";

const [stylesPath, mapId, actorId] = process.argv.slice(2);
const styles = JSON.parse(await readFile(stylesPath, "utf8"));
try {
  const layers = new Map((await listLayers(mapId)).map((l) => [l.name, l]));
  for (const [name, patch] of Object.entries(styles)) {
    if (name.startsWith("_")) continue;
    const layer = layers.get(name);
    if (!layer) { console.log(`falta | ${name}`); continue; }
    const style = { ...layer.style, ...patch };
    for (const key of ["symbol", "categories", "otherSymbol", "labelStyle"]) if (!(key in patch)) delete style[key];
    await updateLayer(mapId, layer.id, actorId, { style });
    console.log(`estilo | ${name}`);
  }
} finally {
  await closeDb();
}
