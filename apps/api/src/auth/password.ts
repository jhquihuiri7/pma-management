import bcrypt from "bcryptjs";
import { BCRYPT_MAX_PASSWORD_BYTES, isPasswordWithinBcryptLimit } from "./passwordPolicy.js";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (!isPasswordWithinBcryptLimit(plain)) {
    throw new RangeError(`Password exceeds bcrypt's ${BCRYPT_MAX_PASSWORD_BYTES}-byte limit`);
  }
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!isPasswordWithinBcryptLimit(plain)) return false;
  return bcrypt.compare(plain, hash);
}
