import { drizzle } from "drizzle-orm/node-postgres";
import { envValid } from "../envSchema";
import { Pool } from "pg";

const connection = new Pool({
  connectionString: envValid.DATABASE_URL,
});

export const db = drizzle({ client: connection });
