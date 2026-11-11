import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { eq, inArray } from "drizzle-orm";
import { lasDePrueba } from "./fixtures/lasDePrueba.js";

// Files go to a throwaway folder, never to the storage configured on the
// machine. The env module reads STORAGE_ROOT once, when it is first imported,
// so every SIGTAR module is imported below, after this line.
const storageRoot = mkdtempSync(join(tmpdir(), "protocolo-limpieza-nubes-"));
process.env.STORAGE_ROOT = storageRoot;

type Campos = Record<string, string>;

/** Fields first, then the file in "archivo", as the browser sends them. */
function multipartNube(campos: Campos, archivo: { nombre: string; bytes: Buffer } | null, headers: Record<string, string>) {
  const boundary = `pl-${randomUUID()}`;
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (archivo) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="${archivo.nombre}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    partes.push(archivo.bytes, Buffer.from("\r\n"));
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(partes), headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test(
  "Protocolo de limpieza · Visualización 3D: upload, data, deletion by ADMIN and the COPC by ranges",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const { signAccessToken } = await import("../auth/jwt.js");
    const { registerErrorHandler } = await import("../auth/middleware.js");
    const { closeDb, getDb } = await import("../db/client.js");
    const { protocoloLimpiezaNubes } = await import("../db/schema/protocoloLimpieza.js");
    const { storageCleanupJobs, userApps, users } = await import("../db/schema/shared.js");
    const { protocoloLimpiezaRoutes } = await import("../routes/protocoloLimpieza/index.js");
    const { marcarNubeError, publicarNube, dirNube, hoyGalapagos } = await import("../modules/protocoloLimpieza/nubesModule.js");
    const { stopBoss } = await import("../jobs/boss.js");

    const db = getDb();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(multipart);
    await app.register(protocoloLimpiezaRoutes, { prefix: "/protocolo-limpieza" });

    const viewerId = randomUUID();
    const adminId = randomUUID();
    const outsiderId = randomUUID();
    const nubeIds: string[] = [];
    // Unique per run, so earlier runs on the same database never share a site.
    const sitio = `Acopio temporal ${randomUUID().slice(0, 6)}`;
    const hoy = hoyGalapagos();

    type Rol = "ADMIN" | "VIEWER" | "REPORTER";
    const token = (id: string, role: Rol, apps: Array<"protocolo_limpieza" | "pma">) =>
      signAccessToken({ sub: id, adminId: id, email: `${id}@example.invalid`, name: `nubes ${role}`, role, apps });
    const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });
    const subir = (jwt: string, campos: Campos, archivo: { nombre: string; bytes: Buffer } | null) =>
      app.inject({ method: "POST", url: "/protocolo-limpieza/nubes", ...multipartNube(campos, archivo, auth(jwt)) });
    const carpetasDeNubes = async () => (await db.select({ id: protocoloLimpiezaNubes.id }).from(protocoloLimpiezaNubes)).length;

    try {
      await db.insert(users).values([
        { id: viewerId, email: `${viewerId}@example.invalid`, name: "Visor de nubes", role: "VIEWER" },
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
        const id = randomUUID();
        for (const [method, url] of [["GET", "/nubes"], ["POST", "/nubes"], ["PUT", `/nubes/${id}`], ["DELETE", `/nubes/${id}`], ["GET", `/nubes/${id}/copc`], ["GET", `/nubes/${id}/original`]] as const) {
          assert.equal((await app.inject({ method, url: `/protocolo-limpieza${url}` })).statusCode, 401, `${method} ${url}`);
          assert.equal((await app.inject({ method, url: `/protocolo-limpieza${url}`, headers: auth(outsiderJwt) })).statusCode, 403, `${method} ${url}`);
        }
      });

      let primera = "";
      await t.test("any role with the module uploads: the cloud waits for its conversion", async () => {
        const res = await subir(viewerJwt, { sitio, fecha: hoy, descripcion: "Vuelo de la mañana" }, { nombre: "Desechos_densified.las", bytes: lasDePrueba() });
        assert.equal(res.statusCode, 201, res.body);
        const nube = res.json();
        nubeIds.push(nube.id);
        primera = nube.id;
        assert.equal(nube.estado, "procesando");
        assert.equal(nube.sitio, sitio);
        assert.equal(nube.puntos, 3);
        assert.equal(nube.archivoNombre, "Desechos_densified.las");
        assert.equal(nube.creadoPorNombre, "Visor de nubes");
        assert.ok(existsSync(join(storageRoot, dirNube(nube.id), "original.las")));
        // The upload intent was finalized: nothing left to clean.
        const pendientes = await db.select().from(storageCleanupJobs).where(eq(storageCleanupJobs.storagePath, dirNube(nube.id)));
        assert.equal(pendientes.length, 0);
      });

      await t.test("the same site typed otherwise joins the existing timeline", async () => {
        const res = await subir(viewerJwt, { sitio: `  ${sitio.toUpperCase()} `, fecha: "2026-11-01" }, { nombre: "otro.LAZ", bytes: lasDePrueba({ comprimido: true, registros: 0 }) });
        assert.equal(res.statusCode, 201, res.body);
        nubeIds.push(res.json().id);
        assert.equal(res.json().sitio, sitio);
        assert.ok(existsSync(join(storageRoot, dirNube(res.json().id), "original.laz")));
      });

      await t.test("refused uploads leave neither a row nor a file", async () => {
        const antes = await carpetasDeNubes();
        const casos: Array<[Campos, { nombre: string; bytes: Buffer } | null, number, RegExp]> = [
          [{ sitio, fecha: "2999-01-01" }, { nombre: "a.las", bytes: lasDePrueba() }, 400, /no puede ser posterior a hoy/],
          [{ fecha: hoy }, { nombre: "a.las", bytes: lasDePrueba() }, 400, /Indica el sitio/],
          [{ sitio, fecha: hoy }, { nombre: "a.ply", bytes: lasDePrueba() }, 400, /Sube un archivo \.las o \.laz/],
          [{ sitio, fecha: hoy }, { nombre: "a.las", bytes: Buffer.from("esto no es un LAS ".repeat(30)) }, 400, /no es una nube de puntos LAS\/LAZ válida/],
          [{ sitio, fecha: hoy }, { nombre: "cortado.las", bytes: lasDePrueba({ registros: 2 }) }, 400, /está incompleto/],
          [{ sitio, fecha: hoy }, null, 400, /Adjunta el archivo/],
          [{ sitio, fecha: hoy, color: "rojo" }, { nombre: "a.las", bytes: lasDePrueba() }, 400, /Campo no permitido/],
        ];
        for (const [campos, archivo, estado, mensaje] of casos) {
          const res = await subir(viewerJwt, campos, archivo);
          assert.equal(res.statusCode, estado, `${JSON.stringify(campos)} ${archivo?.nombre}: ${res.body}`);
          assert.match(res.json().message ?? res.json().error ?? res.body, mensaje);
        }
        assert.equal(await carpetasDeNubes(), antes);
      });

      await t.test("the list has every cloud of the site, by date", async () => {
        const res = await app.inject({ method: "GET", url: "/protocolo-limpieza/nubes", headers: auth(viewerJwt) });
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["cache-control"], "no-store");
        const delSitio = (res.json().nubes as Array<{ sitio: string; fecha: string }>).filter((n) => n.sitio === sitio);
        assert.deepEqual(delSitio.map((n) => n.fecha), ["2026-11-01", hoy]);
      });

      await t.test("its data are edited with version control", async () => {
        const url = `/protocolo-limpieza/nubes/${primera}`;
        const ok = await app.inject({ method: "PUT", url, headers: auth(viewerJwt), payload: { version: 1, sitio, fecha: "2026-11-02", descripcion: "Vuelo corregido" } });
        assert.equal(ok.statusCode, 200, ok.body);
        assert.equal(ok.json().version, 2);
        assert.equal(ok.json().fecha, "2026-11-02");
        const tarde = await app.inject({ method: "PUT", url, headers: auth(viewerJwt), payload: { version: 1, sitio, fecha: "2026-11-03" } });
        assert.equal(tarde.statusCode, 409);
        assert.equal((await app.inject({ method: "PUT", url: "/protocolo-limpieza/nubes/no-es-uuid", headers: auth(viewerJwt), payload: { version: 1 } })).statusCode, 400);
      });

      await t.test("the COPC is served by ranges once ready; the original downloads with its name", async () => {
        const copcUrl = `/protocolo-limpieza/nubes/${primera}/copc`;
        assert.equal((await app.inject({ method: "GET", url: copcUrl, headers: auth(viewerJwt) })).statusCode, 404, "not before it is ready");
        const local = join(storageRoot, "copc-de-prueba.laz");
        writeFileSync(local, Buffer.from("0123456789abcdefghij"));
        const metadatos = {
          crs: null,
          limites: { minx: 0, miny: 0, minz: 0, maxx: 1, maxy: 1, maxz: 1 },
          dimensiones: ["X", "Y", "Z"],
          color: false,
          clases: [],
          z: { min: 0, max: 1, media: 0.5, desviacion: 0.1 },
        };
        assert.equal(await publicarNube(primera, { copcLocal: local, metadatos, puntos: 3 }), "lista");
        const rango = await app.inject({ method: "GET", url: copcUrl, headers: { ...auth(viewerJwt), range: "bytes=10-14" } });
        assert.equal(rango.statusCode, 206);
        assert.equal(rango.headers["content-range"], "bytes 10-14/20");
        assert.equal(rango.body, "abcde");
        const lista = (await app.inject({ method: "GET", url: "/protocolo-limpieza/nubes", headers: auth(viewerJwt) })).json().nubes.find((n: { id: string }) => n.id === primera);
        assert.equal(lista.estado, "lista");
        assert.equal(lista.copcBytes, 20);
        const original = await app.inject({ method: "GET", url: `/protocolo-limpieza/nubes/${primera}/original`, headers: auth(viewerJwt) });
        assert.equal(original.statusCode, 200);
        assert.match(String(original.headers["content-disposition"]), /^attachment; filename="Desechos_densified\.las"; filename\*=UTF-8''Desechos_densified\.las$/);
        assert.equal(original.rawPayload.length, lasDePrueba().length);
      });

      await t.test("a failed conversion can be retried; a cloud being converted cannot", async () => {
        const [, segunda] = nubeIds;
        const url = `/protocolo-limpieza/nubes/${segunda}/reintentar`;
        assert.equal((await app.inject({ method: "POST", url, headers: auth(viewerJwt) })).statusCode, 409);
        await marcarNubeError(segunda, "untwine terminó con código 1");
        const res = await app.inject({ method: "POST", url, headers: auth(viewerJwt) });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal(res.json().estado, "procesando");
        assert.equal(res.json().error, null);
      });

      await t.test("only ADMIN deletes, and the cloud's folder is queued for cleanup", async () => {
        const url = `/protocolo-limpieza/nubes/${primera}`;
        assert.equal((await app.inject({ method: "DELETE", url, headers: auth(viewerJwt) })).statusCode, 403);
        const res = await app.inject({ method: "DELETE", url, headers: auth(adminJwt) });
        assert.equal(res.statusCode, 200, res.body);
        assert.equal((await db.select().from(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, primera))).length, 0);
        const limpieza = await db.select().from(storageCleanupJobs).where(eq(storageCleanupJobs.storagePath, dirNube(primera)));
        assert.equal(limpieza.length, 1);
        assert.equal(limpieza[0].isDirectory, true);
        assert.equal((await app.inject({ method: "DELETE", url, headers: auth(adminJwt) })).statusCode, 404);
      });

      await t.test("a conversion that ends after its cloud was deleted keeps nothing", async () => {
        const [, segunda] = nubeIds;
        await db.delete(protocoloLimpiezaNubes).where(eq(protocoloLimpiezaNubes.id, segunda));
        const local = join(storageRoot, "copc-huerfano.laz");
        writeFileSync(local, Buffer.from("copc"));
        const metadatos = { crs: null, limites: { minx: 0, miny: 0, minz: 0, maxx: 1, maxy: 1, maxz: 1 }, dimensiones: [], color: false, clases: [], z: { min: 0, max: 1, media: 0, desviacion: 0 } };
        assert.equal(await publicarNube(segunda, { copcLocal: local, metadatos, puntos: 3 }), "descartada");
        assert.equal(existsSync(join(storageRoot, dirNube(segunda))), false);
      });
    } finally {
      if (nubeIds.length) {
        await db.delete(protocoloLimpiezaNubes).where(inArray(protocoloLimpiezaNubes.id, nubeIds));
        await db.delete(storageCleanupJobs).where(inArray(storageCleanupJobs.storagePath, nubeIds.map((id) => dirNube(id))));
      }
      await db.delete(userApps).where(inArray(userApps.userId, [viewerId, adminId, outsiderId]));
      await db.delete(users).where(inArray(users.id, [viewerId, adminId, outsiderId]));
      await app.close();
      await stopBoss();
      await closeDb();
      rmSync(storageRoot, { recursive: true, force: true });
    }
  },
);
