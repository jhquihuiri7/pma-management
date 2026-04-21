import * as XLSX from "xlsx";

export interface CiiuEntry {
  code: string;
  description: string;
  level: number;
}

export interface CoordinatePoint {
  vertex: number;
  x: number;
  y: number;
}

export interface CoordinateSummary {
  pointsCount: number;
  areaM2: number;
  areaHa: number;
  points: CoordinatePoint[];
}

export const RGDP_LOCATION_TREE: Record<string, Record<string, string[]>> = {
  "Galápagos": {
    "San Cristóbal": [
      "Puerto Baquerizo Moreno",
      "El Progreso",
      "Puerto Velasco Ibarra",
    ],
    "Santa Cruz": ["Puerto Ayora", "Bella Vista", "Santa Rosa"],
    Isabela: ["Tomás de Berlanga"],
  },
};

function parseCsvLine(line: string, delimiter: string = ","): string[] {
  const out: string[] = [];
  let token = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        token += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(token.trim());
      token = "";
      continue;
    }

    token += ch;
  }

  out.push(token.trim());
  return out;
}

export async function loadCiiuCatalog(): Promise<CiiuEntry[]> {
  const res = await fetch("/data/ciiu-catalog.csv", { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el catalogo CIIU");

  const raw = await res.text();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    console.warn("⚠️ CIIU Catalog: No hay lineas en el archivo");
    return [];
  }

  // Detectar delimitador (`;` o `,`)
  const headerLine = lines[0];
  const delimiter = headerLine.includes(";") ? ";" : ",";
  console.log(`📄 CIIU Catalog: Detectado delimitador '${delimiter}'`);

  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));
  console.log(`📄 CIIU Catalog: Total de filas parseadas: ${rows.length}`);

  const entries = rows
    .map((row) => ({
      code: String(row[0] ?? "").trim(),
      description: String(row[1] ?? "").trim(),
      level: Number(row[2] ?? 0),
    }))
    .filter((entry) => entry.code && entry.description && Number.isFinite(entry.level));

  console.log(`✅ CIIU Catalog: Cargadas ${entries.length} entradas válidas`);
  const level6 = entries.filter((e) => e.level === 6);
  console.log(`📊 CIIU Catalog: ${level6.length} entradas con nivel 6`);
  if (level6.length === 0) {
    console.warn("⚠️ CIIU Catalog: ¡No hay entradas nivel 6! Primeros registros:", entries.slice(0, 3));
  }

  return entries;
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function searchCiiu(entries: CiiuEntry[], query: string): CiiuEntry[] {
  const q = normalize(query);
  const level6Entries = entries.filter((entry) => entry.level === 6);
  
  if (!q) {
    console.debug(`🔍 CIIU Search: Query vacío, retornando ${level6Entries.length} registros nivel 6 (primeros 50)`);
    return level6Entries.slice(0, 50);
  }

  const results = level6Entries
    .filter((entry) => {
      const code = normalize(entry.code);
      const description = normalize(entry.description);
      return code.includes(q) || description.includes(q);
    })
    .slice(0, 50);

  console.debug(`🔍 CIIU Search: Query '${query}' (normalizado: '${q}') encontró ${results.length} resultados`);
  if (results.length > 0) {
    console.debug(`   Primeros 3 resultados:`, results.slice(0, 3));
  }

  return results;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const asString = String(value ?? "").trim().replace(/,/g, ".");
  return Number(asString);
}

export async function parseCoordinateFile(file: File): Promise<CoordinateSummary> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no contiene hojas");

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("El archivo no contiene datos");

  const points: CoordinatePoint[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const hasAnyValue = row.some((value) => String(value ?? "").trim() !== "");
    if (!hasAnyValue) throw new Error(`Fila vacia detectada en la fila ${i + 1}`);

    const vertex = Number(String(row[0] ?? "").trim());
    const x = toNumber(row[1]);
    const y = toNumber(row[2]);

    if (!Number.isInteger(vertex) || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Formato invalido en la fila ${i + 1}`);
    }

    points.push({ vertex, x, y });
  }

  if (points.length < 3) {
    throw new Error("Se requieren al menos 3 puntos");
  }

  const area = computePolygonArea(points);
  const areaM2 = Number(area.toFixed(2));
  const areaHa = Number((area / 10000).toFixed(4));

  return {
    pointsCount: points.length,
    areaM2,
    areaHa,
    points,
  };
}

function computePolygonArea(points: CoordinatePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function isCoordinateFileNameAllowed(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "xlsx" || ext === "xls" || ext === "csv";
}

/**
 * Convierte un archivo CSV a XLSX
 * Usado para descargar plantillas CSV como archivos Excel
 */
export async function convertCsvToXlsx(csvUrl: string, fileName: string): Promise<void> {
  try {
    console.log(`🔄 Convirtiendo CSV a XLSX: ${fileName}`);
    
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error(`No se pudo descargar el archivo: ${res.statusText}`);
    
    const csvText = await res.text();
    console.log(`📄 CSV descargado, tamaño: ${csvText.length} bytes`);
    
    // Detectar delimitador
    const firstLine = csvText.split(/\r?\n/)[0];
    const delimiter = firstLine.includes(";") ? ";" : ",";
    console.log(`📄 Delimitador detectado: '${delimiter}'`);
    
    // Parsear CSV a array 2D
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    
    const data = lines.map((line) => parseCsvLine(line, delimiter));
    console.log(`📊 CSV parseado: ${data.length} filas, ${data[0]?.length ?? 0} columnas`);
    
    // Crear workbook XLSX
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, sheet, "Coordenadas");
    
    // Auto-ajustar ancho de columnas
    const colWidths = (data[0] ?? []).map(() => 15);
    sheet["!cols"] = colWidths.map((w) => ({ wch: w }));
    
    // Descargar
    const xlsxFileName = fileName.replace(/\.csv$/i, ".xlsx");
    XLSX.writeFile(workbook, xlsxFileName);
    console.log(`✅ Archivo XLSX descargado: ${xlsxFileName}`);
  } catch (error) {
    console.error(`❌ Error al convertir CSV a XLSX:`, error);
    throw error;
  }
}
