import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./client.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const db = getDb();
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: join(__dirname, "migrations") });
  console.log("Migrations complete.");
  await getPool().end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
