// Confirms each .dbf really is UTF-8 (as its .cpg claims) by strict-decoding
// every character field of every record. The header holds binary counters, so
// only the C fields are checked. Usage: node check_dbf.cjs <originals dir> <out.json>
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const strict = new TextDecoder("utf-8", { fatal: true });

function checkDbf(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const records = view.getUint32(4, true);
  const headerLen = view.getUint16(8, true);
  const recordLen = view.getUint16(10, true);
  const fields = [];
  let offset = 1; // deletion flag
  for (let p = 32; p < headerLen - 1 && buf[p] !== 0x0d; p += 32) {
    const name = Buffer.from(buf.subarray(p, p + 11)).toString("latin1").replace(/\0.*$/, "");
    const type = String.fromCharCode(buf[p + 11]);
    const len = buf[p + 16];
    fields.push({ name, type, len, offset });
    offset += len;
  }
  let textValues = 0, nonAsciiValues = 0;
  const invalid = [];
  for (let i = 0; i < records; i++) {
    const rec = headerLen + i * recordLen;
    for (const f of fields.filter((x) => x.type === "C")) {
      let bytes = buf.subarray(rec + f.offset, rec + f.offset + f.len);
      let end = bytes.length;
      while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0)) end--;
      bytes = bytes.subarray(0, end);
      if (!bytes.length) continue;
      textValues++;
      if (bytes.some((b) => b > 127)) nonAsciiValues++;
      try { strict.decode(bytes); } catch {
        if (invalid.length < 5) invalid.push(`${f.name}[fid ${i}]: …${Buffer.from(bytes.subarray(Math.max(0, bytes.length - 12))).toString("utf8")}`);
        else invalid.push(null);
      }
    }
  }
  return { records, textValues, nonAsciiValues, invalidCount: invalid.length, invalidSamples: invalid.filter(Boolean) };
}

const [dir, outPath] = process.argv.slice(2);
(async () => {
  const out = {};
  for (const folder of fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory()).sort()) {
    for (const zipName of fs.readdirSync(path.join(dir, folder)).filter((f) => f.endsWith(".zip")).sort()) {
      const key = `${folder}/${zipName.replace(/\.zip$/, "")}`;
      try {
        const zip = await JSZip.loadAsync(fs.readFileSync(path.join(dir, folder, zipName)));
        const dbf = Object.values(zip.files).find((f) => /\.dbf$/i.test(f.name));
        out[key] = checkDbf(await dbf.async("uint8array"));
      } catch (err) {
        out[key] = { error: err.message };
      }
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  const vals = Object.entries(out);
  console.log(`dbf revisados: ${vals.length}; con valores no ASCII (tildes/ñ): ${vals.filter(([, v]) => v.nonAsciiValues).length}; errores de lectura: ${vals.filter(([, v]) => v.error).length}`);
  for (const [k, v] of vals.filter(([, v]) => v.invalidCount)) console.log(`  UTF-8 inválido ${k}: ${v.invalidCount} valor(es) · ${v.invalidSamples.join(" | ")}`);
  for (const [k, v] of vals.filter(([, v]) => v.error)) console.log(`  error ${k}: ${v.error}`);
})();
