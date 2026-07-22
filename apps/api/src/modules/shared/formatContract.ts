import type { Format, FormatFunctionality } from "@pma/types";
import type { FastifyRequest } from "fastify";
import { sql, type SQLWrapper } from "drizzle-orm";
import { TextDecoder } from "node:util";
import { inflateRawSync } from "node:zlib";
import { BadRequest, HttpError } from "../../lib/errors.js";

export const FORMAT_FUNCTIONALITY_LABELS: Record<FormatFunctionality, string> = {
  descargar_anexos: "Descargar Anexos",
};

export const FORMAT_MAX_BYTES = 20 * 1024 * 1024;
const FORMAT_MULTIPART_FIELD_MAX_BYTES = 64;
export const FORMAT_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  // Browsers and operating systems without a registered Office MIME mapping
  // legitimately send these values. Extension plus structural validation below
  // remains authoritative; the stored MIME is always canonicalized.
  "application/octet-stream",
  "",
]);

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME_TYPE = "application/msword";
const DOCX_MAX_ENTRIES = 4_096;
const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const DOCX_MAX_DOCUMENT_XML_BYTES = 64 * 1024 * 1024;
const DOCX_MAX_METADATA_XML_BYTES = 2 * 1024 * 1024;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

const CFB_FREE_SECTOR = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FAT_SECTOR = 0xfffffffd;
const CFB_DIFAT_SECTOR = 0xfffffffc;
const CFB_NO_STREAM = 0xffffffff;

type ZipEntry = {
  name: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type CompoundDirectoryEntry = {
  index: number;
  name: string;
  objectType: number;
  leftSibling: number;
  rightSibling: number;
  child: number;
  startingSector: number;
  streamSize: number;
};

function invalidWordContainer(): never {
  throw new Error("Invalid Word container");
}

function ensureBufferRange(data: Buffer, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    invalidWordContainer();
  }
  if (offset > data.length || length > data.length - offset) invalidWordContainer();
}

function decodeZipEntryName(value: Buffer): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    invalidWordContainer();
  }
  if (decoded.length === 0 || decoded.includes("\0") || decoded.includes("\\")) {
    invalidWordContainer();
  }
  const isDirectory = decoded.endsWith("/");
  const path = isDirectory ? decoded.slice(0, -1) : decoded;
  if (path.length === 0 || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    invalidWordContainer();
  }
  return decoded;
}

function findZipEndOfCentralDirectory(data: Buffer): number {
  const minimumOffset = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = data.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === data.length) return offset;
  }
  return invalidWordContainer();
}

function parseZipDirectory(data: Buffer): Map<string, ZipEntry> {
  if (data.length < 22) invalidWordContainer();
  const eocdOffset = findZipEndOfCentralDirectory(data);
  ensureBufferRange(data, eocdOffset, 22);

  const diskNumber = data.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = data.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = data.readUInt16LE(eocdOffset + 8);
  const entryCount = data.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = data.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = data.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount === 0xffff ||
    entryCount > DOCX_MAX_ENTRIES ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    invalidWordContainer();
  }
  ensureBufferRange(data, centralDirectoryOffset, centralDirectorySize);
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) invalidWordContainer();

  const entries = new Map<string, ZipEntry>();
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  for (let index = 0; index < entryCount; index += 1) {
    ensureBufferRange(data, cursor, 46);
    if (data.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) invalidWordContainer();
    const flags = data.readUInt16LE(cursor + 8);
    const compressionMethod = data.readUInt16LE(cursor + 10);
    const crc32 = data.readUInt32LE(cursor + 16);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const fileNameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const startDisk = data.readUInt16LE(cursor + 34);
    const localHeaderOffset = data.readUInt32LE(cursor + 42);
    const recordLength = 46 + fileNameLength + extraLength + commentLength;
    ensureBufferRange(data, cursor, recordLength);
    if (cursor + recordLength > centralDirectoryEnd) invalidWordContainer();
    if (
      startDisk !== 0 ||
      (flags & 0x0001) !== 0 ||
      (flags & 0x0040) !== 0 ||
      ![0, 8].includes(compressionMethod) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      invalidWordContainer();
    }
    const name = decodeZipEntryName(data.subarray(cursor + 46, cursor + 46 + fileNameLength));
    if (entries.has(name)) invalidWordContainer();
    totalUncompressedBytes += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      invalidWordContainer();
    }
    entries.set(name, {
      name,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += recordLength;
  }
  if (cursor !== centralDirectoryEnd) invalidWordContainer();
  return entries;
}

let crc32Table: Uint32Array | undefined;

function calculateCrc32(data: Buffer): number {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crc32Table[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function extractZipEntry(data: Buffer, entry: ZipEntry, maxOutputBytes: number): Buffer {
  if (entry.uncompressedSize > maxOutputBytes) invalidWordContainer();
  ensureBufferRange(data, entry.localHeaderOffset, 30);
  if (data.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) invalidWordContainer();
  const localFlags = data.readUInt16LE(entry.localHeaderOffset + 6);
  const localCompressionMethod = data.readUInt16LE(entry.localHeaderOffset + 8);
  const localNameLength = data.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = data.readUInt16LE(entry.localHeaderOffset + 28);
  const localHeaderLength = 30 + localNameLength + localExtraLength;
  ensureBufferRange(data, entry.localHeaderOffset, localHeaderLength);
  const localName = decodeZipEntryName(
    data.subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + localNameLength),
  );
  if (
    localName !== entry.name ||
    localCompressionMethod !== entry.compressionMethod ||
    (localFlags & 0x0001) !== 0 ||
    (localFlags & 0x0040) !== 0
  ) {
    invalidWordContainer();
  }
  const compressedOffset = entry.localHeaderOffset + localHeaderLength;
  ensureBufferRange(data, compressedOffset, entry.compressedSize);
  const compressed = data.subarray(compressedOffset, compressedOffset + entry.compressedSize);
  let output: Buffer;
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) invalidWordContainer();
    output = Buffer.from(compressed);
  } else {
    try {
      output = inflateRawSync(compressed, { maxOutputLength: maxOutputBytes });
    } catch {
      return invalidWordContainer();
    }
  }
  if (output.length !== entry.uncompressedSize || calculateCrc32(output) !== entry.crc32) {
    invalidWordContainer();
  }
  return output;
}

function decodeXml(data: Buffer): string {
  try {
    let encoding = "utf-8";
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) encoding = "utf-16le";
    if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) encoding = "utf-16be";
    const xml = new TextDecoder(encoding, { fatal: true }).decode(data);
    if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) invalidWordContainer();
    const withoutIgnoredSections = xml
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
      .replace(/<\?[\s\S]*?\?>/g, "")
      .replace(/^\uFEFF/, "");
    if (/<!--|-->|<!\[CDATA\[|\]\]>|<\?|\?>/.test(withoutIgnoredSections)) invalidWordContainer();
    return withoutIgnoredSections;
  } catch {
    return invalidWordContainer();
  }
}

function parseXmlAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    if (attributes.has(match[1]!)) invalidWordContainer();
    attributes.set(match[1]!, match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function findElementAttributes(xml: string, localName: string): Map<string, string>[] {
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escapedName}\\b([^<>]*)>`, "g");
  return Array.from(xml.matchAll(pattern), (match) => parseXmlAttributes(match[1] ?? ""));
}

function validateDocxPackage(data: Buffer): void {
  const entries = parseZipDirectory(data);
  const contentTypesEntry = entries.get("[Content_Types].xml");
  const relationshipsEntry = entries.get("_rels/.rels");
  const documentEntry = entries.get("word/document.xml");
  if (!contentTypesEntry || !relationshipsEntry || !documentEntry) invalidWordContainer();

  const contentTypesXml = decodeXml(extractZipEntry(data, contentTypesEntry, DOCX_MAX_METADATA_XML_BYTES));
  const relationshipsXml = decodeXml(extractZipEntry(data, relationshipsEntry, DOCX_MAX_METADATA_XML_BYTES));
  const documentXml = decodeXml(extractZipEntry(data, documentEntry, DOCX_MAX_DOCUMENT_XML_BYTES));

  const contentTypesRoots = findElementAttributes(contentTypesXml, "Types");
  if (
    contentTypesRoots.length !== 1 ||
    contentTypesRoots[0]!.get("xmlns") !== "http://schemas.openxmlformats.org/package/2006/content-types"
  ) {
    invalidWordContainer();
  }
  const hasMainDocumentContentType = findElementAttributes(contentTypesXml, "Override").some(
    (attributes) =>
      attributes.get("PartName") === "/word/document.xml" &&
      attributes.get("ContentType") ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  );
  if (!hasMainDocumentContentType) invalidWordContainer();

  const relationshipRoots = findElementAttributes(relationshipsXml, "Relationships");
  if (
    relationshipRoots.length !== 1 ||
    relationshipRoots[0]!.get("xmlns") !==
      "http://schemas.openxmlformats.org/package/2006/relationships"
  ) {
    invalidWordContainer();
  }
  const officeDocumentRelationshipTypes = new Set([
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
  ]);
  const hasDocumentRelationship = findElementAttributes(relationshipsXml, "Relationship").some(
    (attributes) =>
      officeDocumentRelationshipTypes.has(attributes.get("Type") ?? "") &&
      attributes.get("Target") === "word/document.xml" &&
      attributes.get("TargetMode") !== "External",
  );
  if (!hasDocumentRelationship) invalidWordContainer();

  const documentMatch = /<((?:[A-Za-z_][\w.-]*:)?document)\b([^<>]*)>/.exec(documentXml);
  if (!documentMatch) invalidWordContainer();
  const qualifiedDocumentName = documentMatch[1]!;
  const documentPrefix = qualifiedDocumentName.includes(":")
    ? qualifiedDocumentName.slice(0, qualifiedDocumentName.indexOf(":"))
    : "";
  const documentAttributes = parseXmlAttributes(documentMatch[2] ?? "");
  const wordprocessingNamespaces = new Set([
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
  ]);
  const namespaceAttribute = documentPrefix ? `xmlns:${documentPrefix}` : "xmlns";
  if (!wordprocessingNamespaces.has(documentAttributes.get(namespaceAttribute) ?? "")) {
    invalidWordContainer();
  }
  const escapedPrefix = documentPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodyPattern = documentPrefix
    ? new RegExp(`<${escapedPrefix}:body\\b[^<>]*>`)
    : /<body\b[^<>]*>/;
  if (!bodyPattern.test(documentXml)) invalidWordContainer();
}

function collectCompoundFatSectorIds(
  data: Buffer,
  sectorSize: number,
  totalSectors: number,
  fatSectorCount: number,
  firstDifatSector: number,
  difatSectorCount: number,
): number[] {
  const sectorOffset = (sectorId: number): number => {
    if (!Number.isInteger(sectorId) || sectorId < 0 || sectorId >= totalSectors) invalidWordContainer();
    return (sectorId + 1) * sectorSize;
  };
  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109 && fatSectorIds.length < fatSectorCount; index += 1) {
    const sectorId = data.readUInt32LE(76 + index * 4);
    if (sectorId === CFB_FREE_SECTOR) continue;
    fatSectorIds.push(sectorId);
  }
  let difatSector = firstDifatSector;
  const seenDifatSectors = new Set<number>();
  const entriesPerDifatSector = sectorSize / 4 - 1;
  for (let chainIndex = 0; chainIndex < difatSectorCount; chainIndex += 1) {
    if (difatSector === CFB_END_OF_CHAIN || seenDifatSectors.has(difatSector)) invalidWordContainer();
    seenDifatSectors.add(difatSector);
    const offset = sectorOffset(difatSector);
    ensureBufferRange(data, offset, sectorSize);
    for (let index = 0; index < entriesPerDifatSector && fatSectorIds.length < fatSectorCount; index += 1) {
      const sectorId = data.readUInt32LE(offset + index * 4);
      if (sectorId === CFB_FREE_SECTOR) continue;
      fatSectorIds.push(sectorId);
    }
    difatSector = data.readUInt32LE(offset + sectorSize - 4);
  }
  if (fatSectorIds.length !== fatSectorCount) invalidWordContainer();
  if (new Set(fatSectorIds).size !== fatSectorIds.length) invalidWordContainer();
  for (const sectorId of fatSectorIds) sectorOffset(sectorId);
  return fatSectorIds;
}

function validateLegacyDoc(data: Buffer): void {
  const oleSignature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (data.length < 512 || !data.subarray(0, 8).equals(oleSignature)) invalidWordContainer();
  const majorVersion = data.readUInt16LE(26);
  const byteOrder = data.readUInt16LE(28);
  const sectorShift = data.readUInt16LE(30);
  const miniSectorShift = data.readUInt16LE(32);
  if (
    byteOrder !== 0xfffe ||
    !((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12)) ||
    miniSectorShift !== 6
  ) {
    invalidWordContainer();
  }
  const sectorSize = 2 ** sectorShift;
  const miniSectorSize = 2 ** miniSectorShift;
  if (data.length < sectorSize || (data.length - sectorSize) % sectorSize !== 0) invalidWordContainer();
  const totalSectors = (data.length - sectorSize) / sectorSize;
  const fatSectorCount = data.readUInt32LE(44);
  const firstDirectorySector = data.readUInt32LE(48);
  const miniStreamCutoff = data.readUInt32LE(56);
  const firstMiniFatSector = data.readUInt32LE(60);
  const miniFatSectorCount = data.readUInt32LE(64);
  const firstDifatSector = data.readUInt32LE(68);
  const difatSectorCount = data.readUInt32LE(72);
  if (
    totalSectors === 0 ||
    fatSectorCount === 0 ||
    fatSectorCount > totalSectors ||
    difatSectorCount > totalSectors ||
    miniFatSectorCount > totalSectors ||
    miniStreamCutoff !== 4_096
  ) {
    invalidWordContainer();
  }
  const sectorOffset = (sectorId: number): number => {
    if (!Number.isInteger(sectorId) || sectorId < 0 || sectorId >= totalSectors) invalidWordContainer();
    return (sectorId + 1) * sectorSize;
  };
  const fatSectorIds = collectCompoundFatSectorIds(
    data,
    sectorSize,
    totalSectors,
    fatSectorCount,
    firstDifatSector,
    difatSectorCount,
  );
  const fat: number[] = [];
  for (const sectorId of fatSectorIds) {
    const offset = sectorOffset(sectorId);
    ensureBufferRange(data, offset, sectorSize);
    for (let index = 0; index < sectorSize / 4; index += 1) fat.push(data.readUInt32LE(offset + index * 4));
  }
  const readSectorChain = (startingSector: number, maximumSectors: number): number[] => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let sectorId = startingSector;
    while (sectorId !== CFB_END_OF_CHAIN) {
      if (
        chain.length >= maximumSectors ||
        sectorId === CFB_FREE_SECTOR ||
        sectorId === CFB_FAT_SECTOR ||
        sectorId === CFB_DIFAT_SECTOR ||
        seen.has(sectorId)
      ) {
        invalidWordContainer();
      }
      sectorOffset(sectorId);
      if (sectorId >= fat.length) invalidWordContainer();
      seen.add(sectorId);
      chain.push(sectorId);
      sectorId = fat[sectorId]!;
    }
    return chain;
  };
  const directoryChain = readSectorChain(firstDirectorySector, totalSectors);
  if (directoryChain.length === 0) invalidWordContainer();
  const directoryBuffer = Buffer.concat(
    directoryChain.map((sectorId) => data.subarray(sectorOffset(sectorId), sectorOffset(sectorId) + sectorSize)),
  );
  const directoryEntries: CompoundDirectoryEntry[] = [];
  for (let offset = 0, index = 0; offset + 128 <= directoryBuffer.length; offset += 128, index += 1) {
    const objectType = directoryBuffer[offset + 66]!;
    if (objectType === 0) {
      directoryEntries.push({
        index,
        name: "",
        objectType,
        leftSibling: CFB_NO_STREAM,
        rightSibling: CFB_NO_STREAM,
        child: CFB_NO_STREAM,
        startingSector: CFB_END_OF_CHAIN,
        streamSize: 0,
      });
      continue;
    }
    if (![1, 2, 5].includes(objectType)) invalidWordContainer();
    const nameLength = directoryBuffer.readUInt16LE(offset + 64);
    if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) invalidWordContainer();
    if (directoryBuffer.readUInt16LE(offset + nameLength - 2) !== 0) invalidWordContainer();
    const name = directoryBuffer.subarray(offset, offset + nameLength - 2).toString("utf16le");
    const streamSizeBigInt = directoryBuffer.readBigUInt64LE(offset + 120);
    if (streamSizeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) invalidWordContainer();
    directoryEntries.push({
      index,
      name,
      objectType,
      leftSibling: directoryBuffer.readUInt32LE(offset + 68),
      rightSibling: directoryBuffer.readUInt32LE(offset + 72),
      child: directoryBuffer.readUInt32LE(offset + 76),
      startingSector: directoryBuffer.readUInt32LE(offset + 116),
      streamSize: Number(streamSizeBigInt),
    });
  }
  const roots = directoryEntries.filter((entry) => entry.objectType === 5);
  const root = roots[0];
  if (roots.length !== 1 || !root || root.index !== 0 || root.name !== "Root Entry") invalidWordContainer();

  const directRootEntries: CompoundDirectoryEntry[] = [];
  const visitedDirectoryNodes = new Set<number>();
  const visitSiblingTree = (entryIndex: number): void => {
    if (entryIndex === CFB_NO_STREAM) return;
    if (entryIndex >= directoryEntries.length || visitedDirectoryNodes.has(entryIndex)) invalidWordContainer();
    visitedDirectoryNodes.add(entryIndex);
    const entry = directoryEntries[entryIndex]!;
    if (entry.objectType === 0 || entry.objectType === 5) invalidWordContainer();
    visitSiblingTree(entry.leftSibling);
    directRootEntries.push(entry);
    visitSiblingTree(entry.rightSibling);
  };
  visitSiblingTree(root.child);
  const wordDocument = directRootEntries.find(
    (entry) => entry.objectType === 2 && entry.name.toLowerCase() === "worddocument",
  );
  if (!wordDocument || wordDocument.streamSize < 32) invalidWordContainer();

  const readRegularStream = (startingSector: number, streamSize: number): Buffer => {
    if (streamSize === 0) return Buffer.alloc(0);
    if (streamSize > data.length) invalidWordContainer();
    const expectedSectorCount = Math.ceil(streamSize / sectorSize);
    const chain = readSectorChain(startingSector, expectedSectorCount + 1);
    if (chain.length !== expectedSectorCount) invalidWordContainer();
    return Buffer.concat(
      chain.map((sectorId) => data.subarray(sectorOffset(sectorId), sectorOffset(sectorId) + sectorSize)),
      chain.length * sectorSize,
    ).subarray(0, streamSize);
  };
  let miniFat: number[] | undefined;
  let rootMiniStream: Buffer | undefined;
  const readCompoundStream = (entry: CompoundDirectoryEntry): Buffer => {
    if (entry.streamSize >= miniStreamCutoff) return readRegularStream(entry.startingSector, entry.streamSize);
    if (entry.streamSize === 0 || miniFatSectorCount === 0) invalidWordContainer();
    if (!miniFat) {
      const miniFatChain = readSectorChain(firstMiniFatSector, miniFatSectorCount + 1);
      if (miniFatChain.length !== miniFatSectorCount) invalidWordContainer();
      miniFat = [];
      for (const sectorId of miniFatChain) {
        const offset = sectorOffset(sectorId);
        for (let index = 0; index < sectorSize / 4; index += 1) {
          miniFat.push(data.readUInt32LE(offset + index * 4));
        }
      }
      rootMiniStream = readRegularStream(root.startingSector, root.streamSize);
    }
    const output = Buffer.alloc(entry.streamSize);
    const expectedMiniSectorCount = Math.ceil(entry.streamSize / miniSectorSize);
    const seen = new Set<number>();
    let miniSectorId = entry.startingSector;
    let written = 0;
    for (let index = 0; index < expectedMiniSectorCount; index += 1) {
      if (
        miniSectorId === CFB_END_OF_CHAIN ||
        miniSectorId === CFB_FREE_SECTOR ||
        miniSectorId >= miniFat.length ||
        seen.has(miniSectorId)
      ) {
        invalidWordContainer();
      }
      seen.add(miniSectorId);
      const sourceOffset = miniSectorId * miniSectorSize;
      const bytesToCopy = Math.min(miniSectorSize, entry.streamSize - written);
      if (sourceOffset > rootMiniStream!.length - bytesToCopy) invalidWordContainer();
      rootMiniStream!.copy(output, written, sourceOffset, sourceOffset + bytesToCopy);
      written += bytesToCopy;
      miniSectorId = miniFat[miniSectorId]!;
    }
    if (miniSectorId !== CFB_END_OF_CHAIN) invalidWordContainer();
    return output;
  };

  const wordDocumentData = readCompoundStream(wordDocument);
  if (wordDocumentData.readUInt16LE(0) !== 0xa5ec) invalidWordContainer();
  const nFib = wordDocumentData.readUInt16LE(2);
  if (nFib < 0x0065 || nFib > 0x0200) invalidWordContainer();
  const selectedTableName = (wordDocumentData.readUInt16LE(10) & 0x0200) !== 0 ? "1table" : "0table";
  const selectedTable = directRootEntries.find(
    (entry) => entry.objectType === 2 && entry.name.toLowerCase() === selectedTableName,
  );
  if (!selectedTable || selectedTable.streamSize === 0) invalidWordContainer();
  readCompoundStream(selectedTable);
}

function validateWordFileContent(data: Buffer, isDocx: boolean): void {
  try {
    if (isDocx) validateDocxPackage(data);
    else validateLegacyDoc(data);
  } catch {
    throw BadRequest("El contenido no corresponde a un documento Word válido");
  }
}

/**
 * Serializes replacements even when no row exists yet. A row-level lock alone
 * cannot protect the first concurrent upload for a functionality; without this
 * lock, a later transaction can delete a just-created row while retaining no
 * record of its storage path for cleanup.
 */
export async function lockFormatReplacement(
  tx: { execute: (query: SQLWrapper | string) => PromiseLike<unknown> },
  subsystem: "pma" | "rgdp",
  functionality: FormatFunctionality
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${subsystem}:format`}), hashtext(${functionality}))`
  );
}

export async function readFormatUpload(req: FastifyRequest): Promise<{
  functionality: FormatFunctionality;
  functionalityLabel: string;
  fileName: string;
  data: Buffer;
  contentType: string;
}> {
  const fields: Record<string, string> = {};
  const seenFields = new Set<string>();
  let file: { fileName: string; data: Buffer; contentType: string } | null = null;
  // @fastify/multipart supports this per-request option at runtime, although
  // its `parts()` declaration currently exposes only the underlying Busboy
  // options. Keeping it in a variable avoids the declaration's excess-property
  // false positive while retaining the explicit fail-closed behavior.
  const multipartOptions = {
    throwFileSizeLimit: true,
    limits: {
      fileSize: FORMAT_MAX_BYTES,
      fieldSize: FORMAT_MULTIPART_FIELD_MAX_BYTES,
      fields: 1,
      files: 1,
      parts: 2,
    },
  };

  try {
    for await (const part of req.parts(multipartOptions)) {
      if (part.type === "field") {
        if (part.fieldnameTruncated || part.valueTruncated) {
          throw BadRequest("El campo de funcionalidad está truncado");
        }
        if (part.fieldname !== "functionality") throw BadRequest(`Campo no válido: ${part.fieldname}`);
        if (seenFields.has(part.fieldname)) throw BadRequest(`Campo duplicado: ${part.fieldname}`);
        if (typeof part.value !== "string") throw BadRequest("functionality debe ser texto");
        seenFields.add(part.fieldname);
        fields[part.fieldname] = part.value;
        continue;
      }

      // Reject invalid metadata before buffering the stream. Apart from saving
      // memory, this makes an invalid file field fail deterministically instead
      // of first consuming (or accepting) its payload.
      if (part.fieldname !== "file") throw BadRequest(`Campo de archivo no válido: ${part.fieldname}`);
      if (file) throw BadRequest("Solo se permite un archivo de formato");
      const fileName = part.filename.trim();
      if (fileName.length === 0 || fileName.length > 255) throw BadRequest("Nombre de archivo no válido");
      const isDocx = /\.docx$/i.test(fileName);
      const isDoc = /\.doc$/i.test(fileName);
      const canonicalMimeType = isDocx ? DOCX_MIME_TYPE : isDoc ? DOC_MIME_TYPE : null;
      const suppliedMimeType = part.mimetype.trim().toLowerCase();
      const isGenericMimeType = suppliedMimeType === "" || suppliedMimeType === "application/octet-stream";
      if (
        !canonicalMimeType ||
        !FORMAT_MIME_TYPES.has(suppliedMimeType) ||
        (!isGenericMimeType && suppliedMimeType !== canonicalMimeType)
      ) {
        throw BadRequest("Solo se permiten documentos Word .doc o .docx");
      }

      const data = await part.toBuffer();
      if ((part.file as { truncated?: boolean }).truncated || data.length > FORMAT_MAX_BYTES) {
        throw new HttpError(413, "El formato supera el límite de 20 MB");
      }
      if (data.length === 0) throw BadRequest("El archivo está vacío");
      validateWordFileContent(data, isDocx);
      file = { fileName, data, contentType: canonicalMimeType };
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      throw new HttpError(413, "El formato supera el límite de 20 MB");
    }
    if (code === "FST_FILES_LIMIT") throw BadRequest("Solo se permite un archivo de formato");
    if (code === "FST_FIELDS_LIMIT") throw BadRequest("Solo se permite el campo functionality");
    if (code === "FST_PARTS_LIMIT") throw BadRequest("El formulario contiene demasiadas partes");
    throw error;
  }

  if (!file) throw BadRequest("file required");
  const functionality = fields.functionality as FormatFunctionality;
  if (!Object.prototype.hasOwnProperty.call(FORMAT_FUNCTIONALITY_LABELS, functionality)) {
    throw BadRequest("functionality inválida");
  }
  return {
    functionality,
    functionalityLabel: FORMAT_FUNCTIONALITY_LABELS[functionality],
    ...file,
  };
}

export type FormatRowLike = {
  id: string;
  createdBy: string | null;
  functionality: FormatFunctionality;
  functionalityLabel: string;
  storagePath: string;
  fileName: string;
  uploadedAt: Date | string;
};

export function toFormatApi(row: FormatRowLike, driveUrl: string): Format {
  return {
    id: row.id,
    adminId: row.createdBy ?? "",
    createdBy: row.createdBy,
    functionality: row.functionality,
    functionalityLabel: row.functionalityLabel,
    driveFileId: row.storagePath,
    driveUrl,
    storagePath: row.storagePath,
    fileName: row.fileName,
    formatsFolderId: row.storagePath.split("/").slice(0, -1).join("/"),
    uploadedAt:
      row.uploadedAt instanceof Date
        ? row.uploadedAt.toISOString()
        : new Date(row.uploadedAt).toISOString(),
  };
}
