// The photo is shrunk in the browser before it is sent, as in the standalone
// app: at most 1600 px on its longest side, JPG at 82 % quality. A phone
// picture of several MB becomes a few hundred KB, well under the 4 MB limit.

const LADO_MAXIMO = 1600;
const CALIDAD = 0.82;

export async function toJpeg(file: Blob): Promise<Blob> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error("No se pudo leer la imagen. Usa una fotografía JPG o PNG.");
  }
  const scale = Math.min(1, LADO_MAXIMO / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error("No se pudo preparar la imagen."))), "image/jpeg", CALIDAD),
  );
}
