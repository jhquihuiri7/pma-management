import assert from "node:assert/strict";
import test from "node:test";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

test("Fastify 5 loads the production plugins and parses multipart requests", async () => {
  const app = Fastify();
  await app.register(cors, {
    origin: ["https://frontend.example.invalid"],
    credentials: true,
  });
  await app.register(cookie, { secret: "fastify-v5-test-secret-at-least-32-bytes" });
  await app.register(multipart);

  app.post("/compatibility", async (request) => {
    const file = await request.file();
    assert.ok(file);
    return {
      cookie: request.cookies.session,
      filename: file.filename,
      contents: (await file.toBuffer()).toString("utf8"),
    };
  });

  const boundary = "pma-fastify-v5-boundary";
  const payload = Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="evidence.txt"',
    "Content-Type: text/plain",
    "",
    "persisted",
    `--${boundary}--`,
    "",
  ].join("\r\n"));

  const response = await app.inject({
    method: "POST",
    url: "/compatibility",
    headers: {
      cookie: "session=confirmed",
      origin: "https://frontend.example.invalid",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], "https://frontend.example.invalid");
  assert.deepEqual(response.json(), {
    cookie: "confirmed",
    filename: "evidence.txt",
    contents: "persisted",
  });
  await app.close();
});
