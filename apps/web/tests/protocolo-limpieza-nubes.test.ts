import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import type { NubePuntos } from "@pma/types/protocolo-limpieza";
import {
  agruparPorSitio,
  claseNube,
  formatoBytes,
  formatoPuntos,
  nubeInicial,
  rangoAltura,
  revisarArchivoNube,
  textoEstado,
} from "../lib/protocolo-limpieza/nubes";

// Visualización 3D: what the view shows of each cloud, and the check of a file
// before it is uploaded.

let n = 0;
const nube = (sitio: string, fecha: string, extra: Partial<NubePuntos> = {}): NubePuntos => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  sitio,
  fecha,
  descripcion: "",
  archivoNombre: "nube.las",
  archivoBytes: 1000,
  estado: "lista",
  error: null,
  puntos: 3,
  copcBytes: 500,
  metadatos: null,
  version: 1,
  creadoPorNombre: "Olga",
  actualizadoPorNombre: "Olga",
  creadoEn: `${fecha}T12:00:00.000Z`,
  actualizadoEn: `${fecha}T12:00:00.000Z`,
  procesadaEn: null,
  ...extra,
});

/** A LAS 1.2 file with 3 points (the public header block and empty records). */
function las(registros = 3): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(227 + registros * 34);
  b.write("LASF", 0, "ascii");
  b[24] = 1;
  b[25] = 2;
  b.writeUInt16LE(227, 94);
  b.writeUInt32LE(227, 96);
  b[104] = 3;
  b.writeUInt16LE(34, 105);
  b.writeUInt32LE(3, 107);
  return Uint8Array.from(b);
}

test("clouds group by site, each site's timeline oldest first, the site surveyed last first", () => {
  const sitios = agruparPorSitio([
    nube("Acopio temporal", "2026-11-09"),
    nube("Relleno sanitario SCX", "2026-11-10"),
    nube("acopio  TEMPORAL", "2026-11-02"),
    nube("Acopio temporal", "2026-11-05"),
  ]);
  assert.deepEqual(sitios.map((s) => [s.sitio, s.nubes.map((x) => x.fecha)]), [
    ["Relleno sanitario SCX", ["2026-11-10"]],
    ["Acopio temporal", ["2026-11-02", "2026-11-05", "2026-11-09"]],
  ]);
});

test("the timeline opens on the cloud asked for, else the latest ready one", () => {
  const a = nube("A", "2026-11-01"), b = nube("A", "2026-11-05"), c = nube("A", "2026-11-09", { estado: "procesando" });
  assert.equal(nubeInicial([a, b, c], b.id.replace("0", "x")), b, "unknown id: the latest ready");
  assert.equal(nubeInicial([a, b, c], a.id), a);
  assert.equal(nubeInicial([c], null), c, "none ready: the latest");
  assert.equal(nubeInicial([], null), null);
});

test("sizes, points and states read in Spanish", () => {
  assert.equal(formatoBytes(795_543_629), "759 MB");
  assert.equal(formatoBytes(149_462_614), "143 MB");
  assert.equal(formatoBytes(5 * 1024 ** 3), "5 GB");
  assert.equal(formatoBytes(2048), "2 KB");
  assert.equal(formatoPuntos(23_398_310), "23,4 millones de puntos");
  assert.equal(formatoPuntos(850_000), "850 mil puntos");
  assert.equal(textoEstado({ estado: "procesando", error: null }), "Procesando");
  assert.equal(textoEstado({ estado: "error", error: "untwine terminó con código 1" }), "Error: untwine terminó con código 1");
  assert.deepEqual(claseNube(2), { nombre: "Suelo", color: "#b07d48" });
  assert.equal(claseNube(11).nombre, "Superficie de vía");
  assert.equal(claseNube(99).nombre, "Clase 99");
});

test("the elevation colours span the ground, not the stray points far above or below", () => {
  // The sample cloud: points from -12.85 to 39.46 m, most of them around 18.7 m.
  const [bajo, alto] = rangoAltura({ min: -12.85, max: 39.46, media: 18.74920221, desviacion: 2.090063821 });
  assert.equal(bajo.toFixed(2), "14.57");
  assert.equal(alto.toFixed(2), "25.02");
  // A flat cloud still gets a range.
  assert.deepEqual(rangoAltura({ min: 5, max: 5, media: 5, desviacion: 0 }), [5, 6]);
});

test("a file is checked in the browser before uploading it", async () => {
  const cabecera = await revisarArchivoNube(new File([las()], "vuelo.las"));
  assert.equal(cabecera.puntos, 3);
  await assert.rejects(() => revisarArchivoNube(new File([las()], "vuelo.ply")), /Elige un archivo \.las o \.laz/);
  await assert.rejects(() => revisarArchivoNube(new File([las(2)], "cortado.las")), /está incompleto/);
  await assert.rejects(() => revisarArchivoNube(new File([new Uint8Array(400)], "vacio.laz")), /no es una nube de puntos LAS\/LAZ válida/);
});

test("the laz-perf decoder served by SIGTAR is the one the installed copc package expects", () => {
  const require = createRequire(join(process.cwd(), "package.json"));
  const instalado = readFileSync(join(require.resolve("laz-perf/package.json").replace(/package\.json$/, ""), "lib", "laz-perf.wasm"));
  const servido = readFileSync(join(process.cwd(), "public", "protocolo-limpieza", "vendor", "laz-perf.wasm"));
  assert.ok(servido.equals(instalado), "copy node_modules/laz-perf/lib/laz-perf.wasm to public/protocolo-limpieza/vendor/ again");
});
