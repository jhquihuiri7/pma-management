import assert from "node:assert/strict";
import test from "node:test";

import {
  isPasswordWithinBcryptLimit,
  newPasswordValidationError,
} from "../auth/passwordPolicy.js";

test("API and seed policy enforce bcrypt's UTF-8 byte limit", () => {
  assert.equal(newPasswordValidationError("1234567"), "La contraseña debe tener al menos 8 caracteres");
  assert.equal(newPasswordValidationError("a".repeat(72)), null);
  assert.equal(newPasswordValidationError("a".repeat(73)), "La contraseña no puede superar 72 bytes");
  assert.equal(isPasswordWithinBcryptLimit("á".repeat(36)), true);
  assert.equal(isPasswordWithinBcryptLimit("á".repeat(37)), false);
});
