export const PASSWORD_MIN_CHARACTERS = 8;
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function isPasswordWithinBcryptLimit(password: string): boolean {
  return Buffer.byteLength(password, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES;
}

export function newPasswordValidationError(password: string): string | null {
  if (password.length < PASSWORD_MIN_CHARACTERS) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_CHARACTERS} caracteres`;
  }
  if (!isPasswordWithinBcryptLimit(password)) {
    return `La contraseña no puede superar ${BCRYPT_MAX_PASSWORD_BYTES} bytes`;
  }
  return null;
}
