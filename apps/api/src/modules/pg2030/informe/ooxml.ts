/**
 * WordprocessingML for the PG2030 report: splitting the template's body,
 * rewriting text inside its paragraphs, and building new paragraphs, tables,
 * images and the table of contents with the template's own formatting.
 *
 * The XML is handled as text. That is safe here because the template is ours
 * (no CDATA, comments or processing instructions inside the body) and every
 * value we insert goes through `esc`.
 */

export function esc(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function desesc(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The top-level children of `<w:body>`, each as its own XML string. */
export function dividirCuerpo(documento: string): { inicio: string; elementos: string[]; fin: string } {
  const a = documento.indexOf("<w:body>");
  const b = documento.lastIndexOf("</w:body>");
  if (a < 0 || b < 0) throw new Error("Plantilla sin <w:body>");
  const cuerpo = documento.slice(a + "<w:body>".length, b);
  const elementos: string[] = [];
  const etiqueta = /<(\/?)(w:[A-Za-z]+)\b[^>]*?(\/?)>/g;
  let profundidad = 0;
  let inicio = 0;
  let actual = "";
  for (let m = etiqueta.exec(cuerpo); m; m = etiqueta.exec(cuerpo)) {
    const [, cierre, nombre, autocierre] = m;
    if (profundidad === 0) {
      if (cierre) throw new Error(`Plantilla: cierre inesperado </${nombre}>`);
      inicio = m.index;
      actual = nombre;
      if (autocierre) elementos.push(cuerpo.slice(inicio, m.index + m[0].length));
      else profundidad = 1;
      continue;
    }
    if (nombre !== actual) continue;
    if (cierre) {
      profundidad -= 1;
      if (profundidad === 0) elementos.push(cuerpo.slice(inicio, m.index + m[0].length));
    } else if (!autocierre) profundidad += 1;
  }
  return { inicio: documento.slice(0, a + "<w:body>".length), elementos, fin: documento.slice(b) };
}

/** The visible text of a fragment (tabs as spaces). */
export function textoDe(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)) out += m[1] === undefined ? " " : desesc(m[1]);
  return out;
}

/**
 * Bookmarks other than the heading's own `_Toc…` pair, revision marks and
 * render hints: a reused paragraph must not carry half of a bookmark whose
 * other half stayed in a paragraph we dropped.
 */
export function limpiar(xml: string): string {
  const inicios = new Map<string, string>();
  for (const m of xml.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]*)"\/>/g)) inicios.set(m[1], m[2]);
  const ids = new Set([...xml.matchAll(/<w:bookmarkEnd w:id="(\d+)"\/>/g)].map((m) => m[1]));
  const conservar = (id: string) => ids.has(id) && inicios.has(id) && inicios.get(id)!.startsWith("_Toc");
  return xml
    .replace(/<w:bookmarkStart w:id="(\d+)" w:name="[^"]*"\/>/g, (todo, id) => (conservar(id) ? todo : ""))
    .replace(/<w:bookmarkEnd w:id="(\d+)"\/>/g, (todo, id) => (conservar(id) ? todo : ""))
    .replace(/<w:proofErr [^>]*\/>/g, "")
    .replace(/<w:lastRenderedPageBreak\/>/g, "")
    .replace(/ w14:paraId="[0-9A-F]+"| w14:textId="[0-9A-F]+"/g, "");
}

/**
 * Replace `buscar` (as it reads, even when Word split it across runs) with
 * `reemplazo`, which takes the formatting of the run where the match starts.
 * Throws when the text is missing: the template changed and its positions in
 * documento.ts need a look.
 */
export function reemplazar(xml: string, buscar: string | RegExp, reemplazo: string): string {
  const nodos = [...xml.matchAll(/(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g)];
  const textos = nodos.map((m) => desesc(m[2]));
  const completo = textos.join("");
  // A pattern lets the code find the template's own numbers (report, memos)
  // without writing them here: the repository is public.
  const hallado = typeof buscar === "string" ? { index: completo.indexOf(buscar), largo: buscar.length } : (() => {
    const m = completo.match(buscar);
    return m ? { index: m.index!, largo: m[0].length } : { index: -1, largo: 0 };
  })();
  if (hallado.index < 0) throw new Error(`Plantilla del informe: no se encontró «${buscar}»`);
  const desde = hallado.index;
  const hasta = desde + hallado.largo;

  const nuevos = [...textos];
  let pos = 0;
  let puesto = false;
  for (let i = 0; i < textos.length; i++) {
    const a = pos;
    const b = pos + textos[i].length;
    pos = b;
    if (b <= desde || a >= hasta) continue;
    const antes = textos[i].slice(0, Math.max(0, desde - a));
    const despues = textos[i].slice(Math.max(0, hasta - a));
    nuevos[i] = antes + (puesto ? "" : reemplazo) + despues;
    puesto = true;
  }

  let out = "";
  let ultimo = 0;
  nodos.forEach((m, i) => {
    out += xml.slice(ultimo, m.index!);
    out += nuevos[i] === textos[i] ? m[0] : `<w:t xml:space="preserve">${esc(nuevos[i])}</w:t>`;
    ultimo = m.index! + m[0].length;
  });
  return out + xml.slice(ultimo);
}

/** The whole text of a paragraph replaced, in the format of its first run. */
export function reemplazarTodo(xml: string, texto: string): string {
  return reemplazar(xml, textoDe(xml), texto);
}

/** `<w:pPr>…</w:pPr>` of a template paragraph. */
export function pPrDe(parrafo: string): string {
  const m = parrafo.match(/^<w:p\b[^>]*>(<w:pPr>.*?<\/w:pPr>)/s);
  return m ? m[1] : "";
}

/** `<w:rPr>…</w:rPr>` of the first run with text in a template paragraph. */
export function rPrDe(parrafo: string): string {
  const m = parrafo.match(/<w:r\b[^>]*>(<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?(?:(?!<\/w:r>).)*?<w:t[ >]/s);
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Runs

/**
 * A piece of a paragraph: plain text, text with bold/italic/color, a colored
 * traffic-light dot, a line break, or a ready-made run (an inline picture).
 */
export type Trozo =
  | string
  | { t: string; b?: boolean; i?: boolean; color?: string }
  | { punto: string }
  | { salto: true }
  | { xml: string };

/**
 * `**negrita**` inside our own sentences becomes a bold piece. The texts of
 * the report are written with it so they read naturally in code.
 */
export function marcado(texto: string): Trozo[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/)
    .filter((s) => s !== "")
    .map((s) => (s.startsWith("**") && s.endsWith("**") ? { t: s.slice(2, -2), b: true } : s));
}

export function sinMarcado(texto: string): string {
  return texto.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** Insert `fragmento` right after the first anchor found (else first thing in the rPr). */
function insertarTras(rPr: string, anclas: RegExp[], fragmento: string): string {
  for (const ancla of anclas) {
    const m = rPr.match(ancla);
    if (m) {
      const i = m.index! + m[0].length;
      return rPr.slice(0, i) + fragmento + rPr.slice(i);
    }
  }
  return rPr.replace("<w:rPr>", `<w:rPr>${fragmento}`);
}

/** Insert `fragmento` right before the first anchor found (else last thing in the rPr). */
function insertarAntes(rPr: string, anclas: RegExp[], fragmento: string): string {
  for (const ancla of anclas) {
    const m = rPr.match(ancla);
    if (m) return rPr.slice(0, m.index!) + fragmento + rPr.slice(m.index!);
  }
  return rPr.replace("</w:rPr>", `${fragmento}</w:rPr>`);
}

/** A template rPr with bold, italic or a color added, keeping the schema's child order. */
function variante(rPr: string, { b, i, color }: { b?: boolean; i?: boolean; color?: string }): string {
  let r = rPr || "<w:rPr></w:rPr>";
  if (b && !r.includes("<w:b/>")) r = insertarTras(r, [/<w:rFonts [^>]*\/>/, /<w:rStyle [^>]*\/>/], "<w:b/><w:bCs/>");
  if (i && !r.includes("<w:i/>")) r = insertarTras(r, [/<w:bCs\/>/, /<w:b\/>/, /<w:rFonts [^>]*\/>/, /<w:rStyle [^>]*\/>/], "<w:i/><w:iCs/>");
  if (color) {
    r = r.replace(/<w:color [^>]*\/>/, "");
    r = insertarAntes(r, [/<w:spacing /, /<w:w /, /<w:kern /, /<w:position /, /<w:sz /, /<w:szCs /, /<w:highlight /, /<w:u /, /<w:lang /], `<w:color w:val="${color}"/>`);
  }
  return r;
}

export function runs(trozos: Trozo[], rPr: string): string {
  return trozos
    .map((t) => {
      if (typeof t === "string") return `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
      if ("punto" in t) return `<w:r>${variante(rPr, { color: t.punto })}<w:t xml:space="preserve">●</w:t></w:r>`;
      if ("salto" in t) return `<w:r>${rPr}<w:br/></w:r>`;
      if ("xml" in t) return t.xml;
      return `<w:r>${variante(rPr, t)}<w:t xml:space="preserve">${esc(t.t)}</w:t></w:r>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Paragraphs

/** Body text exactly as the template's analysis paragraphs. */
export const PPR_CUERPO =
  '<w:pPr><w:spacing w:line="276" w:lineRule="auto"/><w:jc w:val="both"/><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>';
export const RPR_CUERPO =
  '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';

export function parrafo(trozos: Trozo[] | string, pPr = PPR_CUERPO, rPr = RPR_CUERPO): string {
  const t = typeof trozos === "string" ? marcado(trozos) : trozos;
  return `<w:p>${pPr}${runs(t, rPr)}</w:p>`;
}

export function vacio(pPr = PPR_CUERPO): string {
  return `<w:p>${pPr}</w:p>`;
}

/** The paragraph starting a new page (`pageBreakBefore`, after pStyle/keepNext/keepLines). */
export function conSaltoAntes(parrafo: string): string {
  if (parrafo.includes("<w:pageBreakBefore")) return parrafo;
  if (!/^<w:p\b[^>]*><w:pPr>/.test(parrafo)) return parrafo.replace(/^(<w:p\b[^>]*>)/, "$1<w:pPr><w:pageBreakBefore/></w:pPr>");
  return parrafo.replace(
    /^(<w:p\b[^>]*><w:pPr>(?:<w:pStyle [^>]*\/>)?(?:<w:keepNext\/>)?(?:<w:keepLines\/>)?)/,
    "$1<w:pageBreakBefore/>",
  );
}

let siguienteMarcador = 9000;

/** A heading paragraph (pPr from the template) wrapped in a fresh `_Toc` bookmark. */
export function titulo(texto: string, pPr: string, rPr: string): { xml: string; ancla: string } {
  const id = siguienteMarcador++;
  const ancla = `_TocPG${id}`;
  return {
    ancla,
    xml: `<w:p>${pPr}<w:bookmarkStart w:id="${id}" w:name="${ancla}"/>${runs([texto], rPr)}<w:bookmarkEnd w:id="${id}"/></w:p>`,
  };
}

/** The `_Toc` bookmark a template heading already carries. */
export function anclaDe(parrafo: string): string {
  const m = parrafo.match(/<w:bookmarkStart w:id="\d+" w:name="(_Toc\d+)"\/>/g);
  if (!m) throw new Error(`Plantilla: el título «${textoDe(parrafo)}» no tiene marcador`);
  // The last one: Word stacks old bookmarks first.
  return m[m.length - 1].match(/w:name="(_Toc\d+)"/)![1];
}

/** "Tabla 3: …" / "Gráfico 1: …" with a SEQ field, as the template's captions. */
export function leyenda(tipo: "Tabla" | "Gráfico", numero: number, texto: string): string {
  const b = '<w:rPr><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  const n = '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  return (
    '<w:p><w:pPr><w:pStyle w:val="Descripcin"/><w:keepNext/><w:spacing w:before="0"/><w:jc w:val="center"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>' +
    `<w:r>${b}<w:t xml:space="preserve">${tipo} </w:t></w:r>` +
    `<w:r>${b}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${b}<w:instrText xml:space="preserve"> SEQ ${tipo} \\* ARABIC </w:instrText></w:r>` +
    `<w:r>${b}<w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r>${b.replace("<w:bCs/>", "<w:bCs/><w:noProof/>")}<w:t>${numero}</w:t></w:r>` +
    `<w:r>${b}<w:fldChar w:fldCharType="end"/></w:r>` +
    `<w:r>${b}<w:t xml:space="preserve">: </w:t></w:r>` +
    `<w:r>${n}<w:t>${esc(texto)}</w:t></w:r></w:p>`
  );
}

/** The "Fuente:" and "Elaboración:" lines under every table and chart. */
export function fuente(anio: number): string {
  const pPr = '<w:pPr><w:spacing w:line="276" w:lineRule="auto"/><w:jc w:val="both"/><w:rPr><w:rFonts w:cs="Calibri"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>';
  const rPr = '<w:rPr><w:rFonts w:cs="Calibri"/><w:i/><w:iCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  return (
    parrafo([{ t: "Fuente:", b: true }, ` Información reportada en la matriz de Evaluación del Plan Galápagos, ${anio}.`], pPr, rPr) +
    parrafo([{ t: "Elaboración:", b: true }, " Dirección de Gestión de Territorio, Ambiente y Riesgos del CGREG."], pPr, rPr)
  );
}

// ---------------------------------------------------------------------------
// Tables, in the template's style: blue header, thin borders, grey total row.

export type Celda = Trozo[] | string;
export type Columna = { titulo: string; ancho: number; alinear?: "left" | "center" | "right"; vertical?: boolean };

const AZUL = "4472C4";
const GRIS = "D9D9D9";

function celda(contenido: Celda, ancho: number, opciones: {
  sz: number;
  alinear: "left" | "center" | "right";
  fondo?: string;
  negrita?: boolean;
  blanco?: boolean;
  vertical?: boolean;
}): string {
  const { sz, alinear, fondo, negrita, blanco, vertical } = opciones;
  const rPr =
    `<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsia="Times New Roman" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>${negrita ? "<w:b/><w:bCs/>" : ""}` +
    `<w:color w:val="${blanco ? "FFFFFF" : "000000"}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:eastAsia="es-EC"/></w:rPr>`;
  const tcPr =
    `<w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fondo}"/>` : ""}` +
    `${vertical ? '<w:textDirection w:val="btLr"/>' : ""}<w:vAlign w:val="center"/></w:tcPr>`;
  const pPr = `<w:pPr><w:suppressAutoHyphens w:val="0"/>${vertical ? '<w:ind w:left="113" w:right="113"/>' : ""}<w:jc w:val="${alinear}"/>${rPr}</w:pPr>`;
  const trozos = typeof contenido === "string" ? marcado(contenido) : contenido;
  return `<w:tc>${tcPr}<w:p>${pPr}${runs(trozos, rPr)}</w:p></w:tc>`;
}

/** A centered table: header row, body rows and an optional total row. */
export function tabla(columnas: Columna[], filas: Celda[][], total?: Celda[], { sz = 20, altoEncabezado }: { sz?: number; altoEncabezado?: number } = {}): string {
  const ancho = columnas.reduce((s, c) => s + c.ancho, 0);
  const borde = (lado: string) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  const tblPr =
    `<w:tblPr><w:tblW w:w="${ancho}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(borde).join("")}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>';
  const grid = `<w:tblGrid>${columnas.map((c) => `<w:gridCol w:w="${c.ancho}"/>`).join("")}</w:tblGrid>`;
  const encabezado =
    `<w:tr><w:trPr>${altoEncabezado ? `<w:trHeight w:val="${altoEncabezado}"/>` : ""}<w:tblHeader/><w:jc w:val="center"/></w:trPr>` +
    columnas.map((c) => celda(c.titulo, c.ancho, { sz, alinear: "center", fondo: AZUL, negrita: true, blanco: true, vertical: c.vertical })).join("") +
    "</w:tr>";
  const fila = (valores: Celda[], esTotal: boolean) =>
    '<w:tr><w:trPr><w:cantSplit/><w:jc w:val="center"/></w:trPr>' +
    columnas
      .map((c, i) => celda(valores[i] ?? "", c.ancho, { sz, alinear: c.alinear ?? "left", fondo: esTotal ? GRIS : undefined, negrita: esTotal }))
      .join("") +
    "</w:tr>";
  return `<w:tbl>${tblPr}${grid}${encabezado}${filas.map((f) => fila(f, false)).join("")}${total ? fila(total, true) : ""}</w:tbl>`;
}

// ---------------------------------------------------------------------------
// Images

const EMU_POR_CM = 360000;
let siguienteDibujo = 5000;

/** Pixel size of a PNG, from its IHDR chunk. */
export function tamanoPng(png: Buffer): { ancho: number; alto: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("La imagen no es un PNG válido");
  }
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

/** An inline picture of `anchoCm` (height from the aspect ratio, capped at `altoMaxCm`). */
export function imagen(rId: string, px: { ancho: number; alto: number }, anchoCm: number, altoMaxCm = 13): string {
  let cx = Math.round(anchoCm * EMU_POR_CM);
  let cy = Math.round((cx * px.alto) / px.ancho);
  const max = Math.round(altoMaxCm * EMU_POR_CM);
  if (cy > max) {
    cx = Math.round((cx * max) / cy);
    cy = max;
  }
  const id = siguienteDibujo++;
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Imagen ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Imagen ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"
  );
}

export function parrafoImagen(run: string): string {
  return `<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/><w:jc w:val="center"/></w:pPr>${run}</w:p>`;
}

// ---------------------------------------------------------------------------
// Table of contents

export type EntradaIndice = { nivel: 1 | 2; numero?: string; texto: string; ancla: string };

/**
 * The TOC field with one cached line per heading. Page numbers are left empty:
 * Word recomputes the whole field when it opens the file (settings.xml gets
 * `updateFields`), so a stale guess would be worse than a blank.
 */
export function indice(sdtOriginal: string, entradas: EntradaIndice[]): string {
  const apertura = sdtOriginal.match(/^<w:sdt>.*?<w:sdtContent>/s)![0];
  const parrafos = [...sdtOriginal.matchAll(/<w:p\b[^>]*>.*?<\/w:p>/gs)].map((m) => m[0]);
  const [tituloContenido, separador] = parrafos;
  const rPrHip = '<w:rPr><w:rStyle w:val="Hipervnculo"/><w:noProof/></w:rPr>';
  const rPrTab = '<w:rPr><w:noProof/><w:webHidden/></w:rPr>';
  const pPrEntrada = (e: EntradaIndice) => {
    const izquierda = e.nivel === 2 ? 660 : e.numero && e.numero.length > 2 ? 660 : 480;
    const tabs = e.numero
      ? `<w:tab w:val="left" w:pos="${izquierda}"/><w:tab w:val="right" w:leader="dot" w:pos="8494"/>`
      : '<w:tab w:val="right" w:leader="dot" w:pos="8494"/>';
    return `<w:pPr><w:pStyle w:val="TDC${e.nivel}"/><w:tabs>${tabs}</w:tabs><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:noProof/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:eastAsia="es-EC"/></w:rPr></w:pPr>`;
  };
  const rFld = '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/></w:rPr>';
  const lineas = entradas.map((e, i) => {
    const campo =
      i === 0
        ? `<w:r>${rFld}<w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r>${rFld}<w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r>${rFld}<w:fldChar w:fldCharType="separate"/></w:r>`
        : "";
    const numero = e.numero ? `<w:r>${rPrHip}<w:t>${esc(e.numero)}</w:t></w:r><w:r>${rPrTab}<w:tab/></w:r>` : "";
    return (
      `<w:p>${pPrEntrada(e)}${campo}<w:hyperlink w:anchor="${e.ancla}" w:history="1">${numero}<w:r>${rPrHip}<w:t>${esc(e.texto)}</w:t></w:r>` +
      `<w:r>${rPrTab}<w:tab/></w:r><w:r>${rPrTab}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPrTab}<w:instrText xml:space="preserve"> PAGEREF ${e.ancla} \\h </w:instrText></w:r>` +
      `<w:r>${rPrTab}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPrTab}<w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>`
    );
  });
  const cierre = `<w:p>${PPR_CUERPO}<w:r>${rFld}<w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  return `${apertura}${limpiar(tituloContenido)}${limpiar(separador)}${lineas.join("")}${cierre}</w:sdtContent></w:sdt>`;
}

/** settings.xml with `updateFields`, in its schema position (before hdrShapeDefaults/footnotePr/compat). */
export function conActualizarCampos(settings: string): string {
  if (settings.includes("<w:updateFields")) return settings;
  for (const antes of ["<w:hdrShapeDefaults", "<w:footnotePr", "<w:endnotePr", "<w:compat>", "<w:compat/>", "<w:rsids>"]) {
    const i = settings.indexOf(antes);
    if (i >= 0) return `${settings.slice(0, i)}<w:updateFields w:val="true"/>${settings.slice(i)}`;
  }
  return settings.replace("</w:settings>", '<w:updateFields w:val="true"/></w:settings>');
}
