const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const KG_SCALE = 1_000;

function toScaledKg(value: number): number {
  return Math.round(value * KG_SCALE);
}

export function currentMonthKey(
  now = new Date(),
  timeZone = "Pacific/Galapagos"
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Could not determine current month");
  return `${year}-${month}`;
}

export function validateMonthlyGenerationPeriod(args: {
  periodKey: string;
  planStartMonth: string;
  currentMonth?: string;
}): void {
  const current = args.currentMonth ?? currentMonthKey();
  if (!PERIOD_KEY_PATTERN.test(args.periodKey)) {
    throw new Error("periodKey debe tener formato YYYY-MM");
  }
  if (!PERIOD_KEY_PATTERN.test(args.planStartMonth)) {
    throw new Error("El proyecto no tiene un mes inicial válido");
  }
  if (args.periodKey < args.planStartMonth) {
    throw new Error("El período no puede ser anterior al inicio del proyecto");
  }
  if (args.periodKey > current) {
    throw new Error("No se puede registrar generación en un mes futuro");
  }
}

/**
 * Calculates the resulting total for the calendar year of `periodKey`, replacing
 * an existing value for that same month instead of double counting it.
 */
export function calculateAnnualGenerationTotal(args: {
  periodKey: string;
  generationKg: number;
  records: Array<{ periodKey: string; generationKg: number }>;
}): number {
  const yearPrefix = `${args.periodKey.slice(0, 4)}-`;
  let scaled = 0;
  for (const record of args.records) {
    if (!record.periodKey.startsWith(yearPrefix) || record.periodKey === args.periodKey) continue;
    scaled += toScaledKg(record.generationKg);
  }
  scaled += toScaledKg(args.generationKg);
  return scaled / KG_SCALE;
}

export function exceedsAnnualGenerationLimit(totalKg: number, limitKg: number): boolean {
  return toScaledKg(totalKg) > toScaledKg(limitKg);
}
