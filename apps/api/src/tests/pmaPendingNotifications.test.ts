import assert from "node:assert/strict";
import test from "node:test";
import { enabledPeriodKeys } from "../modules/pma/periodComplianceModule.js";
import {
  getPeriodBounds,
  getPeriodKey,
  getPeriodMonthKeys,
  getPlanCalendar,
  getPlanPeriods,
  monthKeyOf,
  monthLabelOf,
} from "../modules/pma/planSchedule.js";
import {
  MAX_BODY_LENGTH,
  MAX_CC_RECIPIENTS,
  MAX_SUBJECT_LENGTH,
  expandRecipientTokens,
  normalizeCcEmails,
  sanitizeBody,
  sanitizeSubject,
} from "../modules/pma/pendingNotificationsModule.js";

// 6-month plan starting Mar 2024; frozen "today" = mid Jul 2026 (Galápagos).
const PLAN = {
  reportPer: "6 meses",
  startDate: "2024-03-01",
  createdAt: new Date("2024-03-01T00:00:00Z"),
};
const NOW = new Date("2026-07-15T12:00:00Z");

test("period keys are the same strings periodCompliance already accepts", () => {
  const calendar = getPlanCalendar(PLAN, NOW);
  const keys = getPlanPeriods(calendar).map((period) => period.key);

  // Parity is the point: a key produced here is a key the compliance endpoint
  // validates, so the two features cannot drift into separate spellings.
  assert.deepEqual([...keys].sort(), [...enabledPeriodKeys(PLAN, NOW)].sort());
  // Regression guard for the CLDR abbreviation the web browser sends.
  assert.ok(keys.includes("sept 2024-feb 2025"), 'September block must be "sept 2024-feb 2025"');
  assert.ok(!keys.includes("sep 2024-feb 2025"), 'must not fall back to the "sep" spelling');
  // The period in progress reads as its whole block, not clipped at July.
  assert.equal(keys[keys.length - 1], "mar-ago 2026");
});

test("period keys carry their own block index, independent of array position", () => {
  const calendar = getPlanCalendar(PLAN, NOW);
  const periods = getPlanPeriods(calendar);
  for (const period of periods) {
    assert.equal(period.key, getPeriodKey(calendar, period.blockIndex));
  }
  assert.deepEqual(periods.map((period) => period.blockIndex), [0, 1, 2, 3, 4]);
});

test("a period covers exactly its block of months, first to last", () => {
  const calendar = getPlanCalendar(PLAN, NOW);

  // Block 2 of a 6-month plan starting Mar 2024 is mar–ago 2025.
  assert.deepEqual(getPeriodMonthKeys(calendar, 2), [
    "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08",
  ]);
  assert.equal(getPeriodKey(calendar, 2), "mar-ago 2025");

  // The deadline shown in the email is the period's last month, even for the
  // period in progress — the block is not clipped at today.
  const current = getPeriodBounds(calendar, calendar.currentBlockIndex);
  assert.equal(monthKeyOf(current.endIndex), "2026-08");
  assert.equal(monthLabelOf(current.endIndex), "ago 2026");
});

test("every started period is offered, including the one in progress", () => {
  const calendar = getPlanCalendar(PLAN, NOW);
  const periods = getPlanPeriods(calendar);

  // The criterion is "no compliance row", and the period in progress is
  // included deliberately: a reporter can be chased before it closes.
  assert.equal(periods[periods.length - 1].blockIndex, calendar.currentBlockIndex);
  assert.equal(periods[periods.length - 1].key, "mar-ago 2026");
  // Periods that have not begun are never offered.
  assert.ok(periods.every((period) => period.blockIndex <= calendar.currentBlockIndex));
});

test("a plan whose start month is still in the future exposes only its first period", () => {
  const future = {
    reportPer: "6 meses",
    startDate: "2027-01-01",
    createdAt: new Date("2027-01-01T00:00:00Z"),
  };
  const calendar = getPlanCalendar(future, NOW);
  assert.deepEqual(getPlanPeriods(calendar).map((period) => period.key), ["ene-jun 2027"]);
});

test("subject sanitising blocks header injection and caps length", () => {
  assert.equal(
    sanitizeSubject("Actividades\r\nBcc: attacker@example.com"),
    "Actividades Bcc: attacker@example.com",
  );
  assert.equal(sanitizeSubject("  espacios   colapsados  "), "espacios colapsados");
  assert.equal(sanitizeSubject("a".repeat(500)).length, MAX_SUBJECT_LENGTH);
  assert.equal(sanitizeSubject("\u0000\u001B[31m"), "[31m");
});

test("body sanitising keeps the operator's newlines and drops control characters", () => {
  assert.equal(sanitizeBody("Hola\r\n\r\nRevisa esto"), "Hola\n\nRevisa esto");
  assert.equal(sanitizeBody("linea1\n\n\n\n\nlinea2"), "linea1\n\nlinea2");
  assert.equal(sanitizeBody("texto\u200Bcon\u0000basura"), "textoconbasura");
  assert.equal(sanitizeBody("a".repeat(9000)).length, MAX_BODY_LENGTH);
  assert.equal(sanitizeBody("  \n  espacios  \n  "), "espacios");
});

test("the {nombre} token is expanded per recipient and nothing else is", () => {
  const body = "Estimado/a {nombre}\n\nSaludos, {nombre}.";
  assert.equal(expandRecipientTokens(body, "Ana Vera"), "Estimado/a Ana Vera\n\nSaludos, Ana Vera.");
  // An unnamed user still gets a grammatical greeting rather than an empty one.
  assert.equal(expandRecipientTokens("Estimado/a {nombre}", "   "), "Estimado/a reportero");
  // Any other brace-looking text belongs to the operator and is left alone.
  assert.equal(expandRecipientTokens("Plan {plan} de {NOMBRE}", "Ana"), "Plan {plan} de {NOMBRE}");
});

test("copy addresses are validated, trimmed and deduplicated", () => {
  assert.deepEqual(normalizeCcEmails([]), []);
  assert.deepEqual(normalizeCcEmails(["  ana@ejemplo.com  ", ""]), ["ana@ejemplo.com"]);
  // Same mailbox, different casing: copied once, in the spelling first typed.
  assert.deepEqual(
    normalizeCcEmails(["Ana@Ejemplo.com", "ana@ejemplo.com", "luis@ejemplo.com"]),
    ["Ana@Ejemplo.com", "luis@ejemplo.com"],
  );
  assert.deepEqual(
    normalizeCcEmails(["a.b-c+tag@sub.dominio.gob.ec"]),
    ["a.b-c+tag@sub.dominio.gob.ec"],
  );
});

test("a copy address that could smuggle a second recipient or header is rejected", () => {
  const rejected = [
    "no-es-un-correo",
    "sin-tld@dominio",
    "espacio en@medio.com",
    "uno@a.com, dos@b.com",
    "uno@a.com; dos@b.com",
    "Nombre <uno@a.com>",
    "uno@a.com\nBcc: oculto@b.com",
    `${"a".repeat(250)}@ejemplo.com`,
  ];
  for (const value of rejected) {
    assert.throws(() => normalizeCcEmails([value]), /no es un correo válido/, `debe rechazar: ${value}`);
  }
});

test("the copy list is capped after deduplication, not before", () => {
  const dupes = Array.from({ length: MAX_CC_RECIPIENTS * 2 }, () => "ana@ejemplo.com");
  assert.deepEqual(normalizeCcEmails(dupes), ["ana@ejemplo.com"]);

  const distinct = Array.from({ length: MAX_CC_RECIPIENTS + 1 }, (_, i) => `u${i}@ejemplo.com`);
  assert.throws(() => normalizeCcEmails(distinct), /más de 20 correos/);
});
