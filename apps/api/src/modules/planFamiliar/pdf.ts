import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { FamilyEmergencyPlanInput } from "./model.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEAL = rgb(0.055, 0.38, 0.35);
const BLUE = rgb(0.12, 0.33, 0.58);
const LIGHT = rgb(0.94, 0.97, 0.96);
const INK = rgb(0.12, 0.18, 0.2);
const MUTED = rgb(0.36, 0.43, 0.45);

type Writer = {
  doc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  pageNumber: number;
  code: string;
};

function safeText(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function splitLongToken(token: string, font: PDFFont, size: number, width: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const character of token) {
    if (current && font.widthOfTextAtSize(current + character, size) > width) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrap(value: unknown, font: PDFFont, size: number, width: number): string[] {
  const text = safeText(value);
  if (!text) return ["—"];
  const output: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    const words = paragraph.split(/\s+/).flatMap((word) =>
      font.widthOfTextAtSize(word, size) <= width ? [word] : splitLongToken(word, font, size, width)
    );
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        output.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) output.push(line);
  }
  return output.length ? output : ["—"];
}

function drawHeader(writer: Writer) {
  writer.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 76, width: PAGE_WIDTH, height: 76, color: TEAL });
  writer.page.drawText("CGREG · DGTAR", { x: MARGIN, y: PAGE_HEIGHT - 30, size: 9, font: writer.bold, color: rgb(1, 1, 1) });
  writer.page.drawText("PLAN FAMILIAR DE EMERGENCIA", { x: MARGIN, y: PAGE_HEIGHT - 53, size: 16, font: writer.bold, color: rgb(1, 1, 1) });
  writer.page.drawText(`Código ${writer.code}`, { x: PAGE_WIDTH - 150, y: PAGE_HEIGHT - 45, size: 9, font: writer.regular, color: rgb(1, 1, 1) });
}

function drawFooter(writer: Writer) {
  writer.page.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.6, color: TEAL });
  writer.page.drawText("Escuche fuentes oficiales. En una emergencia llame al ECU 911.", {
    x: MARGIN,
    y: 23,
    size: 8,
    font: writer.regular,
    color: MUTED,
  });
  writer.page.drawText(`Página ${writer.pageNumber}`, { x: PAGE_WIDTH - 90, y: 23, size: 8, font: writer.regular, color: MUTED });
}

function newPage(writer: Writer): void {
  if (writer.pageNumber > 0) drawFooter(writer);
  writer.page = writer.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  writer.pageNumber += 1;
  drawHeader(writer);
  writer.y = PAGE_HEIGHT - 102;
}

function ensure(writer: Writer, height: number): void {
  if (writer.y - height < 56) newPage(writer);
}

function section(writer: Writer, number: number, title: string): void {
  ensure(writer, 48);
  writer.page.drawRectangle({ x: MARGIN, y: writer.y - 31, width: CONTENT_WIDTH, height: 34, color: LIGHT });
  writer.page.drawCircle({ x: MARGIN + 18, y: writer.y - 14, size: 12, color: TEAL });
  writer.page.drawText(String(number), { x: MARGIN + 14.5, y: writer.y - 18, size: 10, font: writer.bold, color: rgb(1, 1, 1) });
  writer.page.drawText(title, { x: MARGIN + 39, y: writer.y - 20, size: 13, font: writer.bold, color: BLUE });
  writer.y -= 45;
}

function field(writer: Writer, label: string, value: unknown): void {
  const labelLines = wrap(label, writer.bold, 8, CONTENT_WIDTH);
  const valueLines = wrap(value, writer.regular, 9.5, CONTENT_WIDTH - 12);
  const height = labelLines.length * 10 + valueLines.length * 12 + 13;
  ensure(writer, height);
  writer.page.drawText(labelLines[0], { x: MARGIN, y: writer.y, size: 8, font: writer.bold, color: MUTED });
  writer.y -= labelLines.length * 10 + 2;
  writer.page.drawRectangle({ x: MARGIN, y: writer.y - valueLines.length * 12 - 4, width: CONTENT_WIDTH, height: valueLines.length * 12 + 9, borderColor: rgb(0.78, 0.84, 0.83), borderWidth: 0.6 });
  valueLines.forEach((line, index) => writer.page.drawText(line, {
    x: MARGIN + 6,
    y: writer.y - index * 12,
    size: 9.5,
    font: writer.regular,
    color: INK,
  }));
  writer.y -= valueLines.length * 12 + 14;
}

function item(writer: Writer, heading: string, details: string[]): void {
  const lines = details.flatMap((detail) => wrap(detail, writer.regular, 8.5, CONTENT_WIDTH - 24));
  const height = 22 + lines.length * 10;
  ensure(writer, height);
  writer.page.drawText(heading, { x: MARGIN + 4, y: writer.y, size: 9.5, font: writer.bold, color: TEAL });
  writer.y -= 13;
  lines.forEach((line) => {
    writer.page.drawText(line, { x: MARGIN + 12, y: writer.y, size: 8.5, font: writer.regular, color: INK });
    writer.y -= 10;
  });
  writer.y -= 8;
}

async function drawJpeg(writer: Writer, label: string, dataUrl: string): Promise<void> {
  if (!dataUrl) {
    field(writer, label, "No se adjuntó una imagen.");
    return;
  }
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const image = await writer.doc.embedJpg(bytes);
  const maxHeight = 360;
  const scale = Math.min(CONTENT_WIDTH / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ensure(writer, height + 28);
  writer.page.drawText(label, { x: MARGIN, y: writer.y, size: 9, font: writer.bold, color: MUTED });
  writer.y -= 15;
  writer.page.drawImage(image, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: writer.y - height, width, height });
  writer.y -= height + 14;
}

export async function createFamilyPlanPdf(
  plan: FamilyEmergencyPlanInput,
  id: string,
  createdAt: Date,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer: Writer = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: 0,
    pageNumber: 0,
    code: id.slice(0, 8).toUpperCase(),
  };
  doc.removePage(0);
  newPage(writer);

  section(writer, 1, "Datos y acuerdos principales");
  field(writer, "Familia", plan.family);
  field(writer, "Fecha de elaboración", plan.date);
  field(writer, "Isla · sector", `${plan.island} · ${plan.sector}`);
  field(writer, "Dirección", plan.address);
  field(writer, "Teléfonos", [plan.phone, plan.altPhone].filter(Boolean).join(" · "));
  field(writer, "Contacto fuera de la zona", `${plan.contact} · ${plan.contactPhone}`);
  field(writer, "Punto de encuentro", plan.meeting);
  field(writer, "Acuerdo si no hay señal", plan.noSignal);
  field(writer, "Revisión y responsable", `${plan.reviewDate || "Sin fecha"} · ${plan.updater}`);

  section(writer, 2, "Nuestra familia y sus apoyos");
  plan.members.forEach((member, index) => item(writer, `Integrante ${index + 1}: ${member.name}`, [
    `Edad: ${member.age} · Relación: ${member.relation} · Teléfono: ${member.phone || "—"}`,
    `Apoyos: ${member.support || "Ninguno indicado"}`,
    `Rol: ${member.role}`,
  ]));
  plan.pets.forEach((pet, index) => item(writer, `Mascota ${index + 1}: ${pet.name}`, [
    `Responsable: ${pet.keeper}`,
    `Necesidades: ${pet.needs}`,
  ]));

  section(writer, 3, "Riesgos que debemos preparar");
  plan.risks.forEach((risk, index) => item(writer, `Riesgo ${index + 1}: ${risk.type} · prioridad ${risk.priority}`, [
    `Qué puede pasar: ${risk.effect}`,
    `Cómo reducirlo: ${risk.prevention}`,
    `Primer paso: ${risk.first}`,
  ]));

  section(writer, 4, "Rutas, puntos seguros y comunicación");
  plan.routes.forEach((route) => item(writer, route.situation, [
    `Ruta segura: ${route.route}`,
    `Punto de encuentro: ${route.point}`,
    `Aviso: ${route.notice}`,
  ]));

  section(writer, 5, "Croquis y ubicación");
  field(writer, "Referencia cercana", plan.reference || "No indicada");
  if (plan.location) {
    field(writer, "Coordenadas", `${plan.location.lat.toFixed(6)}, ${plan.location.lng.toFixed(6)} · ${plan.location.layer}`);
    await drawJpeg(writer, "Vista del mapa", plan.location.snapshot);
  } else {
    field(writer, "Ubicación", "No se registraron coordenadas.");
  }
  await drawJpeg(writer, "Croquis de la vivienda", plan.sketch);

  section(writer, 6, "Mochila y recursos disponibles");
  plan.resources.forEach((resource) => item(writer, `${resource.status}: ${resource.item}`, [
    `Cantidad o fecha: ${resource.amount || "—"}`,
    `Ubicación: ${resource.location || "—"} · Pendiente: ${resource.pending || "—"}`,
  ]));
  field(writer, "Teléfonos útiles", plan.usefulPhones || "No indicados");

  section(writer, 7, "Acciones familiares");
  plan.actions.filter((action) => action.action).forEach((action, index) => item(writer, `${index + 1}. ${action.moment}${action.done ? " · Lista" : ""}`, [
    action.action,
    `Responsable: ${action.person} · Fecha: ${action.date || "—"}`,
  ]));

  section(writer, 8, "Práctica y actualización");
  field(writer, "Fecha de práctica", plan.practice.date || "Sin fecha");
  field(writer, "Qué ensayamos", plan.practice.exercise || "No indicado");
  field(writer, "Qué mejoraremos", plan.practice.improvement || "No indicado");
  field(writer, "Responsable", plan.practice.person || "No indicado");
  field(writer, "Participantes", plan.participants);
  field(writer, "Registro", `Plan registrado el ${createdAt.toLocaleString("es-EC", { timeZone: "Pacific/Galapagos" })}. Consentimiento ${plan.consent ? "confirmado" : "no confirmado"}.`);

  drawFooter(writer);
  doc.setTitle(`Plan Familiar de Emergencia - ${plan.family}`);
  doc.setAuthor("Consejo de Gobierno del Régimen Especial de Galápagos");
  doc.setSubject("Plan Familiar de Emergencia");
  doc.setCreationDate(createdAt);
  return doc.save();
}
