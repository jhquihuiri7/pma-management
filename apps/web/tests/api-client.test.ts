import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  api,
  apiErrorFromResponse,
  apiFetch,
  assertQueuedInvitationReceipt,
  requireOkReceipt,
  requirePersistedAsset,
  requirePersistedEntity,
} from "../lib/api-client";
import { executeConfirmedMutation } from "../lib/use-confirmed-mutation";

test("extrae mensajes de envelopes JSON y cuerpos de texto", async () => {
  const nested = await apiErrorFromResponse(new Response(
    JSON.stringify({ error: { message: "La evidencia no pudo persistirse" } }),
    { status: 500, headers: { "content-type": "application/json" } }
  ));
  assert.equal(nested.status, 500);
  assert.equal(nested.message, "La evidencia no pudo persistirse");

  const plain = await apiErrorFromResponse(new Response("Servicio no disponible", { status: 503 }));
  assert.equal(plain.message, "Servicio no disponible");
});

test("el cliente único traduce /api/users y valida la respuesta", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ users: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await api.get<{ users: unknown[] }>("/api/users");
    assert.deepEqual(result, { users: [] });
    assert.equal(requestedUrl, "http://localhost:4000/api/users");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normaliza timeout y cancelación sin confundirlos con éxito HTTP", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

  try {
    await assert.rejects(
      apiFetch("https://example.test/slow", { timeoutMs: 5 }),
      (error: unknown) => error instanceof ApiError && error.kind === "timeout"
    );

    const controller = new AbortController();
    const pending = apiFetch("https://example.test/cancelled", {
      timeoutMs: 0,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof ApiError && error.kind === "abort"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("el timeout permanece activo hasta terminar de leer el body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  try {
    await assert.rejects(
      api.get("https://example.test/stalled-body", { timeoutMs: 5 }),
      (error: unknown) => error instanceof ApiError && error.kind === "timeout",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rechaza tanto 4xx con su body como fallos reales de red", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: "El registro ya existe" } }),
      { status: 409, headers: { "content-type": "application/json" } }
    );
    await assert.rejects(
      api.post("/pma/plans", { title: "Duplicado" }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.message === "El registro ya existe"
    );

    globalThis.fetch = async () => { throw new TypeError("connection refused"); };
    await assert.rejects(
      api.get("/pma/plans"),
      (error: unknown) => error instanceof ApiError && error.kind === "network"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("un 2xx con JSON corrupto no se convierte en éxito", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{incompleto", {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    await assert.rejects(
      api.get("/pma/plans"),
      (error: unknown) => error instanceof ApiError && error.kind === "invalid_response"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("solo ejecuta la confirmación después de persistir", async () => {
  const order: string[] = [];
  const success = await executeConfirmedMutation(
    async () => {
      order.push("request");
      await Promise.resolve();
      order.push("persisted");
      return { id: "saved-id" };
    },
    { onConfirmed: ({ id }) => { order.push(`confirmed:${id}`); } }
  );

  assert.equal(success.ok, true);
  assert.deepEqual(order, ["request", "persisted", "confirmed:saved-id"]);
});

test("una operación rechazada nunca dispara el callback de éxito", async () => {
  let confirmed = false;
  let rejected = false;
  const failure = await executeConfirmedMutation(
    async () => { throw new Error("db write failed"); },
    {
      onConfirmed: () => { confirmed = true; },
      onRejected: () => { rejected = true; },
    }
  );

  assert.equal(failure.ok, false);
  assert.equal(confirmed, false);
  assert.equal(rejected, true);
});

test("solo acepta invitaciones confirmadas por un receipt queued con operationId", () => {
  assert.doesNotThrow(() => assertQueuedInvitationReceipt({
    invitation: { status: "queued", operationId: "outbox-123" },
  }));
  assert.throws(
    () => assertQueuedInvitationReceipt({ invitation: { status: "sent" } }),
    (error: unknown) => error instanceof ApiError && error.kind === "invalid_response"
  );
});

test("rechaza 2xx sin receipt explícito o sin entidad persistida", () => {
  assert.deepEqual(requireOkReceipt({ ok: true }), { ok: true });
  assert.throws(
    () => requireOkReceipt({ ok: false }),
    (error: unknown) => error instanceof ApiError && error.kind === "invalid_response"
  );

  assert.deepEqual(
    requirePersistedEntity<{ id: string; name: string }>({ id: "entity-1", name: "guardada" }),
    { id: "entity-1", name: "guardada" }
  );
  assert.throws(
    () => requirePersistedEntity({ id: "entity-2" }, "ID inesperado", "entity-1"),
    (error: unknown) => error instanceof ApiError && error.kind === "invalid_response"
  );

  assert.deepEqual(
    requirePersistedAsset({ id: "asset-1", driveFileId: "PMA/file.pdf", driveUrl: "/storage/PMA/file.pdf" }),
    { id: "asset-1", driveFileId: "PMA/file.pdf", driveUrl: "/storage/PMA/file.pdf" },
  );
  assert.throws(
    () => requirePersistedAsset({ id: "asset-2", driveFileId: "" }),
    (error: unknown) => error instanceof ApiError && error.kind === "invalid_response",
  );
});
