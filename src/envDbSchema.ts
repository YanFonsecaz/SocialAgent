import { z } from "zod";

const dbEnvSchema = z.object({
    DATABASE_URL: z.url().min(1).max(255),
});

export const dbEnvValid = dbEnvSchema.parse(process.env);
