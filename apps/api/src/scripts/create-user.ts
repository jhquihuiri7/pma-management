import "dotenv/config";
import { getDb } from "../db/client.js";
import { users, userApps, admins } from "../db/schema/shared.js";
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

async function createUser() {
  const db = getDb();

  console.log("\n=== Crear Nuevo Usuario ===\n");

  const adminEmail = await question("Email del administrador propietario: ");
  const userEmail = await question("Email del nuevo usuario: ");
  const userName = await question("Nombre del usuario: ");
  const role = await question("Rol (ADMIN/REPORTER/VIEWER) [REPORTER]: ");
  const appsList = await question("Apps (pma,rgdp,pglp,geo) [pma,rgdp]: ");

  if (!adminEmail || !userEmail || !userName) {
    console.error("❌ Email del admin, email del usuario y nombre son obligatorios");
    process.exit(1);
  }

  try {
    // Encontrar el admin
    const adminRows = await db.select().from(admins).where(eq(admins.email, adminEmail.toLowerCase())).limit(1);
    if (adminRows.length === 0) {
      console.error("❌ No existe un administrador con ese email");
      process.exit(1);
    }
    const admin = adminRows[0];

    // Verificar si el usuario ya existe
    const existing = await db.select().from(users).where(eq(users.email, userEmail.toLowerCase())).limit(1);
    if (existing.length > 0) {
      console.error("❌ El usuario con este correo ya existe");
      process.exit(1);
    }

    // Validar rol
    const validRoles = ["ADMIN", "REPORTER", "VIEWER"];
    const selectedRole = role.toUpperCase() || "REPORTER";
    if (!validRoles.includes(selectedRole)) {
      console.error(`❌ Rol inválido. Válidos: ${validRoles.join(", ")}`);
      process.exit(1);
    }

    // Parsear apps
    const selectedApps = (appsList || "pma,rgdp").split(",").map((a) => a.trim()) as Array<
      "pma" | "rgdp" | "pglp" | "geo"
    >;
    const validApps = ["pma", "rgdp", "pglp", "geo"];
    for (const app of selectedApps) {
      if (!validApps.includes(app)) {
        console.error(`❌ App inválida: ${app}. Válidas: ${validApps.join(", ")}`);
        process.exit(1);
      }
    }

    // Crear usuario sin contraseña (será establecida mediante email)
    const userResult = await db
      .insert(users)
      .values({
        adminId: admin.id,
        email: userEmail.toLowerCase(),
        name: userName,
        passwordHash: null,
        passwordSet: false,
        role: selectedRole as "ADMIN" | "REPORTER" | "VIEWER",
      })
      .returning();

    const userId = userResult[0].id;
    console.log(`✓ Usuario creado: ${userId}`);

    // Asignar apps
    await db.insert(userApps).values(
      selectedApps.map((appKey) => ({
        userId: userId,
        appKey: appKey,
      }))
    );
    console.log(`✓ Apps asignadas: ${selectedApps.join(", ")}`);

    console.log("\n✅ Usuario creado exitosamente");
    console.log(`\nDatos del nuevo usuario:`);
    console.log(`  Correo: ${userEmail}`);
    console.log(`  Nombre: ${userName}`);
    console.log(`  Rol: ${selectedRole}`);
    console.log(`  Apps: ${selectedApps.join(", ")}`);
    console.log(`\n⚠️  El usuario debe recibir un email para establecer su contraseña`);

    rl.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error al crear el usuario:", error);
    rl.close();
    process.exit(1);
  }
}

createUser();
