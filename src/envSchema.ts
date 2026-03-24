import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url().min(1).max(255),
  CORS_ORIGIN: z.string().min(1).optional(),
  APP_BASE_URL: z.url().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),

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

const getRequiredEnv = (key: "OPENAI_API_KEY" | "SERPAPI_API_KEY"): string => {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} não configurada no ambiente.`);
  }

  return value;
};

export const getOpenAIApiKey = (): string => getRequiredEnv("OPENAI_API_KEY");

export const getSerpApiApiKey = (): string =>
  getRequiredEnv("SERPAPI_API_KEY");
