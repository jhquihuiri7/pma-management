/**
 * wordUtils.ts
 * Builds a .docx (Word) file containing photos embedded as inline images.
 * Each photo is placed one below the other, height fixed at 8 cm,
 * width calculated to preserve the original aspect ratio.
 *
 * Two modes:
 *  - No template  → creates a minimal valid .docx from scratch.
 *  - With template → injects the images into the template's body,
 *    preserving its header, footer, and section properties.
 */

import JSZip from "jszip";

// ── Constants ────────────────────────────────────────────────────────────────

const CM_TO_EMU = 360_000; // 1 cm = 360,000 EMU (English Metric Units)
const TARGET_HEIGHT_EMU = 8 * CM_TO_EMU; // 2,880,000 EMU

// ── Types ────────────────────────────────────────────────────────────────────

export interface PhotoEntry {
  buffer: Buffer;
  /** Lowercase extension without dot: "jpeg" | "png" | "gif" | "bmp" | "webp" */
  ext: string;
  name: string;
}

export interface PhotoWithDescription extends PhotoEntry {
  description: string;
}

// ── Dimension parsers (no external dependency) ───────────────────────────────

function parseJpegDimensions(
  buf: Buffer
): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (i + 3 >= buf.length) break;
    const segLen = buf.readUInt16BE(i + 2);
    // SOF0..SOF3, SOF5..SOF7
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7].includes(marker) &&
      i + 8 < buf.length
    ) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + segLen;
  }
  return null;
}

function parsePngDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  // PNG signature is 8 bytes; IHDR chunk starts at byte 8
  // IHDR: 4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function parseGifDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 10) return null;
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
}

function parseBmpDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 26) return null;
  return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
}

function getImageDimensions(
  buf: Buffer,
  ext: string
): { widthEmu: number; heightEmu: number } {
  let dims: { w: number; h: number } | null = null;

  if (ext === "jpeg" || ext === "jpg") dims = parseJpegDimensions(buf);
  else if (ext === "png") dims = parsePngDimensions(buf);
  else if (ext === "gif") dims = parseGifDimensions(buf);
  else if (ext === "bmp") dims = parseBmpDimensions(buf);
  // webp and others: fall through to default

  const { w, h } = dims ?? { w: 4, h: 3 }; // 4:3 fallback
  const ratio = h > 0 ? w / h : 4 / 3;
  return {
    widthEmu: Math.round(ratio * TARGET_HEIGHT_EMU),
    heightEmu: TARGET_HEIGHT_EMU,
  };
}

// ── MIME type helpers ────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};

function extToMime(ext: string): string {
  return EXT_TO_MIME[ext] ?? "image/jpeg";
}

// ── XML builders ─────────────────────────────────────────────────────────────

/**
 * Builds a single `<w:p>` containing an inline drawing for one image.
 * `rId` is the relationship ID in document.xml.rels (e.g. "rId5").
 * `idx` is a unique integer used for docPr id / name attributes.
 */
function buildImageParagraphXml(
  rId: string,
  widthEmu: number,
  heightEmu: number,
  idx: number
): string {
  const name = `Image${idx}`;
  return (
    `<w:p>` +
    `<w:r>` +
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${idx}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="${idx}" name="${name}"/>` +
    `<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${rId}" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
    `<a:srcRect/><a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr bwMode="auto">` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>` +
    `</w:r>` +
    `</w:p>`
  );
}

/** Relationship entry XML for one image. */
function buildImageRelXml(rId: string, mediaPath: string): string {
  return (
    `<Relationship Id="${rId}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
    `Target="${mediaPath}"/>`
  );
}

// ── Max rId extraction ────────────────────────────────────────────────────────

/**
 * Finds the maximum numeric suffix in existing `Id="rId<N>"` attributes
 * so that new relationships don't collide.
 */
function maxRId(relsXml: string): number {
  let max = 0;
  const re = /Id="rId(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max;
}

// ── Content-Types helpers ─────────────────────────────────────────────────────

/**
 * Ensures all required image MIME types appear as `<Default>` entries
 * in `[Content_Types].xml`.  Word requires them; without them the file
 * won't open.
 */
function ensureImageContentTypes(
  contentTypesXml: string,
  exts: Set<string>
): string {
  const EXT_MIME: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
  };

  let xml = contentTypesXml;
  exts.forEach((ext) => {
    const mime = EXT_MIME[ext];
    if (!mime) return;
    if (!xml.includes(`Extension="${ext}"`)) {
      xml = xml.replace(
        "</Types>",
        `<Default Extension="${ext}" ContentType="${mime}"/></Types>`
      );
    }
  });
  return xml;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a .docx buffer containing all supplied photos as inline images.
 *
 * @param photos       Array of photo entries (buffer + ext + name).
 * @param templateBuf  Optional buffer of an existing .docx whose header /
 *                     footer / section properties should be preserved.
 * @returns            A Buffer containing the final .docx file.
 */
export async function buildPhotosDocx(
  photos: PhotoEntry[],
  templateBuf?: Buffer
): Promise<Buffer> {
  if (photos.length === 0) throw new Error("No photos provided");

  if (templateBuf) {
    return buildFromTemplate(photos, templateBuf);
  }
  return buildFromScratch(photos);
}

// ── Build from template ───────────────────────────────────────────────────────

async function buildFromTemplate(
  photos: PhotoEntry[],
  templateBuf: Buffer
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuf);

  // ── document.xml ──────────────────────────────────────────────────────────
  const docXmlRaw = await zip.file("word/document.xml")?.async("string");
  if (!docXmlRaw) throw new Error("Template has no word/document.xml");

  // ── document.xml.rels ─────────────────────────────────────────────────────
  const relsPath = "word/_rels/document.xml.rels";
  const existingRelsXml =
    (await zip.file(relsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

  let nextRId = maxRId(existingRelsXml) + 1;

  // ── Build new relationships + image paragraphs ────────────────────────────
  const imageParagraphs: string[] = [];
  const newRels: string[] = [];
  const usedExts = new Set<string>();

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const rId = `rId${nextRId++}`;
    const mediaName = `photoImg${nextRId - 1}.${photo.ext}`;
    const { widthEmu, heightEmu } = getImageDimensions(photo.buffer, photo.ext);

    zip.file(`word/media/${mediaName}`, photo.buffer);
    imageParagraphs.push(
      buildImageParagraphXml(rId, widthEmu, heightEmu, i + 1)
    );
    newRels.push(buildImageRelXml(rId, `media/${mediaName}`));
    usedExts.add(photo.ext);
  }

  // ── Inject image paragraphs into body (before sectPr) ────────────────────
  const bodyOpenMatch = docXmlRaw.match(/<w:body>/);
  const bodyCloseMatch = docXmlRaw.match(/<\/w:body>/);
  const sectPrMatch = docXmlRaw.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);

  if (!bodyOpenMatch || !bodyCloseMatch) {
    throw new Error("Template document.xml has unexpected structure");
  }

  const sectPr = sectPrMatch ? sectPrMatch[0] : "<w:sectPr/>";
  const beforeBody = docXmlRaw.slice(
    0,
    (bodyOpenMatch.index ?? 0) + "<w:body>".length
  );
  const afterBody = `</w:body>${docXmlRaw.slice(
    (bodyCloseMatch.index ?? 0) + "</w:body>".length
  )}`;

  const newDocXml =
    beforeBody +
    imageParagraphs.join("") +
    sectPr +
    afterBody;

  zip.file("word/document.xml", newDocXml);

  // ── Update relationships ──────────────────────────────────────────────────
  const updatedRels = existingRelsXml.replace(
    "</Relationships>",
    newRels.join("") + "</Relationships>"
  );
  zip.file(relsPath, updatedRels);

  // ── Update [Content_Types].xml ────────────────────────────────────────────
  const ctPath = "[Content_Types].xml";
  const ctXml = (await zip.file(ctPath)?.async("string")) ?? "";
  zip.file(ctPath, ensureImageContentTypes(ctXml, usedExts));

  return zip.generateAsync({ type: "nodebuffer" });
}

// ── Build from scratch ────────────────────────────────────────────────────────

async function buildFromScratch(photos: PhotoEntry[]): Promise<Buffer> {
  const zip = new JSZip();

  // ── _rels/.rels ───────────────────────────────────────────────────────────
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" ` +
      `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ` +
      `Target="word/document.xml"/>` +
      `</Relationships>`
  );

  // ── word/_rels/document.xml.rels ──────────────────────────────────────────
  const imageParagraphs: string[] = [];
  const imageRels: string[] = [];
  const usedExts = new Set<string>();

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const rId = `rId${i + 1}`;
    const mediaName = `image${i + 1}.${photo.ext}`;
    const { widthEmu, heightEmu } = getImageDimensions(photo.buffer, photo.ext);

    zip.file(`word/media/${mediaName}`, photo.buffer);
    imageParagraphs.push(
      buildImageParagraphXml(rId, widthEmu, heightEmu, i + 1)
    );
    imageRels.push(buildImageRelXml(rId, `media/${mediaName}`));
    usedExts.add(photo.ext);
  }

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      imageRels.join("") +
      `</Relationships>`
  );

  // ── word/document.xml ─────────────────────────────────────────────────────
  const docXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document ` +
    `xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ` +
    `mc:Ignorable="w14" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
    `<w:body>` +
    imageParagraphs.join("") +
    `<w:sectPr/>` +
    `</w:body>` +
    `</w:document>`;

  zip.file("word/document.xml", docXml);

  // ── [Content_Types].xml ───────────────────────────────────────────────────
  const extEntries: string[] = [];
  usedExts.forEach((ext) => {
    extEntries.push(`<Default Extension="${ext}" ContentType="${extToMime(ext)}"/>`);
  });

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ` +
      `ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      extEntries +
      `</Types>`
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

// ── File-type helpers (for use in routes) ────────────────────────────────────

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);

/** Returns the lowercase extension (without dot) of a filename. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Returns true if the file is an embeddable image. */
export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTS.has(fileExtension(fileName));
}

/** Returns true if the file is a PDF. */
export function isPdfFile(fileName: string): boolean {
  return fileExtension(fileName) === "pdf";
}

// ── Build photos table docx (using docx library) ──────────────────────────────

/**
 * Builds a .docx buffer containing photos in a 2-column table with descriptions.
 * @param photos       Array of photos with descriptions
 * @param templateBuf  Optional template buffer to preserve header/footer
 * @returns            A Buffer containing the final .docx file
 */
export async function buildPhotosTableDocx(
  photos: PhotoWithDescription[],
  templateBuf?: Buffer
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const docx = require("docx");
  const { Document, Packer, Table, TableRow, WidthType, convertInchesToTwip } = docx;

  if (photos.length === 0) throw new Error("No photos provided");

  // Create table rows with images and descriptions
  const tableRows: typeof TableRow[] = [];

  for (let i = 0; i < photos.length; i += 2) {
    const photo1 = photos[i];
    const photo2 = photos[i + 1];

    // ── Image row ──────────────────────────────────────────────────────────
    const imageRow = new TableRow({
      height: { value: 3402, rule: "exact" },
      children: [
        createImageCell(photo1.buffer, photo1.ext),
        photo2 ? createImageCell(photo2.buffer, photo2.ext) : createEmptyImageCell(),
      ],
    });

    // ── Description row ────────────────────────────────────────────────────
    const descriptionRow = new TableRow({
      height: { value: 70, rule: "exact" },
      children: [
        createDescriptionCell(photo1.description),
        photo2 ? createDescriptionCell(photo2.description) : createEmptyDescriptionCell(),
      ],
    });

    tableRows.push(imageRow);
    tableRows.push(descriptionRow);
  }

  // Create table
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  });

  // Build document sections
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections: any[] = [];

  // If template exists, extract and use its structure
  if (templateBuf) {
    try {
      const zip = await JSZip.loadAsync(templateBuf);
      const docXmlRaw = await zip.file("word/document.xml")?.async("string");

      if (docXmlRaw) {
        // Parse template to preserve header/footer info (for future use)

        // For now, we'll create a new document with the table
        // preserving the template's styling context
        sections.push({
          children: [table],
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(0.62), // 1.58cm
                bottom: convertInchesToTwip(0.54), // 1.38cm
                left: convertInchesToTwip(0.46), // 1.18cm
                right: convertInchesToTwip(0.39), // 0.98cm
              },
            },
          },
        });
      }
    } catch (err) {
      console.error("Failed to process template, creating from scratch:", err);
      sections.push({
        children: [table],
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.62),
              bottom: convertInchesToTwip(0.54),
              left: convertInchesToTwip(0.46),
              right: convertInchesToTwip(0.39),
            },
          },
        },
      });
    }
  } else {
    // Create from scratch
    sections.push({
      children: [table],
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.62),
            bottom: convertInchesToTwip(0.54),
            left: convertInchesToTwip(0.46),
            right: convertInchesToTwip(0.39),
          },
        },
      },
    });
  }

  const doc = new Document({ sections });
  return Packer.toBuffer(doc);
}

/**
 * Creates a table cell with an image (centered, with proper spacing)
 */
function createImageCell(
  buffer: Buffer,
  ext: string
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { TableCell, Paragraph, ImageRun, AlignmentType, VerticalAlign, BorderStyle } = require("docx");

  // Get original dimensions and scale to ~2.9 inches wide (209px at 72dpi)
  const { widthEmu, heightEmu } = getImageDimensions(buffer, ext);
  const IMG_W_PX = 209; // ≈ 2.9 inches at 72 dpi
  const IMG_H_PX = Math.round((heightEmu / widthEmu) * IMG_W_PX);
  // docx type is the extension without "image/" prefix
  const docxType = ext === "jpg" ? "jpeg" : ext;

  return new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: buffer,
            type: docxType,
            transformation: { width: IMG_W_PX, height: IMG_H_PX },
          }),
        ],
      }),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
    },
    verticalAlign: VerticalAlign.CENTER,
  });
}

/**
 * Creates an empty image cell (for odd number of photos)
 */
function createEmptyImageCell() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { TableCell, Paragraph, BorderStyle, VerticalAlign } = require("docx");

  return new TableCell({
    children: [new Paragraph("")],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
    },
    verticalAlign: VerticalAlign.CENTER,
  });
}

/**
 * Creates a description cell
 */
function createDescriptionCell(description: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { TableCell, Paragraph, TextRun, AlignmentType, VerticalAlign, BorderStyle } = require("docx");

  return new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        verticalAlignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: description,
            font: "Arial",
            size: 20, // 10pt in half-points
          }),
        ],
      }),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
    },
    verticalAlign: VerticalAlign.CENTER,
  });
}

/**
 * Creates an empty description cell (for odd number of photos)
 */
function createEmptyDescriptionCell() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { TableCell, Paragraph, BorderStyle, VerticalAlign } = require("docx");

  return new TableCell({
    children: [new Paragraph("")],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
    },
    verticalAlign: VerticalAlign.CENTER,
  });
}
