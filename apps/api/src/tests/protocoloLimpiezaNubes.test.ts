import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  claveSitio,
  extensionNube,
  lasIncompleto,
  leerCabeceraLas,
  limpiarDatosNube,
} from "../modules/protocoloLimpieza/reglas.js";
import { metadatosDePdal } from "../modules/protocoloLimpieza/pdalMetadatos.js";
import { lasDePrueba } from "./fixtures/lasDePrueba.js";

// Visualización 3D: the rules the browser and the API share (LAS header, the
// data of a cloud) and the reading of PDAL's output. The PDAL fixtures are the
// real outputs for the sample cloud (Pix4D, 23.4 million points, EPSG:32715).

const fixture = (nombre: string) => JSON.parse(readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url), "utf8"));

test("the LAS header gives version, format, points and bounds", () => {
  const c = leerCabeceraLas(lasDePrueba());
  assert.equal(c.version, "1.2");
  assert.equal(c.formato, 3);
  assert.equal(c.comprimido, false);
  assert.equal(c.puntos, 3);
  assert.equal(c.bytesPunto, 34);
  assert.equal(c.inicioPuntos, 227);
  assert.deepEqual(c.limites, { maxx: 798414.612, minx: 798175.605, maxy: 9918252.867, miny: 9918014.69, maxz: 39.46, minz: -12.85 });
  // LAS 1.4 keeps a 64-bit count; LAZ marks its compressed points in the format id.
  const l14 = leerCabeceraLas(lasDePrueba({ menor: 4, formato: 7, puntos: 5_000_000_000, registros: 0, comprimido: true }));
  assert.equal(l14.version, "1.4");
  assert.equal(l14.formato, 7);
  assert.equal(l14.comprimido, true);
  assert.equal(l14.puntos, 5_000_000_000);
});

test("anything that is not a LAS/LAZ is refused with a message for the user", () => {
  assert.throws(() => leerCabeceraLas(Buffer.from("no es una nube")), /no es una nube de puntos LAS\/LAZ válida/);
  const falsa = lasDePrueba();
  falsa.write("PK\x03\x04", 0, "binary");
  assert.throws(() => leerCabeceraLas(falsa), /no es una nube de puntos LAS\/LAZ válida/);
  const version = lasDePrueba();
  version[25] = 9;
  assert.throws(() => leerCabeceraLas(version), /Versión LAS 1\.9 no admitida/);
  assert.throws(() => leerCabeceraLas(lasDePrueba({ puntos: 0 })), /no tiene puntos/);
});

test("an uncompressed LAS shorter than its header says was cut on the way", () => {
  const completo = lasDePrueba();
  assert.equal(lasIncompleto(leerCabeceraLas(completo), completo.length), null);
  const cortado = lasDePrueba({ registros: 2 });
  assert.match(lasIncompleto(leerCabeceraLas(cortado), cortado.length) ?? "", /está incompleto: tiene 295 bytes y su cabecera indica 329/);
  // A LAZ cannot be checked that way.
  const laz = lasDePrueba({ comprimido: true, registros: 0 });
  assert.equal(lasIncompleto(leerCabeceraLas(laz), laz.length), null);
});

test("the data of a cloud: site, a survey date not after today, a short description", () => {
  assert.deepEqual(limpiarDatosNube({ sitio: "  Acopio   temporal ", fecha: "2026-11-10", descripcion: " Vuelo 1 " }, "2026-11-11"), {
    sitio: "Acopio temporal",
    fecha: "2026-11-10",
    descripcion: "Vuelo 1",
  });
  assert.throws(() => limpiarDatosNube({ fecha: "2026-11-10" }, "2026-11-11"), /Indica el sitio/);
  assert.throws(() => limpiarDatosNube({ sitio: "x".repeat(121), fecha: "2026-11-10" }, "2026-11-11"), /supera los 120/);
  assert.throws(() => limpiarDatosNube({ sitio: "A", fecha: "2026-02-30" }, "2026-11-11"), /Indica la fecha/);
  assert.throws(() => limpiarDatosNube({ sitio: "A", fecha: "2026-11-12" }, "2026-11-11"), /no puede ser posterior a hoy/);
  assert.throws(() => limpiarDatosNube({ sitio: "A", fecha: "2026-11-10", descripcion: "x".repeat(501) }, "2026-11-11"), /descripción supera/);
});

test("surveys of a site group together whatever the case, accents or spacing", () => {
  assert.equal(claveSitio("Acopio Temporal – Puerto Ayora"), claveSitio("acopio  temporal – puerto ayora"));
  assert.equal(claveSitio("Relleno sanitário"), claveSitio("relleno sanitario"));
  assert.notEqual(claveSitio("Acopio temporal"), claveSitio("Patio contenedores SCX"));
  assert.equal(extensionNube("Desechos_group1_densified_point_cloud.LAS"), ".las");
  assert.equal(extensionNube("vuelo.laz"), ".laz");
  assert.equal(extensionNube("vuelo.copc.laz"), ".laz");
  assert.equal(extensionNube("vuelo.ply"), null);
  assert.equal(extensionNube("las"), null);
});

test("PDAL's output becomes what the viewer needs: CRS, bounds, colour, classes and elevation", () => {
  const { metadatos, puntos } = metadatosDePdal(fixture("pdal-info-summary-copc.json"), fixture("pdal-stats-metadata.json"));
  assert.equal(puntos, 23_398_310);
  assert.equal(metadatos.crs?.nombre, "WGS 84 / UTM zone 15S");
  assert.equal(metadatos.crs?.epsg, 32715);
  assert.match(metadatos.crs?.wkt ?? "", /^PROJCS\["WGS 84 \/ UTM zone 15S"/);
  assert.match(metadatos.crs?.proj4 ?? "", /\+proj=utm \+zone=15 \+south/);
  assert.deepEqual(metadatos.limites, { minx: 798175.605, miny: 9918014.69, minz: -12.85, maxx: 798414.612, maxy: 9918252.867, maxz: 39.46 });
  assert.equal(metadatos.color, true);
  assert.ok(metadatos.dimensiones.includes("Classification"));
  // Ground first: the most frequent class.
  assert.deepEqual(metadatos.clases, [
    { codigo: 2, puntos: 10_254_238 },
    { codigo: 5, puntos: 6_275_543 },
    { codigo: 11, puntos: 3_554_439 },
    { codigo: 6, puntos: 2_304_581 },
    { codigo: 3, puntos: 1_009_509 },
  ]);
  assert.equal(metadatos.clases.reduce((s, c) => s + c.puntos, 0), puntos);
  assert.deepEqual(metadatos.z, { min: -12.85, max: 39.46, media: 18.74920221, desviacion: 2.090063821 });
});

test("a cloud without a coordinate system is still shown; missing bounds are an error", () => {
  const resumen = fixture("pdal-info-summary-copc.json");
  delete resumen.summary.srs;
  assert.equal(metadatosDePdal(resumen, {}).metadatos.crs, null);
  // Without statistics, the elevation comes from the bounds and there are no classes.
  assert.deepEqual(metadatosDePdal(resumen, {}).metadatos.clases, []);
  assert.equal(metadatosDePdal(resumen, {}).metadatos.z.max, 39.46);
  delete resumen.summary.bounds;
  assert.throws(() => metadatosDePdal(resumen, {}), /PDAL no informó los límites/);
});
