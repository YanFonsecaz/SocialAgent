import { defineConfig } from "drizzle-kit";
import { dbEnvValid } from "./src/envDbSchema";
export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbEnvValid.DATABASE_URL,
  },
});
