import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseRgdpWasteExcel } from "../lib/rgdpWasteExcelImport.js";

function workbookFile(rows: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Residuos");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return { arrayBuffer: async () => bytes } as unknown as File;
}

test("RGDP waste import produces the canonical DTO and detects duplicate codes", async () => {
  const result = await parseRgdpWasteExcel(
    workbookFile([
      [
        "Código del residuo",
        "Nombre del residuo",
        "CRTIB",
        "Generación anual (kg)",
        "Origen de la generación",
        "Gestión propia",
        "Descripción adicional",
        "Observación",
      ],
      ["NE-01", "Aceites usados", "T,I", "1.234,500", "Taller", "Sí", "Detalle", "Obs"],
      ["NE-01", "Aceites usados", "T,I", 2, "Taller", "No", "", ""],
    ])
  );

  assert.deepEqual(result.missingColumns, []);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    {
      wasteCode: result.rows[0].wasteCode,
      wasteName: result.rows[0].wasteName,
      crtib: result.rows[0].crtib,
      annualGenerationKg: result.rows[0].annualGenerationKg,
      generationOrigin: result.rows[0].generationOrigin,
      selfManagement: result.rows[0].selfManagement,
      wasteDescription: result.rows[0].wasteDescription,
      observation: result.rows[0].observation,
    },
    {
      wasteCode: "NE-01",
      wasteName: "Aceites usados",
      crtib: "T,I",
      annualGenerationKg: 1234.5,
      generationOrigin: "Taller",
      selfManagement: true,
      wasteDescription: "Detalle",
      observation: "Obs",
    }
  );
  assert.match(result.rows[1].warnings.join(" "), /duplicado/i);
});

test("RGDP waste import reports missing contractual columns", async () => {
  const result = await parseRgdpWasteExcel(
    workbookFile([
      ["Código", "Nombre"],
      ["NE-01", "Aceites usados"],
    ])
  );
  assert.ok(result.missingColumns.some((column) => column.toLowerCase().includes("crtib")));
  assert.ok(result.missingColumns.some((column) => column.toLowerCase().includes("generación anual")));
  assert.deepEqual(result.rows, []);
});
