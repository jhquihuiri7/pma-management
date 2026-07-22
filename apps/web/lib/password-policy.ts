export const PASSWORD_MIN_CHARACTERS = 8;
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * bcrypt only considers the first 72 UTF-8 bytes. Reject longer passwords
 * instead of silently accepting a value whose suffix would be ignored.
 */
export function passwordValidationError(password: string): string | null {
  if (password.length < PASSWORD_MIN_CHARACTERS) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_CHARACTERS} caracteres`;
  }

  if (new TextEncoder().encode(password).byteLength > BCRYPT_MAX_PASSWORD_BYTES) {
    return `La contraseña no puede superar ${BCRYPT_MAX_PASSWORD_BYTES} bytes`;
  }

  return null;
}
