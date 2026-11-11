import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AppKey } from "@pma/types";
import { APP_HOME } from "../lib/app-homes";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

/** Every page route of the App Router, with route groups like "(dashboard)" removed. */
function pageRoutes(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pageRoutes(path, out);
    else if (entry.name === "page.tsx") {
      const segments = relative(APP_DIR, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
      out.add("/" + segments.join("/"));
    }
  }
  return out;
}

test("every app's home is a page that exists", () => {
  const routes = pageRoutes(APP_DIR);
  for (const [app, home] of Object.entries(APP_HOME)) {
    assert.ok(routes.has(home), `${app}: ${home} is not a page`);
  }
});

test("every app has a home, so no single-app user is sent to a guessed URL", () => {
  const apps: AppKey[] = ["pma", "rgdp", "geo", "previene", "pg2030", "plan_familiar", "riesgos", "protocolo_limpieza"];
  assert.deepEqual(Object.keys(APP_HOME).sort(), [...apps].sort());
  // The three that never lived at /<app>/dashboard.
  assert.equal(APP_HOME.previene, "/previene");
  assert.equal(APP_HOME.plan_familiar, "/plan-familiar/resultados");
  assert.equal(APP_HOME.riesgos, "/riesgos/admin");
});
