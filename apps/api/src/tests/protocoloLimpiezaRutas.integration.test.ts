import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { inArray } from "drizzle-orm";

// Photos go to a throwaway folder, never to the storage configured on the
// machine. The env module reads STORAGE_ROOT once, when it is first imported,
// so every SIGTAR module is imported below, after this line.
const storageRoot = mkdtempSync(join(tmpdir(), "protocolo-limpieza-"));
process.env.STORAGE_ROOT = storageRoot;

// Ported from the standalone app's tests/api.test.mjs (access), the
// persistence half of tests/records.test.mjs and the photo half of
// tests/protocol.test.mjs. Access now comes from SIGTAR's session and the
// module's app instead of the app's shared password.

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

/** A one-file multipart body; `headers` carries the caller's own headers (the token) too. */
function multipartFoto(bytes: Buffer, headers: Record<string, string>, filename = "foto.jpg") {
  const boundary = `pl-${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="foto"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test(
  "Protocolo de limpieza: access, reports with version control and photos",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const { signAccessToken } = await import("../auth/jwt.js");
    const { registerErrorHandler } = await import("../auth/middleware.js");
    const { closeDb, getDb } = await import("../db/client.js");
    const { protocoloLimpiezaFotos, protocoloLimpiezaRegistros } = await import("../db/schema/protocoloLimpieza.js");
    const { userApps, users } = await import("../db/schema/shared.js");
    const { protocoloLimpiezaRoutes } = await import("../routes/protocoloLimpieza/index.js");

    const db = getDb();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(multipart);
    await app.register(protocoloLimpiezaRoutes, { prefix: "/protocolo-limpieza" });

    const viewerId = randomUUID();
    const adminId = randomUUID();
    const outsiderId = randomUUID();
    const registroIds: string[] = [];
    const fotoIds: string[] = [];
    // Unique per run, so earlier runs on the same database never collide on the duplicate key.
    const lote = `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;

    type Rol = "ADMIN" | "VIEWER" | "REPORTER";
    const token = (id: string, role: Rol, apps: Array<"protocolo_limpieza" | "pma">) =>
      signAccessToken({ sub: id, adminId: id, email: `${id}@example.invalid`, name: `limpieza ${role}`, role, apps });
    const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

    const data = {
      fecha: "2026-11-10", barrio: `Sector de prueba ${lote}`, tipo: "Escombro",
      t: 1, m3: 4, u: 3, avance: 50,
    };

    try {
      await db.insert(users).values([
        { id: viewerId, email: `${viewerId}@example.invalid`, name: "Visor de limpieza", role: "VIEWER" },
        { id: adminId, email: `${adminId}@example.invalid`, name: "Administradora", role: "ADMIN" },
        { id: outsiderId, email: `${outsiderId}@example.invalid`, name: "Solo PMA", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([
        { userId: viewerId, appKey: "protocolo_limpieza" },
        { userId: outsiderId, appKey: "pma" },
      ]);
      const viewerJwt = await token(viewerId, "VIEWER", ["protocolo_limpieza"]);
      const adminJwt = await token(adminId, "ADMIN", []);
      const outsiderJwt = await token(outsiderId, "REPORTER", ["pma"]);

      await t.test("nothing is public: no session is 401 and a session without the module is 403", async () => {
        for (const [method, url] of [["GET", "/registros"], ["POST", "/registros"], ["POST", "/fotos"], ["GET", "/fotos/x.jpg"]] as const) {
          const anonimo = await app.inject({ method, url: `/protocolo-limpieza${url}` });
          assert.equal(anonimo.statusCode, 401, `${method} ${url}`);
          const ajeno = await app.inject({ method, url: `/protocolo-limpieza${url}`, headers: auth(outsiderJwt) });
          assert.equal(ajeno.statusCode, 403, `${method} ${url}`);
        }
      });

      await t.test("any role with the module reads the list, and ADMIN has it implicitly", async () => {
        for (const jwt of [viewerJwt, adminJwt]) {
          const res = await app.inject({ method: "GET", url: "/protocolo-limpieza/registros", headers: auth(jwt) });
          assert.equal(res.statusCode, 200);
          assert.ok(Array.isArray(res.json().records));
          assert.equal(res.headers["cache-control"], "no-store");
        }
      });

      await t.test("an invalid report is rejected with the field's message", async () => {
        const invalido = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt), payload: { kind: "invalid", data: {} },
        });
        assert.equal(invalido.statusCode, 400);
        assert.equal(invalido.json().message, "Selecciona una operación válida.");
        const sinBarrio = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt), payload: { kind: "recoleccion", data: { ...data, barrio: "" } },
        });
        assert.equal(sinBarrio.statusCode, 400);
        assert.equal(sinBarrio.json().message, "Completa Barrio.");
      });

      await t.test("Carga en contenedores takes no new reports; an earlier one still lists and can be edited", async () => {
        const carga = { fecha: "2026-11-10", contenedor: `C-${lote}`, tipo: "Escombro", t: 2, m3: 3, u: 1 };
        const nuevo = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt), payload: { kind: "carga", data: carga },
        });
        assert.equal(nuevo.statusCode, 400);
        assert.equal(nuevo.json().message, "«Carga en contenedores» ya no recibe reportes nuevos.");

        // A report saved before the operation was retired.
        const [anterior] = await db.insert(protocoloLimpiezaRegistros).values({
          kind: "carga", data: carga, uniqueKey: `carga-anterior-${lote}`,
          createdBy: viewerId, createdByName: "Visor de limpieza", updatedBy: viewerId, updatedByName: "Visor de limpieza",
        }).returning({ id: protocoloLimpiezaRegistros.id });
        registroIds.push(anterior.id);
        const lista = await app.inject({ method: "GET", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt) });
        assert.equal(lista.json().records.find((r: { id: string }) => r.id === anterior.id)?.kind, "carga");
        const editado = await app.inject({
          method: "PUT", url: `/protocolo-limpieza/registros/${anterior.id}`, headers: auth(viewerJwt),
          payload: { version: 1, kind: "carga", data: { ...carga, t: 5 } },
        });
        assert.equal(editado.statusCode, 200, editado.body);
        const [fila] = await db.select().from(protocoloLimpiezaRegistros).where(inArray(protocoloLimpiezaRegistros.id, [anterior.id]));
        assert.equal(fila.version, 2);
        assert.equal((fila.data as Record<string, unknown>).t, 5);
      });

      await t.test("guarda, evita duplicados y detecta edición concurrente", async () => {
        const recursos = [
          { cantidad: 10, recurso: "Personas", institucion: "Consejo de Gobierno" },
          { cantidad: 1, recurso: "Vehículo", institucion: "Consejo de Gobierno" },
        ];
        const sinInstitucion = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt),
          payload: { kind: "recoleccion", data, recursos: [{ cantidad: 2, recurso: "personas", institucion: "" }] },
        });
        assert.equal(sinInstitucion.statusCode, 400);
        assert.equal(sinInstitucion.json().message, "Completa la institución del recurso 1.");

        const creado = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt), payload: { kind: "recoleccion", data, recursos },
        });
        assert.equal(creado.statusCode, 201, creado.body);
        const { id } = creado.json() as { id: string };
        registroIds.push(id);

        const lista = (await app.inject({ method: "GET", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt) })).json();
        const guardado = lista.records.find((r: { id: string }) => r.id === id);
        assert.equal(guardado.kind, "recoleccion");
        assert.equal(guardado.data.t, 1);
        assert.equal(guardado.data.barrio, `Sector de prueba ${lote}`);
        // Who saved it: the form no longer asks who reports.
        assert.equal(guardado.creadoPorNombre, "Visor de limpieza");
        assert.equal(guardado.version, 1);
        assert.deepEqual(guardado.recursos, recursos);
        assert.match(guardado.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

        // The same day, neighbourhood and type is the same collection, however it is written.
        const duplicado = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(adminJwt),
          payload: { kind: "recoleccion", data: { ...data, barrio: ` ${data.barrio.toUpperCase()} ` } },
        });
        assert.equal(duplicado.statusCode, 409);
        assert.equal(duplicado.json().message, "Ya existe un reporte con esa combinación de datos.");

        const editado = await app.inject({
          method: "PUT", url: `/protocolo-limpieza/registros/${id}`, headers: auth(adminJwt),
          payload: { version: 1, kind: "recoleccion", data: { ...data, t: 2 }, recursos: [recursos[0]] },
        });
        assert.equal(editado.statusCode, 200, editado.body);
        const [fila] = await db.select().from(protocoloLimpiezaRegistros).where(inArray(protocoloLimpiezaRegistros.id, [id]));
        assert.equal(fila.version, 2);
        assert.equal((fila.data as Record<string, unknown>).t, 2);
        assert.deepEqual(fila.recursos, [recursos[0]]);
        assert.equal(fila.createdBy, viewerId);
        await db.update(protocoloLimpiezaRegistros)
          .set({ data: { ...(fila.data as Record<string, string | number>), lote: "L-ANTIGUO" } })
          .where(inArray(protocoloLimpiezaRegistros.id, [id]));
        const reeditado = await app.inject({
          method: "PUT", url: `/protocolo-limpieza/registros/${id}`, headers: auth(adminJwt),
          payload: { version: 2, kind: "recoleccion", data: { ...data, t: 3 }, recursos: [recursos[0]] },
        });
        assert.equal(reeditado.statusCode, 200, reeditado.body);
        const [conLote] = await db.select().from(protocoloLimpiezaRegistros).where(inArray(protocoloLimpiezaRegistros.id, [id]));
        assert.equal((conLote.data as Record<string, unknown>).lote, "L-ANTIGUO");
        assert.equal((conLote.data as Record<string, unknown>).t, 3);
        assert.equal(fila.updatedBy, adminId);
        assert.equal(fila.updatedByName, "Administradora");

        // Saving from version 1 again would overwrite the edit: it is refused.
        const tardio = await app.inject({
          method: "PUT", url: `/protocolo-limpieza/registros/${id}`, headers: auth(viewerJwt),
          payload: { version: 1, kind: "recoleccion", data },
        });
        assert.equal(tardio.statusCode, 409);
        assert.equal(tardio.json().message, "El registro cambió. Cierra el formulario y ábrelo de nuevo.");

        // The operation of a report cannot change.
        const otraOperacion = await app.inject({
          method: "PUT", url: `/protocolo-limpieza/registros/${id}`, headers: auth(viewerJwt),
          payload: { version: 2, kind: "carga", data: { ...data, contenedor: "C-1" } },
        });
        assert.equal(otraOperacion.statusCode, 409);

        for (const [url, version] of [[`/protocolo-limpieza/registros/${id}`, 0], ["/protocolo-limpieza/registros/no-es-un-id", 2]] as const) {
          const invalida = await app.inject({ method: "PUT", url, headers: auth(viewerJwt), payload: { version, kind: "recoleccion", data } });
          assert.equal(invalida.statusCode, 400);
          assert.equal(invalida.json().message, "El registro que intentas editar es inválido.");
        }
      });

      await t.test("guarda y entrega la fotografía interior del contenedor", async () => {
        const subida = await app.inject({ method: "POST", url: "/protocolo-limpieza/fotos", ...multipartFoto(JPEG, auth(viewerJwt)) });
        assert.equal(subida.statusCode, 201, subida.body);
        const { id } = subida.json() as { id: string };
        fotoIds.push(id);
        assert.match(id, /^[0-9a-f-]{36}\.jpg$/);

        const entregada = await app.inject({ method: "GET", url: `/protocolo-limpieza/fotos/${id}`, headers: auth(adminJwt) });
        assert.equal(entregada.statusCode, 200);
        assert.equal(entregada.headers["content-type"], "image/jpeg");
        assert.equal(entregada.headers["x-content-type-options"], "nosniff");
        assert.deepEqual(entregada.rawPayload, JPEG);

        const r3 = {
          fecha: "2026-11-10", contenedor: `${lote}-C`, t: 2, m3: 3, u: 4, documento: "G-1",
        };
        const conFoto = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt), payload: { kind: "puertoSCY", data: { ...r3, foto: id } },
        });
        assert.equal(conFoto.statusCode, 201, conFoto.body);
        registroIds.push(conFoto.json().id);

        // Well-formed, but never uploaded here.
        const fotoAjena = await app.inject({
          method: "POST", url: "/protocolo-limpieza/registros", headers: auth(viewerJwt),
          payload: { kind: "puertoSCY", data: { ...r3, fecha: "2026-11-11", foto: `${randomUUID()}.jpg` } },
        });
        assert.equal(fotoAjena.statusCode, 400);
        assert.equal(fotoAjena.json().message, "Vuelve a adjuntar la fotografía interior del contenedor.");

        const texto = await app.inject({ method: "POST", url: "/protocolo-limpieza/fotos", ...multipartFoto(Buffer.from("no es una imagen"), auth(viewerJwt)) });
        assert.equal(texto.statusCode, 400);
        assert.equal(texto.json().message, "La fotografía debe ser una imagen JPG.");

        const grande = Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)]);
        const enorme = await app.inject({ method: "POST", url: "/protocolo-limpieza/fotos", ...multipartFoto(grande, auth(viewerJwt)) });
        assert.equal(enorme.statusCode, 413);
        assert.equal(enorme.json().message, "La fotografía supera 4 MB.");

        for (const fuera of ["..%2Fregistros.sqlite", "x.jpg", `${randomUUID()}.jpg`]) {
          const res = await app.inject({ method: "GET", url: `/protocolo-limpieza/fotos/${fuera}`, headers: auth(viewerJwt) });
          assert.equal(res.statusCode, 404, fuera);
        }
      });
    } finally {
      await app.close();
      if (registroIds.length) await db.delete(protocoloLimpiezaRegistros).where(inArray(protocoloLimpiezaRegistros.id, registroIds));
      if (fotoIds.length) await db.delete(protocoloLimpiezaFotos).where(inArray(protocoloLimpiezaFotos.id, fotoIds));
      await db.delete(userApps).where(inArray(userApps.userId, [viewerId, adminId, outsiderId]));
      await db.delete(users).where(inArray(users.id, [viewerId, adminId, outsiderId]));
      await closeDb();
      rmSync(storageRoot, { recursive: true, force: true });
    }
  },
);
