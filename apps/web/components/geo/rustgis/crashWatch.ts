/**
 * Notices when RustGIS stops for good inside our same-origin iframe.
 *
 * RustGIS is WebAssembly built with `panic = "abort"`: an internal error (a
 * panic, or memory running out) ends the app at once. eframe stops drawing and
 * the canvas stays frozen on its last frame with no message, and the bridge is
 * never answered again. The page still holds the last project RustGIS posted, so
 * it can say what happened and start RustGIS again with that project.
 *
 * Two signs, whichever comes first: the panic message eframe writes with
 * `console.error` ("panicked at …"), and the uncaught WebAssembly trap
 * (`RuntimeError: unreachable`) the browser reports on the frame's window.
 */

export interface RustgisCrash {
  /** What RustGIS or the browser said, trimmed for display. */
  message: string;
}

/** The parts of the iframe's window the watch uses. */
export interface WatchedWindow {
  console: { error: (...args: unknown[]) => void };
  addEventListener(type: "error", listener: (event: { error?: unknown; message?: string }) => void): void;
  removeEventListener(type: "error", listener: (event: { error?: unknown; message?: string }) => void): void;
}

const MAX_MESSAGE = 600;

function trim(text: string): string {
  const clean = text.trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error || (typeof value === "object" && value !== null && "message" in value)) {
    const v = value as { name?: unknown; message?: unknown };
    const name = typeof v.name === "string" ? v.name : "";
    const message = typeof v.message === "string" ? v.message : "";
    return name && message ? `${name}: ${message}` : name || message;
  }
  return String(value ?? "");
}

/** A `console.error` line that is a Rust panic's report. */
export function panicMessage(args: unknown[]): string | null {
  const text = args.map(textOf).join(" ");
  const at = text.indexOf("panicked at");
  return at >= 0 ? trim(text.slice(at)) : null;
}

/**
 * An uncaught error that ends a WebAssembly app: the trap a panic or a failed
 * allocation leaves (`RuntimeError`, from the frame's realm, so matched by name).
 */
export function trapMessage(event: { error?: unknown; message?: string }): string | null {
  const error = event.error as { name?: unknown } | undefined;
  const name = typeof error?.name === "string" ? error.name : "";
  const message = textOf(event.error) || event.message || "";
  if (name === "RuntimeError" || /\bRuntimeError\b/.test(message) || /\bunreachable\b/.test(message)) {
    return trim(message || "RuntimeError");
  }
  return null;
}

/**
 * Watches one window of the iframe (a new one after each navigation) and calls
 * `onCrash` once. Returns the function that stops watching and puts the
 * window's `console.error` back.
 */
export function watchRustgisWindow(win: WatchedWindow, onCrash: (crash: RustgisCrash) => void): () => void {
  let reported = false;
  let panic: string | null = null;
  const report = (message: string) => {
    if (reported) return;
    reported = true;
    onCrash({ message });
  };
  const original = win.console.error;
  const wrapped = (...args: unknown[]) => {
    const found = panicMessage(args);
    if (found) {
      panic = found;
      report(found);
    }
    original.apply(win.console, args);
  };
  win.console.error = wrapped;
  const onError = (event: { error?: unknown; message?: string }) => {
    const trap = trapMessage(event);
    // The panic's own report says more than the trap that follows it.
    if (trap) report(panic ?? trap);
  };
  win.addEventListener("error", onError);
  return () => {
    win.removeEventListener("error", onError);
    if (win.console.error === wrapped) win.console.error = original;
  };
}
