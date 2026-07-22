import assert from "node:assert/strict";
import test from "node:test";

import { safeInternalRedirect } from "../lib/safe-internal-redirect";

test("acepta rutas internas y rechaza variantes de redirección externa", () => {
  const origin = "https://pma.example";
  assert.equal(safeInternalRedirect("/pma/plans?tab=1#item", origin), "/pma/plans?tab=1#item");
  assert.equal(safeInternalRedirect("https://evil.example", origin), null);
  assert.equal(safeInternalRedirect("//evil.example/path", origin), null);
  assert.equal(safeInternalRedirect("/\\evil.example/path", origin), null);
  assert.equal(safeInternalRedirect("pma/plans", origin), null);
});
