import { toPng } from "html-to-image";

import type { Format, Orientation } from "./types";

export interface PdfExportOptions {
  format: Format;
  orientation: Orientation;
  title: string;
}

const PAPER_MM: Record<Format, readonly [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
};

function pageDimensions(format: Format, orientation: Orientation): readonly [number, number] {
  const [width, height] = PAPER_MM[format];
  return orientation === "h" ? [height, width] : [width, height];
}

function copyDocumentStyles(): string {
  return Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>("style, link[rel='stylesheet']"))
    .map((node) => node.outerHTML)
    .join("\n");
}

async function rasterizeInteractiveMaps(source: HTMLElement, clone: HTMLElement): Promise<void> {
  const sourceMaps = Array.from(source.querySelectorAll<HTMLElement>("[data-export-map]"));
  const clonedMaps = Array.from(clone.querySelectorAll<HTMLElement>("[data-export-map]"));

  await Promise.all(sourceMaps.map(async (mapNode, index) => {
    const clonedMap = clonedMaps[index];
    if (!clonedMap || mapNode.dataset.exportMap === "image") return;

    try {
      const dataUrl = await toPng(mapNode, {
        cacheBust: true,
        backgroundColor: "#e8edf1",
        pixelRatio: 2,
      });
      const image = document.createElement("img");
      image.src = dataUrl;
      image.alt = "Mapa cartográfico";
      image.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
      clonedMap.replaceChildren(image);
    } catch {
      // External Leaflet tiles may not expose CORS headers. In that case the
      // cloned Leaflet DOM stays in place so the browser can still print its
      // cached tile images instead of substituting unrelated cartography.
    }
  }));
}

async function waitForPrintAssets(printWindow: Window): Promise<void> {
  const stylesheets = Array.from(printWindow.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  const stylesReady = Promise.all(stylesheets.map((link) => {
    if (link.sheet) return Promise.resolve();
    return new Promise<void>((resolve) => {
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => resolve(), { once: true });
    });
  }));
  await Promise.race([
    stylesReady,
    new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
  ]);
  await printWindow.document.fonts?.ready;
  const images = Array.from(printWindow.document.images);
  await Promise.all(images.map((image) => Promise.race([
    (async () => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }
    })(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 5000)),
  ])));
}

/**
 * Prints the exact sheet DOM. The popup is opened before the first await so a
 * user click always counts as the browser activation that authorises it.
 */
export async function exportMapPdf(sheet: HTMLElement, options: PdfExportOptions): Promise<void> {
  const printWindow = window.open("", "_blank", "width=1200,height=800");
  if (!printWindow) {
    throw new Error("El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes e inténtalo de nuevo.");
  }

  printWindow.document.write(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Preparando PDF…</title></head>" +
    "<body style=\"margin:0;display:grid;min-height:100vh;place-items:center;font:14px system-ui;color:#475569\">" +
    "Preparando la carta cartográfica…</body></html>",
  );
  printWindow.document.close();

  try {
    const clone = sheet.cloneNode(true) as HTMLElement;
    clone.style.transform = "none";
    clone.style.transformOrigin = "top left";
    clone.style.boxShadow = "none";
    clone.style.margin = "0";
    clone.style.outline = "none";
    clone.removeAttribute("aria-label");
    clone.querySelectorAll<HTMLElement>("[data-editor-chrome]").forEach((node) => node.remove());
    await rasterizeInteractiveMaps(sheet, clone);

    const [width, height] = pageDimensions(options.format, options.orientation);
    const styles = copyDocumentStyles();
    const baseHref = document.baseURI.replace(/"/g, "&quot;");
    const title = options.title.replace(/[<>&"]/g, (character) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
    })[character] ?? character);

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <base href="${baseHref}" />
          <title>${title}</title>
          ${styles}
          <style>
            @page { size: ${width}mm ${height}mm; margin: 0; }
            html, body { width: ${width}mm; height: ${height}mm; margin: 0; padding: 0; background: #fff; }
            body { overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            [data-export-sheet] { transform: none !important; box-shadow: none !important; }
          </style>
        </head>
        <body>${clone.outerHTML}</body>
      </html>`);
    printWindow.document.close();
    await waitForPrintAssets(printWindow);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    printWindow.document.body.innerHTML =
      '<main style="padding:32px;font:14px system-ui;color:#b91c1c">No se pudo preparar la carta para imprimir.</main>';
    throw error;
  }
}
