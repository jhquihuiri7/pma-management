/**
 * JS `Date` parses "YYYY-MM-DD" as UTC, which can shift the day when rendered
 * in a negative timezone. These helpers treat "YYYY-MM-DD" as a local date.
 */

export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;

  // Fast-path for "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1; // 0-based
    const day = Number(m[3]);
    const d = new Date(year, monthIndex, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateOnly(
  value?: string | null,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = parseDateOnly(value);
  if (!d) return "";
  return d.toLocaleDateString(locales, options);
}

