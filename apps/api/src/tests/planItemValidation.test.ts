import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerErrorHandler, validationMessage } from "../auth/middleware.js";
import { itemBase, itemUpdate } from "../routes/pma/planItems.js";

// Rows imported from Excel kept the trailing whitespace of the source cell, and
// the edit form sends the stored value back verbatim: every update of those
// items was rejected with a 400 the user could not act on.
test("stored direccion padding no longer blocks an item update", () => {
  for (const [stored, expected] of [
    ["DOSPPSVR ", "DOSPPSVR"],
    ["DAF ", "DAF"],
    ["DOSPPSVR / DGTAR ", "DOSPPSVR / DGTAR"],
    ["  OPC", "OPC"],
  ] as const) {
    const parsed = itemUpdate.parse({ direccion: stored });
    assert.equal(parsed.direccion, expected);
  }
});

test("direccion outside the catalog is still rejected, and names the field", () => {
  const result = itemUpdate.safeParse({ direccion: "DOSPP" });
  assert.equal(result.success, false);
  assert.deepEqual(result.error!.issues[0]!.path, ["direccion"]);
  assert.match(validationMessage(result.error!), /direccion: Debe ser una de: DAF/);
});

test("periodicity padding is absorbed but unknown values are rejected", () => {
  assert.equal(itemUpdate.parse({ periodicity: " Anual " }).periodicity, "Anual");
  assert.equal(itemUpdate.safeParse({ periodicity: "Cada tanto" }).success, false);
});

// report_per describes the plan, not the item, and the form has no control for
// it. Requiring it here forced the client to guess "6 meses", which made the
// first item of any plan on another period impossible to create.
test("an item may omit report_per and let the plan supply it", () => {
  const parsed = itemBase.parse({
    item: "PMA-01",
    subplan: "Plan de Cierre y Abandono",
    periodicity: "Trimestral",
  });
  assert.equal(parsed.report_per, undefined);
});

test("an explicitly sent report_per is still validated", () => {
  const accepted = itemBase.parse({
    item: "PMA-01",
    subplan: "Plan de Cierre y Abandono",
    periodicity: "Trimestral",
    report_per: "1 año",
  });
  assert.equal(accepted.report_per, "1 año");
  assert.equal(
    itemBase.safeParse({
      item: "PMA-01",
      subplan: "Plan de Cierre y Abandono",
      periodicity: "Trimestral",
      report_per: "cada rato",
    }).success,
    false,
  );
});

test("an empty update is rejected", () => {
  assert.equal(itemUpdate.safeParse({}).success, false);
});

test("the 400 envelope names the offending fields instead of a bare message", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  app.post("/items", async (request) => itemUpdate.parse(request.body));

  const response = await app.inject({
    method: "POST",
    url: "/items",
    payload: { direccion: "DOSPP", periodicity: "Cada tanto" },
  });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error, "ValidationError");
  assert.match(body.message, /direccion/);
  assert.match(body.message, /periodicity/);
  assert.ok(body.details.fieldErrors.direccion);
  await app.close();
});

test("more issues than the message shows are summarized, not dropped", () => {
  const err = new ZodError([
    { code: "custom", path: ["a"], message: "no" },
    { code: "custom", path: ["b"], message: "no" },
    { code: "custom", path: ["c"], message: "no" },
    { code: "custom", path: ["d"], message: "no" },
  ]);
  assert.match(validationMessage(err), /a: no; b: no; c: no \(y 1 campo\(s\) más\)/);
});
