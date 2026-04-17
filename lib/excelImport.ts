import * as XLSX from "xlsx";
import {
  SUBPLAN_OPTIONS,
  PERIODICITY_OPTIONS,
  matchClosestOption,
} from "./planItemConstants";

export interface ParsedItemRow {
  rowNumber: number;
  item: string;
  subplan: string;
  direccion: string;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  budget: number;
  observation: string;
  errors: string[];
  warnings: string[];
}

const COLUMN_ALIASES: Record<keyof Omit<ParsedItemRow, "rowNumber" | "errors" | "warnings">, string[]> = {
  item: ["item", "ítem", "codigo", "código"],
  subplan: ["subplan"],
  direccion: ["direccion", "direcciÃ³n", "dirección", "dirección responsable", "direccion responsable"],
  environmental_activity: [
    "actividad/aspecto ambiental",
    "actividad ambiental",
    "aspecto ambiental",
    "actividad aspecto ambiental",
  ],
  identified_environmental_impact: [
    "impacto ambiental identificado",
    "impacto ambiental",
    "impacto identificado",
  ],
  proposed_measure: ["medida propuesta", "medida"],
  indicator: ["indicador"],
  verification_method: [
    "medio de verificación",
    "medio de verificacion",
    "verificación",
    "verificacion",
  ],
  periodicity: ["periodicidad"],
  budget: ["presupuesto", "budget"],
  observation: ["observación", "observacion", "observaciones"],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHeaderMap(headers: string[]): Map<keyof typeof COLUMN_ALIASES, number> {
  const map = new Map<keyof typeof COLUMN_ALIASES, number>();
  const normalized = headers.map((h) => normalizeHeader(String(h ?? "")));

  (Object.keys(COLUMN_ALIASES) as Array<keyof typeof COLUMN_ALIASES>).forEach((field) => {
    const aliases = COLUMN_ALIASES[field].map(normalizeHeader);
    const idx = normalized.findIndex((h) =>
      aliases.some((a) => h === a || h.includes(a))
    );
    if (idx !== -1) map.set(field, idx);
  });

  return map;
}

function parseBudget(raw: unknown): { value: number; coerced: boolean } {
  if (raw === null || raw === undefined || raw === "") return { value: 0, coerced: false };
  if (typeof raw === "number") return { value: Number.isFinite(raw) ? raw : 0, coerced: !Number.isFinite(raw) };

  const str = String(raw).trim();
  if (!str || str === "-") return { value: 0, coerced: false };

  const cleaned = str.replace(/[$\s]/g, "").replace(/,/g, "");
  if (cleaned === "-" || cleaned === "") return { value: 0, coerced: false };

  const n = Number(cleaned);
  if (Number.isFinite(n)) return { value: n, coerced: false };
  return { value: 0, coerced: true };
}

function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

export interface ParseResult {
  rows: ParsedItemRow[];
  missingColumns: string[];
  fatalError?: string;
}

export async function parseExcelFile(file: File): Promise<ParseResult> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [], missingColumns: [], fatalError: "El archivo no tiene hojas" };

    const sheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (aoa.length < 2) {
      return { rows: [], missingColumns: [], fatalError: "El archivo no tiene filas de datos" };
    }

    const headers = (aoa[0] as unknown[]).map((h) => String(h ?? ""));
    const headerMap = buildHeaderMap(headers);

    const required: Array<keyof typeof COLUMN_ALIASES> = [
      "item",
      "subplan",
      "direccion",
      "environmental_activity",
      "identified_environmental_impact",
      "proposed_measure",
      "indicator",
      "verification_method",
    ];
    const missingColumns = required
      .filter((f) => !headerMap.has(f))
      .map((f) => COLUMN_ALIASES[f][0]);

    if (missingColumns.length > 0) {
      return { rows: [], missingColumns };
    }

    const rows: ParsedItemRow[] = [];

    for (let i = 1; i < aoa.length; i++) {
      const raw = aoa[i] as unknown[];
      const get = (field: keyof typeof COLUMN_ALIASES) => {
        const idx = headerMap.get(field);
        return idx !== undefined ? raw[idx] : "";
      };

      const item = cellToString(get("item"));
      const direccion = cellToString(get("direccion"));
      const environmental_activity = cellToString(get("environmental_activity"));
      const identified_environmental_impact = cellToString(get("identified_environmental_impact"));
      const proposed_measure = cellToString(get("proposed_measure"));
      const indicator = cellToString(get("indicator"));
      const verification_method = cellToString(get("verification_method"));
      const observation = cellToString(get("observation"));

      const rowAllEmpty =
        !item &&
        !direccion &&
        !environmental_activity &&
        !identified_environmental_impact &&
        !proposed_measure &&
        !indicator &&
        !verification_method;
      if (rowAllEmpty) continue;

      const errors: string[] = [];
      const warnings: string[] = [];

      if (!item) errors.push("Falta Ítem");
      if (!direccion) errors.push("Falta Dirección");
      if (!environmental_activity) errors.push("Falta Actividad/Aspecto Ambiental");
      if (!identified_environmental_impact) errors.push("Falta Impacto Ambiental Identificado");
      if (!proposed_measure) errors.push("Falta Medida Propuesta");
      if (!indicator) errors.push("Falta Indicador");
      if (!verification_method) errors.push("Falta Medio de Verificación");

      const rawSubplan = cellToString(get("subplan"));
      let subplan = "";
      if (rawSubplan) {
        const matched = matchClosestOption(rawSubplan, SUBPLAN_OPTIONS);
        if (matched) {
          subplan = matched;
          if (matched !== rawSubplan) {
            warnings.push(`Subplan ajustado a "${matched}"`);
          }
        } else {
          warnings.push(`Subplan "${rawSubplan}" no coincide, dejado en blanco`);
        }
      } else {
        warnings.push("Subplan vacío");
      }

      const rawPeriodicity = cellToString(get("periodicity"));
      let periodicity = "";
      if (rawPeriodicity) {
        const matched = matchClosestOption(rawPeriodicity, PERIODICITY_OPTIONS);
        if (matched) {
          periodicity = matched;
          if (matched !== rawPeriodicity) {
            warnings.push(`Periodicidad ajustada a "${matched}"`);
          }
        } else {
          warnings.push(`Periodicidad "${rawPeriodicity}" no coincide, dejada en blanco`);
        }
      } else {
        warnings.push("Periodicidad vacía");
      }

      const budgetParsed = parseBudget(get("budget"));
      if (budgetParsed.coerced) {
        warnings.push("Presupuesto no numérico, se usó 0");
      }

      rows.push({
        rowNumber: i + 1,
        item,
        subplan,
        direccion,
        environmental_activity,
        identified_environmental_impact,
        proposed_measure,
        indicator,
        verification_method,
        periodicity,
        budget: budgetParsed.value,
        observation,
        errors,
        warnings,
      });
    }

    return { rows, missingColumns: [] };
  } catch (err) {
    return {
      rows: [],
      missingColumns: [],
      fatalError: (err as Error).message || "Error al leer el archivo",
    };
  }
}
