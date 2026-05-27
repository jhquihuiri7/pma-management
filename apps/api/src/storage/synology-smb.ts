import { promises as fs, createReadStream } from "node:fs";
import { join, dirname, normalize, resolve, sep } from "node:path";
import type { StorageProvider } from "./index.js";

/**
 * Filesystem-backed storage. In production this points at an SMB mount of the
 * Synology share (e.g. /mnt/synology/pma-data) and the OS does the network I/O.
 * In development it points at a local directory.
 *
 * All storage-relative paths must be POSIX-style ("a/b/c.pdf"). The class
 * normalizes them and refuses anything that would escape STORAGE_ROOT.
 */
export class SynologySmbStorage implements StorageProvider {
  private readonly root: string;

  constructor(root: string, private readonly publicBaseUrl: string) {
    this.root = resolve(root);
  }

  private absolute(p: string): string {
    const safe = normalize(p).replace(/^[/\\]+/, "");
    const abs = resolve(join(this.root, safe));
    // Compare against root + separator so a sibling dir sharing the root's name
    // (e.g. "/data/storage-secret" vs root "/data/storage") cannot pass a bare
    // prefix check via "../storage-secret/...".
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      throw new Error(`Refusing path outside storage root: ${p}`);
    }
    return abs;
  }

  async upload({ path, data }: { path: string; data: Buffer | Uint8Array; contentType?: string }): Promise<void> {
    const abs = this.absolute(path);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }

  async download(path: string): Promise<Buffer> {
    return fs.readFile(this.absolute(path));
  }

  async delete(path: string): Promise<void> {
    try {
      await fs.unlink(this.absolute(path));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }

  async deleteDir(path: string): Promise<void> {
    try {
      await fs.rm(this.absolute(path), { recursive: true, force: true });
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.absolute(path));
      return true;
    } catch {
      return false;
    }
  }

  async stream(path: string): Promise<NodeJS.ReadableStream> {
    return createReadStream(this.absolute(path));
  }

  getUrl(path: string): string {
    const clean = path.replace(/^[/\\]+/, "");
    return `${this.publicBaseUrl.replace(/\/+$/, "")}/${clean}`;
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    const from = this.absolute(fromPath);
    const to = this.absolute(toPath);
    await fs.mkdir(dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async list(path: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>> {
    const abs = this.absolute(path);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const out: Array<{ name: string; isDirectory: boolean; size: number }> = [];
    for (const e of entries) {
      let size = 0;
      if (e.isFile()) {
        const st = await fs.stat(join(abs, e.name));
        size = st.size;
      }
      out.push({ name: e.name, isDirectory: e.isDirectory(), size });
    }
    return out;
  }
}
