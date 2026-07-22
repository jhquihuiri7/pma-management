import { Readable } from "node:stream";

type ZipEntry = {
  name: string;
  data: Buffer;
  modifiedAt?: Date;
};

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(data: Buffer): number {
  return (crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

function crc32Update(crc: number, data: Buffer): number {
  let c = crc;
  for (const byte of data) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

function ensureUint32(value: number, label: string) {
  if (value > 0xffffffff) throw new Error(`${label} is too large for ZIP32`);
}

export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    ensureUint32(data.length, entry.name);
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
    ensureUint32(offset, "ZIP offset");
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  ensureUint32(centralSize, "ZIP central directory");
  ensureUint32(centralOffset, "ZIP central offset");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

export type ZipStreamEntry = {
  name: string;
  size: number;
  modifiedAt?: Date;
  open: () => Promise<NodeJS.ReadableStream>;
};

/**
 * Build an uncompressed ZIP as a stream. Data descriptors let us calculate CRC
 * while forwarding each source, so neither the evidence files nor the final ZIP
 * are buffered in API memory. `size` is preflighted by the caller and verified
 * again while streaming; a disappearing/truncated NAS file aborts the response.
 */
export function createZipStream(entries: ZipStreamEntry[]): Readable {
  if (entries.length > 0xffff) throw new Error("ZIP has too many entries");
  return Readable.from(streamZip(entries));
}

async function* streamZip(entries: ZipStreamEntry[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    ensureUint32(entry.size, entry.name);
    const name = Buffer.from(entry.name, "utf8");
    if (name.length > 0xffff) throw new Error(`ZIP filename is too long: ${entry.name}`);
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date());
    const localOffset = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // bit 3: CRC/sizes follow in a data descriptor; bit 11: UTF-8 filename.
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    yield local;
    yield name;
    offset += local.length + name.length;

    let crc = 0xffffffff;
    let streamed = 0;
    const source = await entry.open();
    for await (const rawChunk of source as unknown as AsyncIterable<Buffer | Uint8Array | string>) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      streamed += chunk.length;
      if (streamed > entry.size) throw new Error(`File grew while creating ZIP: ${entry.name}`);
      crc = crc32Update(crc, chunk);
      yield chunk;
      offset += chunk.length;
      ensureUint32(offset, "ZIP offset");
    }
    if (streamed !== entry.size) throw new Error(`File size changed while creating ZIP: ${entry.name}`);
    const finalCrc = (crc ^ 0xffffffff) >>> 0;

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(finalCrc, 4);
    descriptor.writeUInt32LE(streamed, 8);
    descriptor.writeUInt32LE(streamed, 12);
    yield descriptor;
    offset += descriptor.length;

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0808, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(finalCrc, 16);
    header.writeUInt32LE(streamed, 20);
    header.writeUInt32LE(streamed, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(localOffset, 42);
    central.push(header, name);
  }

  const centralOffset = offset;
  for (const part of central) {
    yield part;
    offset += part.length;
  }
  const centralSize = offset - centralOffset;
  ensureUint32(centralSize, "ZIP central directory");
  ensureUint32(centralOffset, "ZIP central offset");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  yield end;
}
