// Dumps the "Índice" sheet of indice_capas.xlsx to JSON.
// Usage: node dump_index.cjs <indice_capas.xlsx> <index.json>
const fs = require("fs");
const XLSX = require("xlsx");

const [xlsxPath, outPath] = process.argv.slice(2);
const wb = XLSX.readFile(xlsxPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Índice"], { defval: "" });
fs.writeFileSync(outPath, JSON.stringify(rows, null, 1));
console.log(`índice: ${rows.length} capas`);
