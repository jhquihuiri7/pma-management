import "dotenv/config";
import { getDb } from "../db/client.js";
import { users, userApps } from "../db/schema/shared.js";
import { hashPassword } from "../auth/password.js";
import { eq } from "drizzle-orm";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function seedAdmin() {
  const db = getDb();

  console.log("\n=== Crear Usuario Administrador ===\n");

  const email = await question("Correo electrónico del administrador: ");
  const name = await question("Nombre del administrador: ");
  const password = await question("Contraseña: ");

  if (!email || !name || !password) {
    console.error("❌ Todos los campos son obligatorios");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ La contraseña debe tener al menos 8 caracteres");
    process.exit(1);
  }

  try {
    // Verificar si el admin/usuario ya existe
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      console.error("❌ El usuario con este correo ya existe");
      process.exit(1);
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
    const apps = ["pma", "rgdp", "geo"] as const;
    await db.insert(userApps).values(
      apps.map((appKey) => ({
        userId: userId,
        appKey: appKey,
      }))
    );
    console.log(`✓ Apps asignadas: ${apps.join(", ")}`);

    console.log("\n✅ Administrador creado exitosamente");
    console.log(`\nDatos de acceso:`);
    console.log(`  Correo: ${email}`);
    console.log(`  Rol: ADMIN`);
    console.log(`  Apps: ${apps.join(", ")}`);

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error al crear el administrador:", error);
    rl.close();
    process.exit(1);
  }
}

seedAdmin();
