import * as XLSX from "xlsx";
import type { RgdpWastePlanItemInput } from "@/types";

export interface ParsedRgdpWasteRow extends RgdpWastePlanItemInput {
  rowNumber: number;
  errors: string[];
  warnings: string[];
}

export interface RgdpWasteImportResult {
  rows: ParsedRgdpWasteRow[];
  missingColumns: string[];
  fatalError?: string;
}

type ImportField =
  | "wasteCode"
  | "wasteName"
  | "wasteDescription"
  | "crtib"
  | "annualGenerationKg"
  | "generationOrigin"
  | "selfManagement"
  | "observation";

const COLUMN_ALIASES: Record<ImportField, string[]> = {
  wasteCode: [
    "código del residuo o desecho",
    "codigo del residuo o desecho",
    "código del residuo",
    "codigo del residuo",
    "código",
    "codigo",
    "waste code",
  ],
  wasteName: [
    "nombre del residuo o desecho",
    "nombre del residuo",
    "residuo o desecho",
    "descripción catálogo",
    "descripcion catalogo",
    "denominación",
    "denominacion",
    "nombre",
    "descripción",
    "descripcion",
  ],
  wasteDescription: [
    "descripción adicional",
    "descripcion adicional",
    "detalle del residuo",
    "detalle",
  ],
  crtib: ["crtib", "característica crtib", "caracteristica crtib"],
  annualGenerationKg: [
    "generación anual (kg)",
    "generacion anual (kg)",
    "generación anual kg",
    "generacion anual kg",
    "kg anuales",
    "generación anual",
    "generacion anual",
  ],
  generationOrigin: [
    "origen de la generación",
    "origen de la generacion",
    "origen de generación",
    "origen de generacion",
    "origen",
    "dirección",
    "direccion",
  ],
  selfManagement: [
    "gestión propia",
    "gestion propia",
    "autogestión",
    "autogestion",
    "self management",
  ],
  observation: ["observación", "observacion", "observaciones"],
};

const REQUIRED_FIELDS: ImportField[] = [
  "wasteCode",
  "wasteName",
  "crtib",
  "annualGenerationKg",
  "generationOrigin",
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cellString(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function buildHeaderMap(headers: unknown[]): Map<ImportField, number> {
  const normalizedHeaders = headers.map((header) => normalize(cellString(header)));
  const map = new Map<ImportField, number>();
  for (const field of Object.keys(COLUMN_ALIASES) as ImportField[]) {
    const aliases = COLUMN_ALIASES[field].map(normalize);
    const exactIndex = normalizedHeaders.findIndex((header) => aliases.includes(header));
    const index = exactIndex >= 0
      ? exactIndex
      : normalizedHeaders.findIndex((header) =>
          aliases.some(
            (alias) =>
              alias.length >= 12 &&
              !["descripcion", "nombre", "codigo"].includes(alias) &&
              header.includes(alias)
          )
        );
    if (index >= 0) map.set(field, index);
  }
  return map;
}

function parseKg(value: unknown): { value: number; error?: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { value: 0, error: "Generación anual no numérica" };
    if (value < 0) return { value: 0, error: "La generación anual no puede ser negativa" };
    if (value > 99_999_999_999.999) return { value: 0, error: "La generación anual excede el máximo permitido" };
    return { value };
  }

  const raw = cellString(value).replace(/\s|kg/gi, "");
  if (!raw) return { value: 0, error: "Falta Generación anual (kg)" };
  let normalized = raw;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(",", ".");
  }
  const number = Number(normalized);
  if (!Number.isFinite(number)) return { value: 0, error: "Generación anual no numérica" };
  if (number < 0) return { value: 0, error: "La generación anual no puede ser negativa" };
  if (number > 99_999_999_999.999) return { value: 0, error: "La generación anual excede el máximo permitido" };
  return { value: number };
}

function parseBoolean(value: unknown): { value: boolean; error?: string } {
  if (typeof value === "boolean") return { value };
  if (typeof value === "number") {
    if (value === 1) return { value: true };
    if (value === 0) return { value: false };
  }
  const normalized = normalize(cellString(value));
  if (!normalized || ["no", "n", "false", "0", "tercerizada", "externa"].includes(normalized)) {
    return { value: false };
  }
  if (["si", "s", "true", "1", "propia", "autogestion"].includes(normalized)) {
    return { value: true };
  }
  return { value: false, error: 'Gestión propia debe ser "Sí" o "No"' };
}

export async function parseRgdpWasteExcel(file: File): Promise<RgdpWasteImportResult> {
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [], missingColumns: [], fatalError: "El archivo no tiene hojas" };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (rows.length < 2) {
      return { rows: [], missingColumns: [], fatalError: "El archivo no tiene filas de datos" };
    }

    const headerMap = buildHeaderMap(rows[0] as unknown[]);
    const missingColumns = REQUIRED_FIELDS
      .filter((field) => !headerMap.has(field))
      .map((field) => COLUMN_ALIASES[field][0]);
    if (missingColumns.length > 0) return { rows: [], missingColumns };

    const parsed: ParsedRgdpWasteRow[] = [];
    const seenCodes = new Set<string>();
    for (let index = 1; index < rows.length; index++) {
      const raw = rows[index] as unknown[];
      const get = (field: ImportField) => {
        const column = headerMap.get(field);
        return column == null ? "" : raw[column];
      };
      const wasteCode = cellString(get("wasteCode"));
      const wasteName = cellString(get("wasteName"));
      const wasteDescription = cellString(get("wasteDescription"));
      const crtib = cellString(get("crtib"));
      const generationOrigin = cellString(get("generationOrigin"));
      const observation = cellString(get("observation"));
      const annual = parseKg(get("annualGenerationKg"));
      const selfManagement = parseBoolean(get("selfManagement"));

      if (
        !wasteCode &&
        !wasteName &&
        !crtib &&
        !generationOrigin &&
        !cellString(get("annualGenerationKg"))
      ) continue;

      const errors: string[] = [];
      const warnings: string[] = [];
      if (!wasteCode) errors.push("Falta Código del residuo");
      if (!wasteName) errors.push("Falta Nombre del residuo");
      if (!crtib) errors.push("Falta CRTIB");
      if (!generationOrigin) errors.push("Falta Origen de la generación");
      if (annual.error) errors.push(annual.error);
      if (selfManagement.error) errors.push(selfManagement.error);

      const normalizedCode = normalize(wasteCode);
      if (normalizedCode && seenCodes.has(normalizedCode)) {
        warnings.push("Código duplicado dentro del archivo");
      }
      if (normalizedCode) seenCodes.add(normalizedCode);

      parsed.push({
        rowNumber: index + 1,
        wasteCode,
        wasteName,
        wasteDescription: wasteDescription || undefined,
        crtib,
        annualGenerationKg: annual.value,
        generationOrigin,
        selfManagement: selfManagement.value,
        observation: observation || undefined,
        errors,
        warnings,
      });
    }
    return { rows: parsed, missingColumns: [] };
  } catch (error) {
    return {
      rows: [],
      missingColumns: [],
      fatalError: (error as Error).message || "Error al leer el archivo",
    };
  }
}
