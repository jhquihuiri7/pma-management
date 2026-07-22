import assert from "node:assert/strict";
import test from "node:test";

import { randomUUID } from "node:crypto";
import {
  buildAuthRateLimitKeys,
  consumeSharedRateLimit,
  FixedWindowRateLimiter,
} from "../auth/rateLimit.js";
import { getPool } from "../db/client.js";

test("fixed-window auth limiter blocks at the limit and resets deterministically", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.deepEqual(limiter.consume("login:user", 2, 1_000, 10_000), { allowed: true });
  assert.deepEqual(limiter.consume("login:user", 2, 1_000, 10_100), { allowed: true });
  assert.deepEqual(limiter.consume("login:user", 2, 1_000, 10_200), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.consume("login:user", 2, 1_000, 11_000), { allowed: true });
});

test("rate-limit buckets are isolated by scope and subject", () => {
  const limiter = new FixedWindowRateLimiter();
  assert.equal(limiter.consume("login:a", 1, 1_000, 0).allowed, true);
  assert.equal(limiter.consume("login:a", 1, 1_000, 1).allowed, false);
  assert.equal(limiter.consume("login:b", 1, 1_000, 1).allowed, true);
  assert.equal(limiter.consume("forgot:a", 1, 1_000, 1).allowed, true);
});

test("auth rate-limit keys isolate origins without retaining account data", () => {
  const email = "Victim.Account@example.invalid";
  const first = buildAuthRateLimitKeys({ scope: "login", subject: email, ip: "192.0.2.1" });
  const sameNormalized = buildAuthRateLimitKeys({ scope: "login", subject: `  ${email.toUpperCase()}  `, ip: "192.0.2.1" });
  const anotherOrigin = buildAuthRateLimitKeys({ scope: "login", subject: email, ip: "192.0.2.2" });

  assert.deepEqual(first, sameNormalized);
  assert.notEqual(first.origin, anotherOrigin.origin);
  assert.notEqual(first.subjectOrigin, anotherOrigin.subjectOrigin);
  assert.equal(first.origin.includes("victim"), false);
  assert.match(first.subjectOrigin, /^[a-f0-9]{64}$/);
});

test(
  "shared rate limiter has one atomic winner at the limit",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const key = buildAuthRateLimitKeys({
      scope: `test-${randomUUID()}`,
      subject: "atomic@example.invalid",
      ip: "192.0.2.10",
    }).subjectOrigin;
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consumeSharedRateLimit(key, 3, 60_000)),
      );
      assert.equal(results.filter((result) => result.allowed).length, 3);
      assert.equal(results.filter((result) => !result.allowed).length, 5);
    } finally {
      await getPool().query("delete from auth_rate_limits where bucket_key = $1", [key]);
    }
  },
);
