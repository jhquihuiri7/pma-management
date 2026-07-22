import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { FORMAT_MAX_BYTES, readFormatUpload } from "../modules/shared/formatContract.js";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME_TYPE = "application/msword";
const CFB_FREE_SECTOR = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FAT_SECTOR = 0xfffffffd;
const CFB_NO_STREAM = 0xffffffff;

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files: Record<string, string | Buffer>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const [name, rawData] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + nameBuffer.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    data.copy(local, 30 + nameBuffer.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBuffer.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, eocd]);
}

function createValidDocx(): Buffer {
  return createStoredZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
  });
}

function writeCompoundDirectoryEntry(
  directory: Buffer,
  index: number,
  options: {
    name: string;
    objectType: 2 | 5;
    left?: number;
    right?: number;
    child?: number;
    startingSector: number;
    streamSize: number;
  },
): void {
  const offset = index * 128;
  const name = Buffer.from(`${options.name}\0`, "utf16le");
  name.copy(directory, offset);
  directory.writeUInt16LE(name.length, offset + 64);
  directory[offset + 66] = options.objectType;
  directory[offset + 67] = 1;
  directory.writeUInt32LE(options.left ?? CFB_NO_STREAM, offset + 68);
  directory.writeUInt32LE(options.right ?? CFB_NO_STREAM, offset + 72);
  directory.writeUInt32LE(options.child ?? CFB_NO_STREAM, offset + 76);
  directory.writeUInt32LE(options.startingSector, offset + 116);
  directory.writeBigUInt64LE(BigInt(options.streamSize), offset + 120);
}

function createValidLegacyDoc(): Buffer {
  const sectorSize = 512;
  const header = Buffer.alloc(sectorSize);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(0, 48);
  header.writeUInt32LE(4_096, 56);
  header.writeUInt32LE(3, 60);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(CFB_END_OF_CHAIN, 68);
  header.fill(0xff, 76);
  header.writeUInt32LE(1, 76);

  const directory = Buffer.alloc(sectorSize);
  writeCompoundDirectoryEntry(directory, 0, {
    name: "Root Entry",
    objectType: 5,
    child: 1,
    startingSector: 2,
    streamSize: 128,
  });
  writeCompoundDirectoryEntry(directory, 1, {
    name: "WordDocument",
    objectType: 2,
    right: 2,
    startingSector: 0,
    streamSize: 32,
  });
  writeCompoundDirectoryEntry(directory, 2, {
    name: "0Table",
    objectType: 2,
    startingSector: 1,
    streamSize: 1,
  });

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(CFB_END_OF_CHAIN, 0 * 4);
  fat.writeUInt32LE(CFB_FAT_SECTOR, 1 * 4);
  fat.writeUInt32LE(CFB_END_OF_CHAIN, 2 * 4);
  fat.writeUInt32LE(CFB_END_OF_CHAIN, 3 * 4);
  const miniStream = Buffer.alloc(sectorSize);
  miniStream.writeUInt16LE(0xa5ec, 0);
  miniStream.writeUInt16LE(0x00c1, 2);
  miniStream.writeUInt16LE(0, 10);
  miniStream[64] = 1;
  const miniFat = Buffer.alloc(sectorSize, 0xff);
  miniFat.writeUInt32LE(CFB_END_OF_CHAIN, 0 * 4);
  miniFat.writeUInt32LE(CFB_END_OF_CHAIN, 1 * 4);
  return Buffer.concat([header, directory, fat, miniStream, miniFat]);
}

function createFormatParts(fileName: string, mimetype: string, data: Buffer): unknown[] {
  return [
    {
      type: "field",
      fieldname: "functionality",
      fieldnameTruncated: false,
      valueTruncated: false,
      value: "descargar_anexos",
    },
    {
      type: "file",
      fieldname: "file",
      filename: fileName,
      mimetype,
      file: { truncated: false },
      toBuffer: async () => data,
    },
  ];
}

function fakeMultipartRequest(
  parts: unknown[],
  onOptions?: (options: unknown) => void,
): FastifyRequest {
  return {
    parts(options: unknown) {
      onOptions?.(options);
      return (async function* () {
        for (const part of parts) yield part;
      })();
    },
  } as unknown as FastifyRequest;
}

test("format multipart parsing applies strict cardinality and byte limits", async () => {
  let receivedOptions: unknown;
  const request = fakeMultipartRequest([
    {
      type: "field",
      fieldname: "functionality",
      fieldnameTruncated: false,
      valueTruncated: true,
      value: "descargar_anexos",
    },
  ], (options) => { receivedOptions = options; });

  await assert.rejects(readFormatUpload(request), /truncado/);
  assert.deepEqual(receivedOptions, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: FORMAT_MAX_BYTES,
      fieldSize: 64,
      fields: 1,
      files: 1,
      parts: 2,
    },
  });
});

test("format multipart rejects invalid file metadata before buffering payload", async () => {
  let buffered = false;
  const request = fakeMultipartRequest([
    {
      type: "file",
      fieldname: "unexpectedFile",
      filename: "format.docx",
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file: { truncated: false },
      toBuffer: async () => {
        buffered = true;
        return Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      },
    },
  ]);

  await assert.rejects(readFormatUpload(request), /Campo de archivo no válido/);
  assert.equal(buffered, false);
});

test("format multipart accepts a structurally valid OOXML Word package", async () => {
  const data = createValidDocx();
  const result = await readFormatUpload(
    fakeMultipartRequest(createFormatParts("formato.docx", DOCX_MIME_TYPE, data)),
  );

  assert.equal(result.fileName, "formato.docx");
  assert.equal(result.contentType, DOCX_MIME_TYPE);
  assert.deepEqual(result.data, data);
});

test("format multipart accepts a valid docx with a generic browser MIME and canonicalizes it", async () => {
  const data = createValidDocx();
  const result = await readFormatUpload(
    fakeMultipartRequest(createFormatParts("formato.docx", "application/octet-stream", data)),
  );

  assert.equal(result.contentType, DOCX_MIME_TYPE);
  assert.deepEqual(result.data, data);
});

test("format multipart rejects an XLSX-like ZIP renamed to docx", async () => {
  const spreadsheet = createStoredZip({
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": "<workbook/>",
  });

  await assert.rejects(
    readFormatUpload(fakeMultipartRequest(createFormatParts("renombrado.docx", DOCX_MIME_TYPE, spreadsheet))),
    /documento Word válido/,
  );
});

test("format multipart rejects corrupt OOXML entries instead of trusting ZIP magic", async () => {
  const corrupt = createValidDocx();
  const contentOffset = 30 + Buffer.byteLength("[Content_Types].xml");
  corrupt[contentOffset] = corrupt[contentOffset]! ^ 0xff;

  await assert.rejects(
    readFormatUpload(fakeMultipartRequest(createFormatParts("corrupto.docx", DOCX_MIME_TYPE, corrupt))),
    /documento Word válido/,
  );
});

test("format multipart requires MIME type to match the Word extension", async () => {
  let buffered = false;
  const parts = createFormatParts("formato.docx", DOC_MIME_TYPE, createValidDocx());
  (parts[1] as { toBuffer: () => Promise<Buffer> }).toBuffer = async () => {
    buffered = true;
    return createValidDocx();
  };

  await assert.rejects(readFormatUpload(fakeMultipartRequest(parts)), /Solo se permiten documentos Word/);
  assert.equal(buffered, false);
});

test("format multipart accepts a structurally valid legacy Word compound file", async () => {
  const data = createValidLegacyDoc();
  const result = await readFormatUpload(
    fakeMultipartRequest(createFormatParts("formato.doc", DOC_MIME_TYPE, data)),
  );

  assert.equal(result.fileName, "formato.doc");
  assert.deepEqual(result.data, data);
});

test("format multipart accepts a valid legacy doc with an empty MIME and canonicalizes it", async () => {
  const data = createValidLegacyDoc();
  const result = await readFormatUpload(
    fakeMultipartRequest(createFormatParts("formato.doc", "", data)),
  );

  assert.equal(result.contentType, DOC_MIME_TYPE);
  assert.deepEqual(result.data, data);
});

test("format multipart rejects an OLE signature without Word streams", async () => {
  const fakeOle = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(fakeOle);

  await assert.rejects(
    readFormatUpload(fakeMultipartRequest(createFormatParts("renombrado.doc", DOC_MIME_TYPE, fakeOle))),
    /documento Word válido/,
  );
});
