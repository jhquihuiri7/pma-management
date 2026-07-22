import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RgdtWasteCatalogEntry } from "@pma/types";

const CATALOG_RELATIVE_PATH = "apps/web/public/data/rgdt-residuos.csv";
const CACHE_MS = 5 * 60 * 1000;
let cache: { loadedAt: number; entries: RgdtWasteCatalogEntry[] } | null = null;

export function normalizeCatalogValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDelimitedLine(line: string, delimiter = ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizeCatalogValue);
  return headers.findIndex((header) => {
    const normalized = normalizeCatalogValue(header);
    return normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias));
  });
}

export function parseRgdtWasteCatalogCsv(csv: string): RgdtWasteCatalogEntry[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseDelimitedLine(lines[0]);
  const descriptionIndex = headerIndex(headers, ["descripcion", "nombre"]);
  const crtibIndex = headerIndex(headers, ["crtib"]);
  const codeIndex = headerIndex(headers, ["codigo"]);
  if (descriptionIndex < 0 || crtibIndex < 0 || codeIndex < 0) return [];

  const seen = new Set<string>();
  const entries: RgdtWasteCatalogEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseDelimitedLine(line);
    const codigo = cells[codeIndex]?.trim() ?? "";
    const descripcion = cells[descriptionIndex]?.trim() ?? "";
    const crtib = cells[crtibIndex]?.trim() ?? "";
    if (!codigo || !descripcion || !crtib) continue;
    const key = [codigo, descripcion, crtib].map(normalizeCatalogValue).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ codigo, descripcion, crtib });
  }
  return entries;
}

function catalogCandidates(): string[] {
  return [
    path.resolve(process.cwd(), CATALOG_RELATIVE_PATH),
    path.resolve(process.cwd(), "../web/public/data/rgdt-residuos.csv"),
    path.resolve(process.cwd(), "data/rgdt-residuos.csv"),
  ];
}

export async function loadRgdtWasteCatalog(): Promise<RgdtWasteCatalogEntry[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.entries;

  for (const candidate of catalogCandidates()) {
    try {
      const csv = await readFile(candidate, "utf8");
      const entries = parseRgdtWasteCatalogCsv(csv);
      cache = { loadedAt: Date.now(), entries };
      return entries;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  cache = { loadedAt: Date.now(), entries: [] };
  return [];
}

export function findRgdtCatalogMatch(
  entries: RgdtWasteCatalogEntry[],
  values: { codigo: string; descripcion: string; crtib: string }
): RgdtWasteCatalogEntry | null {
  const codigo = normalizeCatalogValue(values.codigo);
  const descripcion = normalizeCatalogValue(values.descripcion);
  const crtib = normalizeCatalogValue(values.crtib);
  if (!codigo || !descripcion || !crtib) return null;

  return (
    entries.find(
      (entry) =>
        normalizeCatalogValue(entry.codigo) === codigo &&
        normalizeCatalogValue(entry.descripcion) === descripcion &&
        normalizeCatalogValue(entry.crtib) === crtib
    ) ?? null
  );
}
