export interface StorageProvider {
  /** Write a file at the given storage-relative path. Creates parent dirs. */
  upload(args: { path: string; data: Buffer | Uint8Array; contentType?: string }): Promise<void>;

  /** Read a file from the storage-relative path. */
  download(path: string): Promise<Buffer>;

  /** Delete a file (no-op if it does not exist). */
  delete(path: string): Promise<void>;

  /** Delete a directory recursively (no-op if it does not exist). */
  deleteDir(path: string): Promise<void>;

  /** Check existence. */
  exists(path: string): Promise<boolean>;

  /** Stream a file. */
  stream(path: string): Promise<NodeJS.ReadableStream>;

  /** Get a public URL for the file (proxied through the API). */
  getUrl(path: string): string;

  /** Move/rename a file or directory inside storage. */
  move(fromPath: string, toPath: string): Promise<void>;

  /** List entries inside a directory (non-recursive). */
  list(path: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>>;
}

import { SynologySmbStorage } from "./synology-smb.js";
import { env } from "../lib/env.js";

let _provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!_provider) {
    _provider = new SynologySmbStorage(env.STORAGE_ROOT, env.STORAGE_PUBLIC_BASE_URL);
  }
  return _provider;
}

export function buildEvidencePath(args: {
  adminId: string;
  subsystem: "pma" | "rgdp" | "pglp";
  planId: string;
  planItemId?: string;
  fileName: string;
}): string {
  const item = args.planItemId ?? "_plan";
  return `${args.adminId}/${args.subsystem}/${args.planId}/${item}/${args.fileName}`;
}

export function buildFormatPath(args: {
  adminId: string;
  subsystem: "pma" | "rgdp" | "pglp";
  fileName: string;
}): string {
  return `${args.adminId}/${args.subsystem}/_formats/${args.fileName}`;
}
