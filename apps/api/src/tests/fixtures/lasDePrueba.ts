// A small LAS file for the point cloud tests (Visualización 3D).

/** A LAS file with `puntos` points: the public header block and empty records. */
interface OpcionesLas {
  menor?: number;
  formato?: number;
  puntos?: number;
  bytesPunto?: number;
  comprimido?: boolean;
  /** Point records actually written (fewer than `puntos` makes a cut file). */
  registros?: number;
}

export function lasDePrueba(opciones: OpcionesLas = {}): Buffer {
  const { menor = 2, formato = 3, puntos = 3, bytesPunto = 34, comprimido = false } = opciones;
  const registros = opciones.registros ?? puntos;
  const cabecera = menor >= 4 ? 375 : 227;
  const b = Buffer.alloc(cabecera + registros * bytesPunto);
  b.write("LASF", 0, "ascii");
  b[24] = 1;
  b[25] = menor;
  b.writeUInt16LE(cabecera, 94);
  b.writeUInt32LE(cabecera, 96);
  b[104] = formato | (comprimido ? 0x80 : 0);
  b.writeUInt16LE(bytesPunto, 105);
  b.writeUInt32LE(menor >= 4 ? 0 : puntos, 107);
  [798414.612, 798175.605, 9918252.867, 9918014.69, 39.46, -12.85].forEach((v, i) => b.writeDoubleLE(v, 179 + i * 8));
  if (menor >= 4) b.writeBigUInt64LE(BigInt(puntos), 247);
  return b;
}
