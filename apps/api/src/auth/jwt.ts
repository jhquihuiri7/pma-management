import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../lib/env.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface AccessTokenClaims extends JWTPayload {
  sub: string; // user id
  adminId: string;
  email: string;
  role: "ADMIN" | "REPORTER" | "VIEWER";
  apps: Array<"pma" | "rgdp" | "geo">;
  name: string;
}

export interface RefreshTokenClaims extends JWTPayload {
  sub: string;
  jti: string;
}

export interface AccessTokenInput {
  sub: string;
  adminId: string;
  email: string;
  role: "ADMIN" | "REPORTER" | "VIEWER";
  apps: Array<"pma" | "rgdp" | "geo">;
  name: string;
}

export async function signAccessToken(claims: AccessTokenInput): Promise<string> {
  return new SignJWT({
    adminId: claims.adminId,
    email: claims.email,
    role: claims.role,
    apps: claims.apps,
    name: claims.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessSecret);
}

export async function signRefreshToken(userId: string): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = randomBytes(16).toString("hex");
  const token = await new SignJWT({ jti })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(refreshSecret);
  const expiresAt = parseExpiry(env.JWT_REFRESH_TTL);
  return { token, jti, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  // Pin the algorithm: never accept "none" or a mismatched alg in the header.
  const { payload } = await jwtVerify(token, accessSecret, { algorithms: ["HS256"] });
  return payload as AccessTokenClaims;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
  const { payload } = await jwtVerify(token, refreshSecret, { algorithms: ["HS256"] });
  return payload as RefreshTokenClaims;
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseExpiry(ttl: string): Date {
  return new Date(Date.now() + ttlToSeconds(ttl) * 1000);
}

export function ttlToSeconds(ttl: string): number {
  const m = ttl.match(/^([1-9]\d*)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL: ${ttl}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const seconds = unit === "s" ? n :
    unit === "m" ? n * 60 :
    unit === "h" ? n * 3_600 :
    n * 86_400;
  if (!Number.isSafeInteger(seconds)) throw new Error(`TTL is too large: ${ttl}`);
  return seconds;
}
