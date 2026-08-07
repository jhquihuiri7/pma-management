import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { eq } from "drizzle-orm";

/**
 * Route-level tests for the evidence proxy.
 *
 * This is the riskiest surface in the module: it is the only path that carries
 * the upstream bearer key, and the only one whose correctness the browser can
 * observe as a broken <video>. What is asserted here is the transfer contract —
 * Range in, 206 and Content-Range out — plus the two refusals that keep the
 * route from becoming an open relay.
 */
process.env.PREVIENE_API_KEY = "test-key-not-a-real-secret";
process.env.PREVIENE_API_BASE_URL = "http://reports.test:8080";

const { getDb, closeDb } = await import("../db/client.js");
const { previeneReports, previeneMedia } = await import("../db/schema/previene.js");
const { users, userApps } = await import("../db/schema/shared.js");
const { signAccessToken } = await import("../auth/jwt.js");
const { registerErrorHandler } = await import("../auth/middleware.js");
const { previeneRoutes } = await import("../routes/previene/index.js");

const db = getDb();
const originalFetch = globalThis.fetch;

const USER_ID = "f0000000-0000-4000-8000-000000000001";
const OUTSIDER_ID = "f0000000-0000-4000-8000-000000000002";
const REPORT_ID = "f0000000-0000-4000-8000-000000000010";
const MEDIA_ID = "f0000000-0000-4000-8000-000000000020";
const UNKNOWN_MEDIA_ID = "f0000000-0000-4000-8000-0000000000ff";

async function buildApp() {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(previeneRoutes, { prefix: "/previene" });
  return app;
}

async function seed() {
  await db
    .insert(users)
    .values([
      { id: USER_ID, email: "previene-viewer@test.local", name: "Visor Previene", role: "VIEWER" },
      { id: OUTSIDER_ID, email: "previene-outsider@test.local", name: "Sin Acceso", role: "VIEWER" },
    ])
    .onConflictDoNothing();
  await db.insert(userApps).values({ userId: USER_ID, appKey: "previene" }).onConflictDoNothing();

  await db
    .insert(previeneReports)
    .values({
      id: REPORT_ID,
      reportKind: "EVENT",
      eventTypeCode: "FIRE",
      eventTypeName: "Incendio",
      latitude: -0.9018,
      longitude: -89.6102,
      description: "Incendio estructural.",
      submittedAt: new Date("2026-08-04T23:12:00Z"),
      remoteUpdatedAt: new Date("2026-08-04T23:12:00Z"),
    })
    .onConflictDoNothing();

  await db
    .insert(previeneMedia)
    .values({
      id: MEDIA_ID,
      reportId: REPORT_ID,
      mediaType: "VIDEO",
      contentPath: `/v1/media/${MEDIA_ID}/content`,
      mimeType: "video/mp4",
      fileSize: 52_400_000,
    })
    .onConflictDoUpdate({ target: previeneMedia.id, set: { availability: "unknown" } });
}

async function tokenFor(userId: string) {
  return signAccessToken({
    sub: userId,
    adminId: userId,
    email: "previene-viewer@test.local",
    role: "VIEWER",
    apps: ["previene"],
    name: "Visor Previene",
  });
}

test.before(async () => {
  await seed();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await db.delete(previeneReports).where(eq(previeneReports.id, REPORT_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
  await db.delete(users).where(eq(users.id, OUTSIDER_ID));
  await closeDb();
});

test("every route refuses an unauthenticated request", async () => {
  const app = await buildApp();
  for (const url of [
    "/previene/api/reports",
    "/previene/api/event-types",
    "/previene/api/estado",
    `/previene/media/${MEDIA_ID}`,
  ]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 401, `${url} must require a session`);
  }
  await app.close();
});

test("a signed-in user without the previene app is refused", async () => {
  const app = await buildApp();
  const token = await tokenFor(OUTSIDER_ID);
  const response = await app.inject({
    method: "GET",
    url: "/previene/api/reports",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("an unknown media id is refused without contacting upstream", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = (async () => {
    upstreamCalls += 1;
    return new Response("should never happen", { status: 200 });
  }) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${UNKNOWN_MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 404);
  // The guard exists so the proxy cannot be driven to fetch arbitrary ids from
  // the reports API on behalf of a signed-in user.
  assert.equal(upstreamCalls, 0, "an id we never ingested must not reach upstream");
  await app.close();
});

test("a Range request is forwarded and the 206 response is propagated", async () => {
  let forwardedRange: string | null = null;
  globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    forwardedRange = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]).get("range");
    return new Response("partial-bytes", {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-range": "bytes 0-12/52400000",
        "accept-ranges": "bytes",
        "content-length": "13",
      },
    });
  }) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}`, range: "bytes=0-12" },
  });

  assert.equal(forwardedRange, "bytes=0-12");
  assert.equal(response.statusCode, 206, "a 200 here would break seeking in <video>");
  assert.equal(response.headers["content-range"], "bytes 0-12/52400000");
  assert.equal(response.headers["accept-ranges"], "bytes");
  assert.equal(response.headers["content-type"], "video/mp4");
  assert.equal(response.body, "partial-bytes");
  // Evidence must never be cached by a shared proxy: it is session-gated.
  assert.match(String(response.headers["cache-control"]), /no-store/);
  await app.close();
});

test("the generated file name ignores the reporter-supplied original name", async () => {
  globalThis.fetch = (async () =>
    new Response("bytes", { status: 200, headers: { "content-type": "video/mp4" } })) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-disposition"], `inline; filename="evidencia-${MEDIA_ID}.mp4"`);
  await app.close();
});

test("a Content-Type outside the allowlist is never declared verbatim", async () => {
  // Evidence is served inline from SIGTAR's own origin. Reflecting a
  // `text/html` from upstream would execute it as a page on this origin, with
  // the viewer's session. `nosniff` is no help: the type is being asserted.
  globalThis.fetch = (async () =>
    new Response("<script>alert(document.cookie)</script>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /^application\/octet-stream/);
  // ...and it is not offered for inline rendering either.
  assert.match(String(response.headers["content-disposition"]), /^attachment/);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  await app.close();
});

test("a type allowed for photos is not allowed for a video record", async () => {
  // The allowlist is keyed by the media type WE ingested, so a mismatch between
  // what upstream claims now and what the record says cannot be laundered into
  // a renderable type.
  globalThis.fetch = (async () =>
    new Response("bytes", { status: 200, headers: { "content-type": "image/svg+xml" } })) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });

  assert.match(String(response.headers["content-type"]), /^application\/octet-stream/);
  await app.close();
});

test("an upstream 404 does not mark the evidence gone for ever", async () => {
  await db
    .update(previeneMedia)
    .set({ availability: "unknown" })
    .where(eq(previeneMedia.id, MEDIA_ID));

  globalThis.fetch = (async () => new Response("gone", { status: 404 })) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 404);

  const [row] = await db
    .select({ availability: previeneMedia.availability })
    .from(previeneMedia)
    .where(eq(previeneMedia.id, MEDIA_ID));
  // `gone` is terminal: sync never resets it and the viewer stops asking for the
  // file that would prove it back. One 404 during a two-minute upstream
  // redeploy would therefore erase the evidence from the viewer permanently.
  assert.equal(row.availability, "unknown", "a single 404 must stay transient");
  await app.close();
});

test("an upstream outage surfaces as 502, not as a silent empty file", async () => {
  globalThis.fetch = (async () => new Response("boom", { status: 503 })) as typeof fetch;

  const app = await buildApp();
  const token = await tokenFor(USER_ID);
  const response = await app.inject({
    method: "GET",
    url: `/previene/media/${MEDIA_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 502);
  await app.close();
});
