import assert from "node:assert/strict";
import test from "node:test";
import {
  adminPuedeReportar,
  avisoAcumulado,
  corteCerrado,
  corteDeMes,
  corteEnCarga,
  cortesVencidos,
  estadoCorte,
  finDelDia,
  mesBloqueado,
  plazoBase,
  plazoEfectivo,
  trimestreDeMes,
  type AnioCortes,
} from "../modules/pg2030/cortes.js";

const at = (iso: string) => new Date(iso);

test("base deadlines fall on the last day of the month after each quarter, T4 in the next year", () => {
  assert.equal(plazoBase(2026, 1), "2026-04-30");
  assert.equal(plazoBase(2026, 2), "2026-07-31");
  assert.equal(plazoBase(2026, 3), "2026-10-31");
  assert.equal(plazoBase(2026, 4), "2027-01-31");
  assert.deepEqual([1, 3, 4, 6, 7, 12].map(trimestreDeMes), [1, 1, 2, 2, 3, 4]);
  assert.throws(() => trimestreDeMes(13));
});

test("a deadline day ends at 00:00 of the next day in Galápagos (06:00Z)", () => {
  assert.equal(finDelDia("2026-04-30").toISOString(), "2026-05-01T06:00:00.000Z");
  assert.equal(finDelDia("2027-01-31").toISOString(), "2027-02-01T06:00:00.000Z");
  assert.equal(finDelDia("2028-02-28").toISOString(), "2028-02-29T06:00:00.000Z");
  // The fixed offset matches the IANA zone at those instants.
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Galapagos", hour: "2-digit", hourCycle: "h23" });
  assert.equal(hour.format(finDelDia("2026-04-30")), "00");
  assert.equal(hour.format(finDelDia("2026-10-31")), "00");

  const t1 = { anio: 2026, primerCorte: 1 as const, fechaLimiteCarga: null };
  assert.equal(mesBloqueado(t1, 3, null, at("2026-05-01T05:59:59.999Z")), false);
  assert.equal(mesBloqueado(t1, 3, null, at("2026-05-01T06:00:00.000Z")), true);
  // T4 of 2026 stays open through January 2027.
  assert.equal(mesBloqueado(t1, 12, null, at("2027-01-31T23:00:00Z")), false);
  assert.equal(mesBloqueado(t1, 12, null, at("2027-02-01T06:00:00Z")), true);
});

test("2026 opened from T2: January–March travel with T2 and the initial load keeps them open", () => {
  const cfg: AnioCortes = { anio: 2026, primerCorte: 2, fechaLimiteCarga: "2026-11-30" };
  assert.deepEqual([1, 2, 3, 4, 7, 10].map((m) => corteDeMes(cfg, m)), [2, 2, 2, 2, 3, 4]);

  // T2 (base 31-jul) and T3 (base 31-oct) fall before the load deadline; T4 (31-ene) does not.
  assert.deepEqual([1, 2, 3, 4].map((t) => corteEnCarga(cfg, t as 1)), [false, true, true, false]);
  assert.equal(plazoEfectivo(cfg, 2, null), "2026-11-30");
  assert.equal(plazoEfectivo(cfg, 4, null), "2027-01-31");

  const october = at("2026-10-12T15:00:00Z");
  assert.equal(mesBloqueado(cfg, 1, null, october), false, "January is still editable inside the load");
  assert.deepEqual([1, 2, 3, 4].map((t) => estadoCorte(cfg, t as 1, october)), ["no_habilitado", "en_carga", "en_carga", "abierto"]);
  assert.equal(adminPuedeReportar(cfg, 2, october), true);
  assert.equal(adminPuedeReportar(cfg, 11, october), false, "T4 is not in the load: only the institution reports");

  const december = at("2026-12-01T06:00:00Z");
  assert.equal(mesBloqueado(cfg, 1, null, december), true);
  assert.equal(mesBloqueado(cfg, 9, null, december), true);
  assert.equal(mesBloqueado(cfg, 10, null, december), false);
  assert.equal(corteCerrado(cfg, 2, december), true);
  assert.equal(adminPuedeReportar(cfg, 2, december), false, "the load is over");
});

test("a reopening pushes one institution's deadline without reopening the cutoff for everyone", () => {
  const cfg: AnioCortes = { anio: 2027, primerCorte: 1, fechaLimiteCarga: null };
  const mayo = at("2027-05-10T12:00:00Z");
  assert.equal(mesBloqueado(cfg, 2, null, mayo), true);
  assert.equal(mesBloqueado(cfg, 2, "2027-05-15", mayo), false);
  assert.equal(mesBloqueado(cfg, 2, "2027-05-15", at("2027-05-16T06:00:00Z")), true);
  // An old reopening never shortens the deadline.
  assert.equal(plazoEfectivo(cfg, 2, "2027-01-15"), "2027-07-31");
  // The cutoff counts as closed even while reopened, so changes go to the audit log.
  assert.equal(corteCerrado(cfg, 1, mayo), true);
});

test("opening a year late lists the habilitated cutoffs that already expired", () => {
  const now = at("2026-10-12T15:00:00Z");
  assert.deepEqual(cortesVencidos(2026, 2, now), [2]);
  assert.deepEqual(cortesVencidos(2026, 1, now), [1, 2]);
  assert.deepEqual(cortesVencidos(2027, 1, now), []);
  assert.deepEqual(cortesVencidos(2026, 2, at("2026-11-01T06:00:00Z")), [2, 3]);
});

test("the cumulative-report warning fires on execution without plan or at twice the plan", () => {
  assert.equal(avisoAcumulado(0, 18), true, "MINEDEC reported 18 on months with nothing planned");
  assert.equal(avisoAcumulado(1, 2), true);
  assert.equal(avisoAcumulado(1, 1.99), false);
  assert.equal(avisoAcumulado(5, 5), false);
  assert.equal(avisoAcumulado(0, 0), false);
  assert.equal(avisoAcumulado(3, 0), false);
});
