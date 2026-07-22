import assert from "node:assert/strict";
import test from "node:test";

import { passwordValidationError } from "../lib/password-policy";

test("la política web respeta el límite de 72 bytes de bcrypt", () => {
  assert.equal(passwordValidationError("1234567"), "La contraseña debe tener al menos 8 caracteres");
  assert.equal(passwordValidationError("a".repeat(72)), null);
  assert.equal(passwordValidationError("a".repeat(73)), "La contraseña no puede superar 72 bytes");
  assert.equal(passwordValidationError("á".repeat(36)), null);
  assert.equal(passwordValidationError("á".repeat(37)), "La contraseña no puede superar 72 bytes");
});
