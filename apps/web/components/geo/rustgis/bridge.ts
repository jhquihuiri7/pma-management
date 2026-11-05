/**
 * The page's side of RustGIS's `?embed` bridge (apps/rustgis-web/src/embed.rs of
 * the patched build in infra/rustgis):
 *
 *   page → app   {"rustgis":"run","id","command","params"}   (ui.* commands only)
 *                {"rustgis":"project","id","text"}           (replace the project; with id → result)
 *   app → page   {"rustgis":"ready"} · {"rustgis":"project","text"} · {"rustgis":"result","id","ok","value"|"error"}
 *
 * Only messages from our iframe's window and our own origin are taken: RustGIS
 * trusts whichever page writes to it first, so the page must be just as strict.
 */

export type BridgeMessage =
  | { rustgis: "ready" }
  | { rustgis: "project"; text: string }
  | { rustgis: "result"; id: unknown; ok: boolean; value?: unknown; error?: string };

export interface BridgeTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BridgeOptions {
  /** The iframe's window (its contentWindow). */
  target: () => BridgeTarget | null;
  /** Our origin: messages must come from it and are sent to it. */
  origin: string;
  /** The global to listen on (window). */
  host: {
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  };
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export class BridgeError extends Error {
  constructor(message: string, readonly kind: "timeout" | "app" | "closed") {
    super(message);
    this.name = "BridgeError";
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  switch (message.rustgis) {
    case "ready":
      return { rustgis: "ready" };
    case "project":
      return typeof message.text === "string" ? { rustgis: "project", text: message.text } : null;
    case "result":
      return typeof message.ok === "boolean"
        ? {
            rustgis: "result",
            id: message.id,
            ok: message.ok,
            value: message.value,
            error: typeof message.error === "string" ? message.error : undefined,
          }
        : null;
    default:
      return null;
  }
}

export class RustgisBridge {
  private readonly pending = new Map<number, Pending>();
  private readonly projectListeners = new Set<(text: string) => void>();
  private readonly readyWaiters = new Set<() => void>();
  private nextId = 1;
  private ready = false;
  private closed = false;
  private readonly set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clear: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly listener = (event: MessageEvent) => this.receive(event);

  constructor(private readonly options: BridgeOptions) {
    const set = options.setTimeout ?? setTimeout;
    const clear = options.clearTimeout ?? clearTimeout;
    // Called as plain functions: a browser's setTimeout called as a method of
    // another object (`this.set(…)`) throws "Illegal invocation".
    this.set = (fn, ms) => set(fn, ms);
    this.clear = (timer) => clear(timer);
    options.host.addEventListener("message", this.listener);
  }

  get isReady(): boolean {
    return this.ready;
  }

  close(): void {
    this.closed = true;
    this.options.host.removeEventListener("message", this.listener);
    this.pending.forEach((p) => {
      this.clear(p.timer);
      p.reject(new BridgeError("El Workspace se cerró", "closed"));
    });
    this.pending.clear();
    this.projectListeners.clear();
    this.readyWaiters.clear();
  }

  /**
   * RustGIS answered something, so it is listening: the `ready` it posts once at
   * start-up may have gone before this page listened.
   */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.readyWaiters.forEach((done) => done());
    this.readyWaiters.clear();
  }

  /** Every project RustGIS posts (after a change settles, pans included). */
  onProject(listener: (text: string) => void): () => void {
    this.projectListeners.add(listener);
    return () => this.projectListeners.delete(listener);
  }

  whenReady(timeoutMs = 60_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = this.set(() => {
        this.readyWaiters.delete(done);
        reject(new BridgeError("RustGIS no terminó de cargar", "timeout"));
      }, timeoutMs);
      const done = () => {
        this.clear(timer);
        resolve();
      };
      this.readyWaiters.add(done);
    });
  }

  /** Runs one of RustGIS's interface commands (ui.*). */
  run(command: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<unknown> {
    return this.request({ rustgis: "run", command, params }, timeoutMs);
  }

  /** Replaces the project; resolves once RustGIS confirms it opened. */
  openProject(text: string, timeoutMs = 90_000): Promise<unknown> {
    return this.request({ rustgis: "project", text }, timeoutMs);
  }

  private request(message: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.closed) return Promise.reject(new BridgeError("El Workspace se cerró", "closed"));
    const target = this.options.target();
    if (!target) return Promise.reject(new BridgeError("RustGIS no está cargado", "closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = this.set(() => {
        this.pending.delete(id);
        reject(new BridgeError("RustGIS no respondió a tiempo", "timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      target.postMessage({ ...message, id }, this.options.origin);
    });
  }

  private receive(event: MessageEvent): void {
    if (this.closed) return;
    const target = this.options.target();
    if (!target || event.source !== (target as unknown) || event.origin !== this.options.origin) return;
    const message = parseBridgeMessage(event.data);
    if (!message) return;
    if (message.rustgis === "ready") {
      this.markReady();
      return;
    }
    if (message.rustgis === "project") {
      this.projectListeners.forEach((listener) => listener(message.text));
      return;
    }
    const id = typeof message.id === "number" ? message.id : NaN;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.clear(pending.timer);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new BridgeError(message.error || "RustGIS rechazó la operación", "app"));
  }
}
