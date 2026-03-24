import { drizzle } from "drizzle-orm/node-postgres";
import { dbEnvValid } from "../envDbSchema";
import { Pool } from "pg";

export const connection = new Pool({
  connectionString: dbEnvValid.DATABASE_URL,
});

export const db = drizzle({ client: connection });
