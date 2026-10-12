import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import { pg2030Instituciones, pg2030UsuarioInstitucion } from "../db/schema/pg2030.js";
import {
  createInstitucion,
  deleteInstitucion,
  getPg2030Me,
  listInstituciones,
  updateInstitucion,
} from "../modules/pg2030/institucionesModule.js";
import {
  createUserGlobal,
  deleteManagedUser,
  listManagedUsers,
  updateManagedUser,
} from "../modules/shared/usersModule.js";
import type { AccessTokenClaims } from "../auth/jwt.js";

const status = (code: number) => (error: { statusCode?: number }) => error.statusCode === code;

function claims(id: string, role: AccessTokenClaims["role"]): AccessTokenClaims {
  return { sub: id, adminId: id, email: `${id}@example.invalid`, role, apps: ["pg2030"], name: "test" };
}

async function linkOf(userId: string) {
  const [row] = await getDb()
    .select()
    .from(pg2030UsuarioInstitucion)
    .where(eq(pg2030UsuarioInstitucion.userId, userId));
  return row ?? null;
}

test(
  "PG2030 institutions and the reporter ↔ institution link",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const adminId = randomUUID();
    const reporterId = randomUUID();
    const createdUserIds: string[] = [];
    const createdInstitucionIds: string[] = [];

    try {
      await db.insert(users).values([
        { id: adminId, email: `pg2030-inst-admin-${adminId}@example.invalid`, name: "PG2030 inst admin", role: "ADMIN" },
        { id: reporterId, email: `pg2030-inst-rep-${reporterId}@example.invalid`, name: "PG2030 inst reporter", role: "REPORTER" },
      ]);
      await db.insert(userApps).values({ userId: reporterId, appKey: "pg2030" });

      const magp = await createInstitucion(adminId, { nombre: "Ministerio de Agricultura", sigla: `MAGP-${suffix}`, tipo: "Ejecutivo" });
      const gad = await createInstitucion(adminId, { nombre: "GAD de prueba", sigla: `GAD-${suffix}`, tipo: "GAD" });
      createdInstitucionIds.push(magp.id, gad.id);

      await t.test("CGREG is the institution the module starts with", async () => {
        const list = await listInstituciones();
        const cgreg = list.find((i) => i.sigla === "CGREG");
        assert.ok(cgreg);
        assert.equal(cgreg.nombre, "Consejo de Gobierno del Régimen Especial de Galápagos");
      });

      await t.test("siglas are unique regardless of case, on create and on rename", async () => {
        await assert.rejects(
          createInstitucion(adminId, { nombre: "Duplicada", sigla: `magp-${suffix}`.toLowerCase(), tipo: "Ejecutivo" }),
          status(409),
        );
        await assert.rejects(updateInstitucion(adminId, gad.id, { sigla: `MAGP-${suffix}` }), status(409));
        // Renaming an institution to its own sigla is not a conflict.
        const same = await updateInstitucion(adminId, magp.id, { sigla: `MAGP-${suffix}`, nombre: "MAGP" });
        assert.equal(same.nombre, "MAGP");
      });

      await t.test("only an administrator changes the institutions catalog", async () => {
        await assert.rejects(
          createInstitucion(reporterId, { nombre: "X", sigla: `X-${suffix}`, tipo: "Otro" }),
          status(403),
        );
      });

      await t.test("a PG2030 reporter is created with exactly one active institution", async () => {
        const email = (tag: string) => `pg2030-${tag}-${suffix}@example.invalid`.toLowerCase();
        await assert.rejects(
          createUserGlobal(adminId, { name: "Sin institución", email: email("sin"), role: "REPORTER", apps: ["pg2030"] }),
          status(400),
        );
        await assert.rejects(
          createUserGlobal(adminId, { name: "Visor", email: email("visor"), role: "VIEWER", apps: ["pg2030"], pg2030InstitucionId: magp.id }),
          status(400),
        );
        await assert.rejects(
          createUserGlobal(adminId, { name: "Sin app", email: email("sinapp"), role: "REPORTER", apps: ["pma"], pg2030InstitucionId: magp.id }),
          status(400),
        );
        // The rejected attempts left no account behind.
        assert.equal((await db.select().from(users).where(eq(users.email, email("sin")))).length, 0);

        const created = await createUserGlobal(adminId, {
          name: "Reportero MAGP",
          email: email("rep"),
          role: "REPORTER",
          apps: ["pg2030", "pma"],
          pg2030InstitucionId: magp.id,
        });
        createdUserIds.push(created.id);
        const link = await linkOf(created.id);
        assert.equal(link?.institucionId, magp.id);
        assert.equal(link?.asignadoPorNombre, "PG2030 inst admin");

        const listed = (await listManagedUsers()).find((u) => u.id === created.id);
        assert.deepEqual(listed?.pg2030Institucion, { id: magp.id, nombre: "MAGP", sigla: `MAGP-${suffix}` });
      });

      await t.test("an inactive institution receives no new reporters", async () => {
        await updateInstitucion(adminId, gad.id, { activa: false });
        try {
          await assert.rejects(updateManagedUser(reporterId, { pg2030InstitucionId: gad.id }, adminId), status(400));
        } finally {
          await updateInstitucion(adminId, gad.id, { activa: true });
        }
      });

      await t.test("a role change drops the link, and a promotion can set it in the same request", async () => {
        await updateManagedUser(reporterId, { pg2030InstitucionId: gad.id }, adminId);
        assert.equal((await linkOf(reporterId))?.institucionId, gad.id);

        await updateManagedUser(reporterId, { role: "VIEWER" }, adminId);
        assert.equal(await linkOf(reporterId), null);

        // A VIEWER cannot hold one.
        await assert.rejects(updateManagedUser(reporterId, { pg2030InstitucionId: gad.id }, adminId), status(400));

        await updateManagedUser(reporterId, { role: "REPORTER", pg2030InstitucionId: gad.id }, adminId);
        assert.equal((await linkOf(reporterId))?.institucionId, gad.id);

        await updateManagedUser(reporterId, { pg2030InstitucionId: null }, adminId);
        assert.equal(await linkOf(reporterId), null);
      });

      await t.test("/pg2030/me tells a reporter whether they can write", async () => {
        const without = await getPg2030Me(claims(reporterId, "REPORTER"));
        assert.equal(without.institucion, null);
        assert.equal(without.puedeEscribir, false);

        await updateManagedUser(reporterId, { pg2030InstitucionId: gad.id }, adminId);
        const withInst = await getPg2030Me(claims(reporterId, "REPORTER"));
        assert.equal(withInst.institucion?.id, gad.id);
        assert.equal(withInst.puedeEscribir, true);

        assert.equal((await getPg2030Me(claims(adminId, "ADMIN"))).puedeEscribir, true);
      });

      await t.test("an institution with reporters cannot be deleted", async () => {
        await assert.rejects(deleteInstitucion(adminId, gad.id), status(409));
        assert.deepEqual(
          (await listInstituciones()).find((i) => i.id === gad.id)?.usuarios.map((u) => u.id),
          [reporterId],
        );
      });

      await t.test("removing PG2030 from a user drops their institution", async () => {
        await db.insert(userApps).values({ userId: reporterId, appKey: "pma" });
        await deleteManagedUser(reporterId, "pg2030", adminId);
        assert.equal(await linkOf(reporterId), null);

        // With no reporter left, the institution can go.
        await deleteInstitucion(adminId, gad.id);
        assert.equal((await db.select().from(pg2030Instituciones).where(eq(pg2030Instituciones.id, gad.id))).length, 0);
        createdInstitucionIds.splice(createdInstitucionIds.indexOf(gad.id), 1);
      });
    } finally {
      await db.delete(users).where(inArray(users.id, [adminId, reporterId, ...createdUserIds]));
      if (createdInstitucionIds.length > 0) {
        await db.delete(pg2030Instituciones).where(inArray(pg2030Instituciones.id, createdInstitucionIds));
      }
      await closeDb();
    }
  },
);
