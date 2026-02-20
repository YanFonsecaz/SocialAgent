import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().min(1).max(255),
  OPENAI_API_KEY: z.string().min(1),
  SERPAPI_API_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).optional(),

  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.string().min(1).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_SUBJECT: z.string().min(1).optional(),
  EMAIL_PROVIDER_API_KEY: z.string().min(1).optional(),
  EMAIL_API_PROVIDER: z.string().min(1).optional(),
});

export const envValid = envSchema.parse(process.env);
