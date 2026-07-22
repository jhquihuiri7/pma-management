import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { StorageProvider } from "../storage/index.js";
import {
  buildEvidencePath,
  buildFormatPath,
  persistFileAndRecord,
  StorageUploadTooLargeError,
} from "../storage/index.js";
import { SynologySmbStorage } from "../storage/synology-smb.js";

class MemoryStorage implements StorageProvider {
  readonly files = new Map<string, Buffer>();
  ignoreDelete = false;

  async upload({ path, data }: { path: string; data: Buffer | Uint8Array }): Promise<void> {
    this.files.set(path, Buffer.from(data));
  }
  async uploadStream(): Promise<number> { throw new Error("not implemented"); }
  async download(path: string): Promise<Buffer> { return this.files.get(path) ?? Buffer.alloc(0); }
  async delete(path: string): Promise<void> { if (!this.ignoreDelete) this.files.delete(path); }
  async deleteDir(): Promise<void> { throw new Error("not implemented"); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async stream(): Promise<NodeJS.ReadableStream> { throw new Error("not implemented"); }
  async stat(path: string): Promise<{ size: number; modifiedAt: Date }> {
    const file = this.files.get(path);
    if (!file) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return { size: file.length, modifiedAt: new Date() };
  }
  getUrl(path: string): string { return `/storage/${path}`; }
  resolve(path: string): string { return path; }
  async move(): Promise<void> { throw new Error("not implemented"); }
  async list(): Promise<Array<{ name: string; isDirectory: boolean; size: number }>> { return []; }
}

test("evidence and format paths are UUID-namespaced", () => {
  const common = {
    subsystem: "pma" as const,
    planId: "plan-a",
    planName: "Plan / Norte",
    planItemId: "item-a",
    planItemName: "Medida / 1",
    periodFolder: "ene2026-jun2026",
    fileName: "informe.pdf",
  };
  const first = buildEvidencePath({ ...common, evidenceId: "evidence-a" });
  const second = buildEvidencePath({ ...common, evidenceId: "evidence-b" });
  assert.notEqual(first, second);
  assert.match(first, /_evidences\/evidence-a\/informe\.pdf$/);
  assert.notEqual(
    buildFormatPath({ subsystem: "pma", formatId: "format-a", fileName: "formato.xlsx" }),
    buildFormatPath({ subsystem: "pma", formatId: "format-b", fileName: "formato.xlsx" })
  );
});

test("storage path components stay within 255 UTF-8 bytes with stable collision-resistant suffixes", () => {
  const asciiPrefix = "A".repeat(320);
  const asciiFirst = buildEvidencePath({
    subsystem: "pma",
    planId: "plan-a",
    planName: `${asciiPrefix}-first`,
    evidenceId: "evidence-a",
    fileName: "report.pdf",
  });
  const asciiSecond = buildEvidencePath({
    subsystem: "pma",
    planId: "plan-a",
    planName: `${asciiPrefix}-second`,
    evidenceId: "evidence-a",
    fileName: "report.pdf",
  });
  const unicodeFileName = `${"á".repeat(250)}.docx`;
  const unicodePath = buildFormatPath({
    subsystem: "rgdp",
    formatId: "format-a",
    fileName: unicodeFileName,
  });

  for (const path of [asciiFirst, asciiSecond, unicodePath]) {
    for (const component of path.split("/")) {
      assert.ok(
        Buffer.byteLength(component, "utf8") <= 255,
        `component exceeds 255 UTF-8 bytes: ${component}`,
      );
    }
  }

  assert.equal(
    asciiFirst,
    buildEvidencePath({
      subsystem: "pma",
      planId: "plan-a",
      planName: `${asciiPrefix}-first`,
      evidenceId: "evidence-a",
      fileName: "report.pdf",
    }),
  );
  assert.notEqual(asciiFirst, asciiSecond);
  assert.match(asciiFirst.split("/")[1], /-[0-9a-f]{12}$/);
  assert.match(unicodePath.split("/").at(-1) ?? "", /-[0-9a-f]{12}\.docx$/);
});

test("database failure removes and verifies the uploaded file", async () => {
  const storage = new MemoryStorage();
  const dbError = new Error("database unavailable");
  await assert.rejects(
    persistFileAndRecord({
      path: "PMA/plan/_evidences/id/file.pdf",
      data: Buffer.from("payload"),
      storage,
      persist: async () => { throw dbError; },
    }),
    dbError
  );
  assert.equal(await storage.exists("PMA/plan/_evidences/id/file.pdf"), false);
});

test("an existing object is never overwritten or compensated away", async () => {
  const storage = new MemoryStorage();
  const path = "PMA/plan/_evidences/collision/file.pdf";
  storage.files.set(path, Buffer.from("original"));
  await assert.rejects(
    persistFileAndRecord({
      path,
      data: Buffer.from("replacement"),
      storage,
      persist: async () => undefined,
    }),
    /Refusing to overwrite/
  );
  assert.equal((await storage.download(path)).toString(), "original");
});

test("a truncated storage write is rejected and compensated", async () => {
  const storage = new MemoryStorage();
  storage.upload = async ({ path }) => { storage.files.set(path, Buffer.from("x")); };
  let persisted = false;
  await assert.rejects(
    persistFileAndRecord({
      path: "PMA/plan/_evidences/id/truncated.pdf",
      data: Buffer.from("complete payload"),
      storage,
      persist: async () => { persisted = true; },
    }),
    /Storage size mismatch/
  );
  assert.equal(persisted, false);
  assert.equal(await storage.exists("PMA/plan/_evidences/id/truncated.pdf"), false);
});

test("failed storage compensation is surfaced", async () => {
  const storage = new MemoryStorage();
  storage.ignoreDelete = true;
  await assert.rejects(
    persistFileAndRecord({
      path: "RGDP/plan/_evidences/id/file.pdf",
      data: Buffer.from("payload"),
      storage,
      persist: async () => { throw new Error("database unavailable"); },
    }),
    (error: unknown) => error instanceof AggregateError && error.errors.length === 2
  );
});

test("streaming uploads enforce the byte limit before writing the oversized chunk", async () => {
  const root = await mkdtemp(join(tmpdir(), "pma-storage-stream-"));
  const storage = new SynologySmbStorage(root, "/storage");
  try {
    const exact = await storage.uploadStream(
      "raster/exact.bin",
      Readable.from([Buffer.from("12345")]),
      { maxBytes: 5 },
    );
    assert.equal(exact, 5);

    await assert.rejects(
      storage.uploadStream(
        "raster/oversized.bin",
        Readable.from([Buffer.from("1234"), Buffer.from("5678")]),
        { maxBytes: 5 },
      ),
      (error: unknown) => error instanceof StorageUploadTooLargeError && error.maxBytes === 5,
    );
    assert.ok((await storage.stat("raster/oversized.bin")).size <= 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
