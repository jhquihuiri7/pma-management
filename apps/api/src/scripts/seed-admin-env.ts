import "dotenv/config";
import { getDb } from "../db/client.js";
import { users, userApps } from "../db/schema/shared.js";
import { hashPassword } from "../auth/password.js";
import { eq } from "drizzle-orm";
import { newPasswordValidationError } from "../auth/passwordPolicy.js";

async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !name || !password) {
    console.error("❌ Variables de entorno requeridas:");
    console.error("  - ADMIN_EMAIL");
    console.error("  - ADMIN_NAME");
    console.error("  - ADMIN_PASSWORD");
    process.exit(1);
  }

  const passwordError = newPasswordValidationError(password);
  if (passwordError) {
    console.error(`❌ ${passwordError}`);
    process.exit(1);
  }

  try {
    const db = getDb();

    // Verificar si el admin/usuario ya existe
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      console.warn("⚠️  El usuario con este correo ya existe");
      process.exit(0);
    }

    // Hashear la contraseña
    const passwordHash = await hashPassword(password);

    // Crear usuario ADMIN
    const userResult = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        name: name,
        passwordHash: passwordHash,
        passwordSet: true,
        role: "ADMIN",
      })
      .returning();

    const userId = userResult[0].id;
    console.log(`✓ Usuario creado: ${userId}`);

    // Asignar todas las apps
    const apps = ["pma", "rgdp", "geo", "previene"] as const;
    await db.insert(userApps).values(
      apps.map((appKey) => ({
        userId: userId,
        appKey: appKey,
      }))
    );
    console.log(`✓ Apps asignadas: ${apps.join(", ")}`);

    console.log("\n✅ Administrador creado exitosamente");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error al crear el administrador:", error);
    process.exit(1);
  }
}

seedAdminFromEnv();
