import { defineConfig } from "drizzle-kit";
import { envValid } from "./src/envSchema";
export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: envValid.DATABASE_URL,
  },
});
