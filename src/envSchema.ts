import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().min(1).max(255),
  OPENAI_API_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).optional(),
});

export const envValid = envSchema.parse(process.env);
