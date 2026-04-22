import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

export interface RgdtWasteCatalogEntry {
  codigo: string;
  descripcion: string;
  crtib: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map((h) => normalize(String(h ?? "")));
  const normalizedAliases = aliases.map((a) => normalize(a));
  return normalizedHeaders.findIndex((header) =>
    normalizedAliases.some((alias) => header === alias || header.includes(alias))
  );
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

let cache: { loadedAt: number; entries: RgdtWasteCatalogEntry[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export function loadRgdtWasteCatalog(): RgdtWasteCatalogEntry[] {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) {
    return cache.entries;
  }

  const dataDir = path.join(process.cwd(), "public", "data");
  const candidates = [
    path.join(dataDir, "rgdt-residuos.xlsx"),
    path.join(dataDir, "rgdt-residuos.xls"),
    path.join(dataDir, "rgdt-residuos.csv"),
  ];

  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    cache = { loadedAt: Date.now(), entries: [] };
    return [];
  }

  const extension = path.extname(filePath).toLowerCase();
  const isCsv = extension === ".csv";

  let workbook: XLSX.WorkBook;
  try {
    const fileBuffer = fs.readFileSync(filePath);
    workbook = isCsv
      ? XLSX.read(fileBuffer.toString("utf8"), {
          type: "string",
          raw: false,
          FS: ";",
        })
      : XLSX.read(fileBuffer, {
          type: "buffer",
          raw: false,
        });
  } catch {
    cache = { loadedAt: Date.now(), entries: [] };
    return [];
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    cache = { loadedAt: Date.now(), entries: [] };
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (rows.length < 2) {
    cache = { loadedAt: Date.now(), entries: [] };
    return [];
  }

  const headers = (rows[0] as unknown[]).map((h) => String(h ?? ""));
  const descripcionIdx = findHeaderIndex(headers, ["descripcion", "nombre"]);
  const crtibIdx = findHeaderIndex(headers, ["crtib"]);
  const codigoIdx = findHeaderIndex(headers, ["codigo"]);

  if (descripcionIdx === -1 || crtibIdx === -1 || codigoIdx === -1) {
    cache = { loadedAt: Date.now(), entries: [] };
    return [];
  }

  const dedupe = new Set<string>();
  const entries: RgdtWasteCatalogEntry[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const descripcion = cellToString(row[descripcionIdx]);
    const crtib = cellToString(row[crtibIdx]);
    const codigo = cellToString(row[codigoIdx]);

    if (!codigo || !descripcion || !crtib) continue;

    const key = `${normalize(codigo)}|${normalize(descripcion)}|${normalize(crtib)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    entries.push({ codigo, descripcion, crtib });
  }

  cache = { loadedAt: Date.now(), entries };
  return entries;
}

export function findRgdtCatalogMatch(
  entries: RgdtWasteCatalogEntry[],
  values: { codigo: string; descripcion: string; crtib: string }
): RgdtWasteCatalogEntry | null {
  const codigo = normalize(values.codigo);
  const descripcion = normalize(values.descripcion);
  const crtib = normalize(values.crtib);

  if (!codigo || !descripcion || !crtib) return null;

  return (
    entries.find(
      (entry) =>
        normalize(entry.codigo) === codigo &&
        normalize(entry.descripcion) === descripcion &&
        normalize(entry.crtib) === crtib
    ) ?? null
  );
}
