/** Returns a same-origin path or null, including protection against `//` and backslash variants. */
export function safeInternalRedirect(
  candidate: string | null | undefined,
  origin = "http://localhost"
): string | null {
  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return null;
  }

  try {
    const base = new URL(origin);
    const target = new URL(candidate, base);
    if (target.origin !== base.origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
