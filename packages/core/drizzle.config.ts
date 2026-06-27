import { defineConfig } from "drizzle-kit";
import { homedir } from "os";
import { join } from "path";

const defaultDbPath = join(homedir(), ".xevos", "xevos.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: defaultDbPath },
});